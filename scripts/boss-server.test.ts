import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createDemoServer } from './demo-server.ts';
import type { BossMonthReport, BossTherapistMonth } from '../app/boss-types.ts';
import type { DemoBooking, DemoReservationInput, DemoState } from '../app/demo-booking.ts';
import type { GuestSelection } from '../app/catalog.ts';

const AUGUST_NOW = new Date('2026-08-05T02:00:00Z'); // 10:00 MYT
const SEPTEMBER_NOW = new Date('2026-09-05T02:00:00Z');
const OCTOBER_NOW = new Date('2026-10-05T02:00:00Z');
const PAST_MONTH = '2026-08';
const CURRENT_MONTH = '2026-09';

type CleanupContext = { after: (fn: () => void | Promise<void>) => void };
type ApiResponse<T> = { status: number; data: T; cookie: string };
type ErrorResponse = { error?: string };
type BookingResponse = { ok: true; booking: DemoBooking };

async function startServer(options: { dbPath?: string; now?: () => Date } = {}) {
  const server = createDemoServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/demo`;
  let closed = false;

  async function request<T = ErrorResponse>(path: string, method = 'GET', body?: unknown, cookie = ''): Promise<ApiResponse<T>> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Client': 'serene-local',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.text();
    return {
      status: response.status,
      data: (payload ? JSON.parse(payload) : {}) as T,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  }

  async function login(account: 'owner' | 'receptionist' | 's01' = 'owner') {
    return request<{ user: { role: string; email: string } }>('/auth', 'POST', {
      email: `${account}@serene.demo`,
      password: 'SereneDemo!',
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  return { request, login, close };
}

async function fixture(t: CleanupContext, options: { dbPath?: string; now?: () => Date } = {}) {
  const api = await startServer({ dbPath: ':memory:', now: () => SEPTEMBER_NOW, ...options });
  t.after(api.close);
  return api;
}

async function pastMonthFixture(t: CleanupContext) {
  let clock = AUGUST_NOW;
  const api = await startServer({ dbPath: ':memory:', now: () => clock });
  t.after(api.close);
  clock = SEPTEMBER_NOW;
  return { ...api, setNow(value: Date) { clock = value; } };
}

function findTherapist(report: BossMonthReport, therapistId = 'therapist-01'): BossTherapistMonth {
  const therapist = report.therapists.find((entry) => entry.therapistId === therapistId);
  assert.ok(therapist, `Expected ${therapistId} in the monthly report`);
  return therapist;
}

function deductionBody(report: BossMonthReport, overrides: Partial<{ rental: number; electricity: number; applyToFutureMonths: boolean; expectedRevision: string }> = {}) {
  return { rental: 123.45, electricity: 67.89, applyToFutureMonths: false, expectedRevision: report.revision, ...overrides };
}

function guest(): GuestSelection {
  return {
    id: crypto.randomUUID(),
    name: 'Later completed guest',
    categoryId: 'full-body',
    itemId: 'body-30',
    addOnIds: [],
    therapistPreference: '',
    therapistChoice: { mode: 'specific', requirement: 'required', gender: '', therapistId: 'therapist-01' },
  };
}

function bookingInput(): DemoReservationInput {
  return {
    date: '2026-08-05',
    time: '18:00',
    source: 'phone',
    groupTiming: 'together',
    contactName: 'Later test customer',
    contactPhone: '+60123456789',
    notes: 'Created after the first saved statement',
    guests: [guest()],
    idempotencyKey: crypto.randomUUID(),
  };
}

async function completeBooking(api: Awaited<ReturnType<typeof startServer>>, cookie: string) {
  const created = await api.request<BookingResponse>('/staff/bookings', 'POST', bookingInput(), cookie);
  assert.equal(created.status, 201);
  for (const status of ['checked_in', 'in_service', 'completed'] as const) {
    const updated = await api.request<BookingResponse>(`/staff/bookings/${created.data.booking.id}`, 'PATCH', { action: 'status', status }, cookie);
    assert.equal(updated.status, 200);
  }
  return created.data.booking.id;
}

function frozenFigures(report: BossMonthReport) {
  return {
    month: report.month,
    status: report.status,
    savedAt: report.savedAt,
    statementId: report.statementId,
    revision: report.revision,
    commissionPercent: report.commissionPercent,
    therapists: report.therapists,
    totals: report.totals,
  };
}

function assertNoPrivateFinance(value: unknown, privateReason: string) {
  const serialized = JSON.stringify(value);
  for (const field of ['rentalCents', 'electricityCents', 'commissionCents', 'shopShareCents', 'netCents', 'statementHistory', 'statementId']) {
    assert.equal(serialized.includes(`\"${field}\"`), false, `${field} leaked outside the boss API`);
  }
  assert.equal(serialized.includes(privateReason), false, 'The private finance audit reason leaked outside the boss API');
}

test('boss routes require an owner session, including guessed statement IDs and every mutation', async (t) => {
  const api = await pastMonthFixture(t);
  const owner = await api.login('owner');
  const receptionist = await api.login('receptionist');
  const therapist = await api.login('s01');
  const report = await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie);
  assert.equal(report.status, 200);

  const calls: [string, string, unknown?][] = [
    [`/boss/month?month=${PAST_MONTH}&statementId=guessed-private-id`, 'GET'],
    [`/boss/month/${PAST_MONTH}/therapists/therapist-01`, 'PATCH', deductionBody(report.data)],
    [`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: report.data.revision }],
    [`/boss/month/${PAST_MONTH}/reopen`, 'POST', { expectedRevision: report.data.revision, reason: 'Correction required' }],
  ];
  for (const [path, method, body] of calls) {
    assert.equal((await api.request(path, method, body)).status, 401);
    assert.equal((await api.request(path, method, body, receptionist.cookie)).status, 403);
    assert.equal((await api.request(path, method, body, therapist.cookie)).status, 403);
  }
  assert.equal((await api.request(`/boss/month?month=${PAST_MONTH}&statementId=guessed-private-id`, 'GET', undefined, owner.cookie)).status, 404);
});

test('month reads default to the current MYT month and reject malformed, out-of-range, and future months', async (t) => {
  const api = await fixture(t);
  const owner = await api.login();
  const current = await api.request<BossMonthReport>('/boss/month', 'GET', undefined, owner.cookie);
  assert.equal(current.status, 200);
  assert.equal(current.data.month, CURRENT_MONTH);
  assert.equal((current.data as BossMonthReport & { report?: unknown }).report, undefined, 'BossMonthReport must be returned unwrapped');

  const earliest = await api.request<BossMonthReport>('/boss/month?month=2000-01', 'GET', undefined, owner.cookie);
  assert.equal(earliest.status, 200);
  assert.equal(earliest.data.month, '2000-01');
  assert.equal(earliest.data.totals.completedTreatments, 0);
  assert.equal(earliest.data.totals.grossCents, 0);
  assert.ok(earliest.data.therapists.every((entry) => entry.completedTreatments === 0 && entry.days.every((day) => day.lines.length === 0)), 'Past reports must not contain invented historical sales');

  for (const month of ['1999-12', '2100-01', '2026-10', '2026-9', '2026-00', 'not-a-month']) {
    assert.equal((await api.request(`/boss/month?month=${encodeURIComponent(month)}`, 'GET', undefined, owner.cookie)).status, 400, month);
    assert.equal((await api.request(`/boss/month/${encodeURIComponent(month)}/close`, 'POST', { expectedRevision: current.data.revision }, owner.cookie)).status, 400, month);
  }
});

test('deduction edits use RM input, return integer sen, validate boundaries, and enforce optimistic revisions', async (t) => {
  const api = await pastMonthFixture(t);
  const owner = await api.login();
  const initial = await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie);
  assert.equal(initial.status, 200);

  const saved = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-01`, 'PATCH', deductionBody(initial.data), owner.cookie);
  assert.equal(saved.status, 200);
  assert.notEqual(saved.data.revision, initial.data.revision);
  const therapist = findTherapist(saved.data);
  assert.equal(therapist.completedTreatments, 1);
  assert.equal(therapist.serviceCents, 6_800);
  assert.equal(therapist.grossCents, 6_800);
  assert.equal(therapist.commissionCents, 3_400);
  assert.equal(therapist.shopShareCents, 3_400);
  assert.equal(therapist.rentalCents, 12_345);
  assert.equal(therapist.electricityCents, 6_789);
  assert.equal(therapist.netCents, 3_400 - 12_345 - 6_789);

  assert.equal((await api.request(`/boss/month/${PAST_MONTH}/therapists/therapist-01`, 'PATCH', deductionBody(initial.data, { rental: 1 }), owner.cookie)).status, 409, 'A stale revision must not overwrite newer figures');

  const invalidAmounts: unknown[][] = [
    [-0.01, 0],
    [100_000.01, 0],
    [0.001, 0],
    ['1.00', 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [0, -1],
    [0, 0.009],
  ];
  for (const [rental, electricity] of invalidAmounts) {
    const response = await api.request(`/boss/month/${PAST_MONTH}/therapists/therapist-02`, 'PATCH', {
      rental, electricity, applyToFutureMonths: false, expectedRevision: saved.data.revision,
    }, owner.cookie);
    assert.equal(response.status, 400, `rental=${String(rental)}, electricity=${String(electricity)}`);
  }
  assert.equal((await api.request(`/boss/month/${PAST_MONTH}/therapists/therapist-02`, 'PATCH', {
    rental: 0, electricity: 0, applyToFutureMonths: 'yes', expectedRevision: saved.data.revision,
  }, owner.cookie)).status, 400);
  assert.equal((await api.request(`/boss/month/${PAST_MONTH}/therapists/missing-therapist`, 'PATCH', deductionBody(saved.data), owner.cookie)).status, 404);

  const boundary = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-02`, 'PATCH', {
    rental: 100_000, electricity: 100_000, applyToFutureMonths: false, expectedRevision: saved.data.revision,
  }, owner.cookie);
  assert.equal(boundary.status, 200);
  assert.equal(findTherapist(boundary.data, 'therapist-02').rentalCents, 10_000_000);
  assert.equal(findTherapist(boundary.data, 'therapist-02').electricityCents, 10_000_000);
});

test('month-only overrides stay local while optional defaults flow into later months', async (t) => {
  const api = await pastMonthFixture(t);
  const owner = await api.login();
  const august = (await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie)).data;
  const originalDefault = findTherapist(august, 'therapist-02');

  const monthOnly = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-02`, 'PATCH', {
    rental: 111.11, electricity: 22.22, applyToFutureMonths: false, expectedRevision: august.revision,
  }, owner.cookie);
  assert.equal(monthOnly.status, 200);
  assert.equal(findTherapist(monthOnly.data, 'therapist-02').rentalCents, 11_111);

  const septemberBeforeDefault = await api.request<BossMonthReport>(`/boss/month?month=${CURRENT_MONTH}`, 'GET', undefined, owner.cookie);
  assert.equal(findTherapist(septemberBeforeDefault.data, 'therapist-02').rentalCents, originalDefault.rentalCents);
  assert.equal(findTherapist(septemberBeforeDefault.data, 'therapist-02').electricityCents, originalDefault.electricityCents);

  const futureDefault = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-02`, 'PATCH', {
    rental: 333.33, electricity: 44.44, applyToFutureMonths: true, expectedRevision: monthOnly.data.revision,
  }, owner.cookie);
  assert.equal(futureDefault.status, 200);
  const september = await api.request<BossMonthReport>(`/boss/month?month=${CURRENT_MONTH}`, 'GET', undefined, owner.cookie);
  assert.equal(findTherapist(september.data, 'therapist-02').rentalCents, 33_333);
  assert.equal(findTherapist(september.data, 'therapist-02').electricityCents, 4_444);

  const septemberOverride = await api.request<BossMonthReport>(`/boss/month/${CURRENT_MONTH}/therapists/therapist-02`, 'PATCH', {
    rental: 555.55, electricity: 66.66, applyToFutureMonths: false, expectedRevision: september.data.revision,
  }, owner.cookie);
  assert.equal(septemberOverride.status, 200);
  assert.equal(findTherapist(septemberOverride.data, 'therapist-02').rentalCents, 55_555);

  api.setNow(OCTOBER_NOW);
  const octoberOwner = await api.login();
  const october = await api.request<BossMonthReport>('/boss/month', 'GET', undefined, octoberOwner.cookie);
  assert.equal(october.data.month, '2026-10');
  assert.equal(findTherapist(october.data, 'therapist-02').rentalCents, 33_333);
  assert.equal(findTherapist(october.data, 'therapist-02').electricityCents, 4_444);
});

test('only past months close; stale closes fail, closed edits fail, and duplicate close is idempotent', async (t) => {
  const api = await pastMonthFixture(t);
  const owner = await api.login();
  const current = (await api.request<BossMonthReport>(`/boss/month?month=${CURRENT_MONTH}`, 'GET', undefined, owner.cookie)).data;
  assert.equal((await api.request(`/boss/month/${CURRENT_MONTH}/close`, 'POST', { expectedRevision: current.revision }, owner.cookie)).status, 409);

  const initial = (await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie)).data;
  const edited = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-01`, 'PATCH', deductionBody(initial, { rental: 10, electricity: 5 }), owner.cookie);
  assert.equal(edited.status, 200);
  assert.equal((await api.request(`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: initial.revision }, owner.cookie)).status, 409);

  const closed = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: edited.data.revision }, owner.cookie);
  assert.equal(closed.status, 200);
  assert.equal(closed.data.status, 'closed');
  assert.ok(closed.data.statementId);
  assert.ok(closed.data.savedAt);
  assert.ok(closed.data.statementHistory.some((entry) => entry.id === closed.data.statementId));

  assert.equal((await api.request(`/boss/month/${PAST_MONTH}/therapists/therapist-01`, 'PATCH', deductionBody(closed.data, { rental: 11 }), owner.cookie)).status, 409);

  const duplicate = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: initial.revision }, owner.cookie);
  assert.equal(duplicate.status, 200, 'An already-closed retry succeeds even with the original revision');
  assert.equal(duplicate.data.statementId, closed.data.statementId);
  assert.equal(duplicate.data.savedAt, closed.data.savedAt);
  assert.deepEqual(duplicate.data.totals, closed.data.totals);
  assert.equal(duplicate.data.statementHistory.length, closed.data.statementHistory.length);
  assert.equal(duplicate.data.audit.length, closed.data.audit.length);
});

test('reopen requires a meaningful reason and keeps the saved statement in immutable history', async (t) => {
  const api = await pastMonthFixture(t);
  const owner = await api.login();
  const open = (await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie)).data;
  const closed = (await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: open.revision }, owner.cookie)).data;

  assert.equal((await api.request(`/boss/month/${PAST_MONTH}/reopen`, 'POST', { expectedRevision: open.revision, reason: 'valid reason' }, owner.cookie)).status, 409);
  for (const reason of ['', 'x', 'x'.repeat(501), 123]) {
    assert.equal((await api.request(`/boss/month/${PAST_MONTH}/reopen`, 'POST', { expectedRevision: closed.revision, reason }, owner.cookie)).status, 400);
  }

  const reason = 'Correct a counter-sale classification';
  const reopened = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/reopen`, 'POST', { expectedRevision: closed.revision, reason }, owner.cookie);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.status, 'open');
  assert.equal(reopened.data.statementId, null);
  assert.ok(reopened.data.statementHistory.some((entry) => entry.id === closed.statementId));
  assert.ok(reopened.data.audit.some((entry) => entry.action.includes(reason)));
  assert.equal((await api.request(`/boss/month/${PAST_MONTH}/reopen`, 'POST', { expectedRevision: reopened.data.revision, reason: 'Already open' }, owner.cookie)).status, 409);

  const historical = await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}&statementId=${encodeURIComponent(closed.statementId!)}`, 'GET', undefined, owner.cookie);
  assert.equal(historical.status, 200);
  assert.deepEqual(frozenFigures(historical.data), frozenFigures(closed));
});

test('saved statement figures remain frozen after reopen, changed defaults, and newly completed bookings', async (t) => {
  const api = await pastMonthFixture(t);
  const owner = await api.login();
  const open = (await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie)).data;
  const closed = (await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: open.revision }, owner.cookie)).data;
  const frozen = frozenFigures(closed);
  const reopened = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/reopen`, 'POST', {
    expectedRevision: closed.revision, reason: 'Add a late-completed paper booking',
  }, owner.cookie);
  assert.equal(reopened.status, 200);

  api.setNow(AUGUST_NOW);
  await completeBooking(api, owner.cookie);
  const changedOpen = (await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie)).data;
  const changedDeductions = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-01`, 'PATCH', {
    rental: 987.65, electricity: 43.21, applyToFutureMonths: true, expectedRevision: changedOpen.revision,
  }, owner.cookie);
  assert.equal(changedDeductions.status, 200);
  assert.ok(changedDeductions.data.totals.grossCents > closed.totals.grossCents);
  assert.notDeepEqual(frozenFigures(changedDeductions.data), frozen);

  api.setNow(SEPTEMBER_NOW);
  const historical = await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}&statementId=${encodeURIComponent(closed.statementId!)}`, 'GET', undefined, owner.cookie);
  assert.equal(historical.status, 200);
  assert.deepEqual(frozenFigures(historical.data), frozen);
  assert.ok(historical.data.statementHistory.some((entry) => entry.id === closed.statementId));
});

test('private monthly finance and audit data never leak into staff, public, or therapist earnings responses', async (t) => {
  const api = await pastMonthFixture(t);
  const owner = await api.login();
  const initial = (await api.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie)).data;
  const edited = (await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-01`, 'PATCH', {
    rental: 12_345.67, electricity: 23_456.78, applyToFutureMonths: false, expectedRevision: initial.revision,
  }, owner.cookie)).data;
  const closed = (await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: edited.revision }, owner.cookie)).data;
  const privateReason = 'PRIVATE-FINANCE-REASON-DO-NOT-LEAK';
  const reopened = await api.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/reopen`, 'POST', {
    expectedRevision: closed.revision, reason: privateReason,
  }, owner.cookie);
  assert.equal(reopened.status, 200);

  const staffState = await api.request<DemoState>('/staff/state', 'GET', undefined, owner.cookie);
  const publicState = await api.request('/public-state');
  const ownerEarnings = await api.request('/staff/today-earnings', 'GET', undefined, owner.cookie);
  const therapist = await api.login('s01');
  const therapistEarnings = await api.request('/staff/today-earnings', 'GET', undefined, therapist.cookie);
  for (const response of [staffState, publicState, ownerEarnings, therapistEarnings]) {
    assert.equal(response.status, 200);
    assertNoPrivateFinance(response.data, privateReason);
  }
});

test('deductions, closed snapshots, history, and finance audit persist across a backend restart in a separate table', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'serene-boss-api-test-'));
  const dbPath = join(directory, 'boss.sqlite');
  const servers: Awaited<ReturnType<typeof startServer>>[] = [];
  t.after(async () => {
    for (const server of servers) await server.close();
    rmSync(directory, { recursive: true, force: true });
  });

  let clock = AUGUST_NOW;
  const first = await startServer({ dbPath, now: () => clock });
  servers.push(first);
  clock = SEPTEMBER_NOW;
  const owner = await first.login();
  const initial = (await first.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, owner.cookie)).data;
  const edited = (await first.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/therapists/therapist-03`, 'PATCH', {
    rental: 432.10, electricity: 12.34, applyToFutureMonths: true, expectedRevision: initial.revision,
  }, owner.cookie)).data;
  const closed = (await first.request<BossMonthReport>(`/boss/month/${PAST_MONTH}/close`, 'POST', { expectedRevision: edited.revision }, owner.cookie)).data;
  const expected = frozenFigures(closed);
  await first.close();

  const database = new DatabaseSync(dbPath);
  try {
    const ordinaryState = (database.prepare('SELECT json FROM state WHERE id=1').get() as { json: string }).json;
    const privateFinance = (database.prepare('SELECT json FROM boss_finance WHERE id=1').get() as { json: string }).json;
    assert.equal(ordinaryState.includes('rentalCents'), false);
    assert.equal(ordinaryState.includes(closed.statementId!), false);
    assert.equal(privateFinance.includes('rentalCents'), true);
    assert.equal(privateFinance.includes(closed.statementId!), true);
  } finally {
    database.close();
  }

  const second = await startServer({ dbPath, now: () => SEPTEMBER_NOW });
  servers.push(second);
  const restartedOwner = await second.login();
  const restored = await second.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}`, 'GET', undefined, restartedOwner.cookie);
  assert.equal(restored.status, 200);
  assert.deepEqual(frozenFigures(restored.data), expected);
  assert.equal(findTherapist(restored.data, 'therapist-03').rentalCents, 43_210);
  assert.equal(findTherapist(restored.data, 'therapist-03').electricityCents, 1_234);
  assert.ok(restored.data.statementHistory.some((entry) => entry.id === closed.statementId));
  assert.ok(restored.data.audit.length >= 2);

  const historical = await second.request<BossMonthReport>(`/boss/month?month=${PAST_MONTH}&statementId=${encodeURIComponent(closed.statementId!)}`, 'GET', undefined, restartedOwner.cookie);
  assert.equal(historical.status, 200);
  assert.deepEqual(frozenFigures(historical.data), expected);
});
