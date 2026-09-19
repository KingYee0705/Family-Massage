import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDemoServer } from './demo-server.ts';
import { calculateDemoDailyEarnings, expirePending, findDemoSchedule, initialDemoState, isTherapistCompatible, sampleTherapists, type DemoDailyEarnings, type DemoReservationInput, type DemoState, type DemoBooking, type DemoStaffUser } from '../app/demo-booking.ts';
import { catalog, type GuestSelection } from '../app/catalog.ts';
import { calculateDemoAvailability, type DemoPublicState, type StaffState } from '../app/demo-booking.ts';
import { overrunWarnings } from '../app/room-schedule.ts';

const NOW = new Date('2026-09-05T02:00:00Z');
const guest = (overrides: Partial<GuestSelection> = {}): GuestSelection => ({ id: 'guest-1', name: 'Demo guest', categoryId: 'full-body', itemId: 'body-120', addOnIds: [], therapistPreference: '', therapistChoice: { mode: 'none', requirement: 'preferred', gender: '', therapistId: '' }, ...overrides });
const input = (overrides: Partial<DemoReservationInput> = {}): DemoReservationInput => ({ date: '2026-09-07', time: '14:00', contactName: 'Test customer', contactPhone: '+60123456789', notes: 'Private test note', guests: [guest()], groupTiming: 'together', idempotencyKey: crypto.randomUUID(), ...overrides });
const specific = (id = 'therapist-01', overrides: Partial<GuestSelection> = {}) => guest({ therapistChoice: { mode: 'specific', requirement: 'required', gender: '', therapistId: id }, ...overrides });
type TestResponse = DemoState & { booking: DemoBooking; reason: string; alternatives: string[]; user: DemoStaffUser };

async function fixture(t: { after: (fn: () => Promise<void>) => void }, options: { dbPath?: string; now?: () => Date } = {}) {
  const server = createDemoServer({ dbPath: ':memory:', now: () => NOW, ...options });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/demo`;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  async function request<T = TestResponse>(path: string, method = 'GET', body?: unknown, cookie = '') {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Demo-Client': 'serene-local', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() as T, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
  }
  async function login(role = 'owner') { return request('/auth', 'POST', { email: `${role}@serene.demo`, password: 'SereneDemo!' }); }
  return { request, login, base };
}

test('overruns block every booking channel and group atomically; completion reserves five actual cleaning minutes', async (t) => {
  let clock = new Date(NOW);
  const { request, login } = await fixture(t, { now: () => clock });
  let owner = await login();
  const first = (await request('/bookings', 'POST', input({ guests: [specific()] }))).data.booking;
  const later = (await request('/bookings', 'POST', input({ time: '17:00', guests: [specific(undefined, { itemId: 'body-60' })] }))).data.booking;
  assert.ok(first.id && later.id);
  clock = new Date('2026-09-07T06:00:00Z');
  owner = await login();
  for (const status of ['checked_in', 'in_service']) assert.equal((await request(`/staff/bookings/${first.id}`, 'PATCH', { action: 'status', status }, owner.cookie)).status, 200);
  clock = new Date('2026-09-07T08:10:00Z');
  const staff = await login('receptionist');
  const publicState = (await request<DemoPublicState>('/public-state')).data;
  const availability = calculateDemoAvailability({ date: '2026-09-07', guests: [specific()], groupTiming: 'together', therapists: publicState.therapists, bookings: publicState.bookings, now: clock });
  assert.equal(availability.find((slot) => slot.time === '20:00')?.available, false);
  for (const [path, cookie] of [['/bookings', ''], ['/staff/bookings', staff.cookie]]) {
    assert.equal((await request(path, 'POST', input({ time: '20:00', guests: [specific()] }), cookie)).status, 409);
    assert.equal((await request(path, 'POST', input({ time: '20:00', guests: [specific(), specific('therapist-04', { id: 'second' })] }), cookie)).status, 409);
  }
  const state = (await request('/staff/state', 'GET', undefined, owner.cookie)).data;
  assert.deepEqual(state.bookings.find((booking) => booking.id === later.id), later, 'Never modify the pre-existing confirmed appointment');
  assert.equal(state.bookings.length, publicState.bookings.length);
  assert.ok(overrunWarnings(state, clock).find((warning) => warning.id === first.id)?.conflicts.some((conflict) => conflict.id === later.id));
  // Reassignment and rescheduling also use the authoritative occupancy policy.
  assert.equal((await request(`/staff/bookings/${later.id}`, 'PATCH', { action: 'reschedule', date: '2026-09-07', time: '20:00' }, staff.cookie)).status, 409);
  clock = new Date('2026-09-07T08:12:30Z');
  const completed = await request(`/staff/bookings/${first.id}`, 'PATCH', { action: 'status', status: 'completed' }, staff.cookie);
  assert.equal(completed.status, 200);
  assert.equal(completed.data.booking.completedAt, clock.toISOString());
  assert.deepEqual(completed.data.booking.assignments, first.assignments, 'Stored schedule is preserved');
  const cleanedState = (await request<DemoPublicState>('/public-state')).data;
  const args = { date: '2026-09-07', guests: [specific(undefined, { itemId: 'body-30' })], groupTiming: 'together' as const, therapists: cleanedState.therapists, bookings: cleanedState.bookings, now: clock };
  assert.equal(findDemoSchedule({ ...args, time: '16:15' }), null);
  assert.ok(findDemoSchedule({ ...args, time: '16:20' }));
  assert.equal((await request('/staff/bookings', 'POST', input({ time: '16:15', guests: args.guests }), staff.cookie)).status, 409);
  assert.equal((await request('/staff/bookings', 'POST', input({ time: '16:20', guests: args.guests }), staff.cookie)).status, 201);
  assert.deepEqual((await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((booking) => booking.id === later.id), later);
});

test('unresolved overnight treatment stays blocked until manual completion and cleaning, without changing status automatically', async (t) => {
  let clock = new Date(NOW);
  const { request, login } = await fixture(t, { now: () => clock });
  let owner = await login();
  const first = (await request('/bookings', 'POST', input({ guests: [specific()] }))).data.booking;
  for (const status of ['checked_in', 'in_service']) await request(`/staff/bookings/${first.id}`, 'PATCH', { action: 'status', status }, owner.cookie);
  for (const at of ['2026-09-07T16:01:00Z', '2026-09-08T03:00:00Z']) {
    clock = new Date(at); owner = await login();
    const state = (await request('/staff/state', 'GET', undefined, owner.cookie)).data;
    assert.equal(state.bookings.find((booking) => booking.id === first.id)?.status, 'in_service');
    assert.equal(overrunWarnings(state, clock).find((warning) => warning.id === first.id)?.overnight, true);
    assert.equal((await request('/bookings', 'POST', input({ date: '2026-09-08', guests: [specific()] }))).status, 409);
  }
  assert.equal((await request(`/staff/bookings/${first.id}`, 'PATCH', { action: 'status', status: 'completed' }, owner.cookie)).status, 200);
  assert.equal((await request('/staff/bookings', 'POST', input({ date: '2026-09-08', time: '11:00', guests: [specific()] }), owner.cookie)).status, 409);
  assert.equal((await request('/staff/bookings', 'POST', input({ date: '2026-09-08', time: '11:05', guests: [specific()] }), owner.cookie)).status, 201);
});

test('receptionist historical state, mutation, receipt and idempotent responses omit money; owner and today access are preserved', async (t) => {
  let clock = new Date('2026-09-07T02:00:00Z');
  const { request, login } = await fixture(t, { now: () => clock });
  let owner = await login(); let receptionist = await login('receptionist');
  const body = input({ guests: [specific()] });
  const created = await request('/staff/bookings', 'POST', body, receptionist.cookie);
  assert.equal(created.status, 201);
  const id = created.data.booking.id;
  assert.equal(typeof created.data.booking.total, 'number');
  assert.equal('receiptToken' in created.data.booking, false);
  for (const status of ['checked_in', 'in_service']) await request(`/staff/bookings/${id}`, 'PATCH', { action: 'status', status }, receptionist.cookie);
  const added = await request(`/staff/bookings/${id}`, 'PATCH', { action: 'add_addons', guestId: 'guest-1', addOnIds: ['thai-balm'], source: 'counter' }, receptionist.cookie);
  assert.equal(added.status, 200);
  const original = (await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((booking) => booking.id === id)!;
  assert.ok(original.addOnSales?.length);
  function assertNoMoney(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!['total', 'itemPrice', 'price', 'gross', 'commission', 'receiptToken'].includes(key), `Restricted field: ${key}`);
      assertNoMoney(child);
    }
  }
  clock = new Date('2026-09-08T02:00:00Z');
  owner = await login(); receptionist = await login('receptionist');
  const history = await request<StaffState>('/staff/state', 'GET', undefined, receptionist.cookie);
  const historical = history.data.bookings.find((booking) => booking.id === id)!;
  assertNoMoney(historical);
  assert.equal(historical.financialsHidden, true);
  assert.deepEqual(historical.assignments, original.assignments);
  assert.deepEqual(historical.guests, original.guests);
  assert.equal(historical.priceSnapshots?.[0].item.en, original.priceSnapshots?.[0].item.en);
  assert.equal(historical.addOnSales?.[0].name.en, original.addOnSales?.[0].name.en);
  assert.ok(history.data.audit.every((entry) => !entry.action.includes('RM')));
  const retry = await request('/staff/bookings', 'POST', body, receptionist.cookie);
  assert.equal(retry.status, 201); assert.equal(retry.data.booking.id, id); assertNoMoney(retry.data.booking);
  const receipt = await request(`/bookings/${id}?token=${encodeURIComponent(original.receiptToken!)}`, 'GET', undefined, receptionist.cookie);
  assert.equal(receipt.status, 200); assertNoMoney(receipt.data);
  const completed = await request(`/staff/bookings/${id}`, 'PATCH', { action: 'status', status: 'completed' }, receptionist.cookie);
  assert.equal(completed.status, 200); assertNoMoney(completed.data.booking);
  const ownerRecord = (await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((booking) => booking.id === id)!;
  assert.equal(ownerRecord.total, original.total);
  assert.deepEqual(ownerRecord.priceSnapshots, original.priceSnapshots);
  assert.deepEqual(ownerRecord.addOnSales, original.addOnSales);
  const today = await request('/staff/bookings', 'POST', input({ date: '2026-09-08', time: '18:00', guests: [specific()] }), receptionist.cookie);
  assert.equal(today.status, 201); assert.equal(typeof today.data.booking.total, 'number');
  assert.equal((await request('/boss/month', 'GET', undefined, receptionist.cookie)).status, 403);
});

test('public and staff booking endpoints share digit-based phone validation', async (t) => {
  const { request, login } = await fixture(t);
  const staff = await login('receptionist');
  const before = (await request('/staff/state', 'GET', undefined, staff.cookie)).data.bookings.length;
  let accepted = 0;
  for (const path of ['/bookings', '/staff/bookings']) {
    const cookie = path.startsWith('/staff') ? staff.cookie : '';
    for (const contactPhone of ['--------', '12-34 567', '+--- ---', '+1234567890123456']) {
      const result = await request(path, 'POST', input({ contactPhone }), cookie);
      assert.equal(result.status, 400, 'invalid phone must not create a booking');
    }
    for (const contactPhone of ['61234567', '012-345 6789', '+60 (12) 345-6789', '+1 (202) 555-0100']) {
      const date = `2026-09-${String(10 + accepted).padStart(2, '0')}`;
      const result = await request(path, 'POST', input({ date, contactPhone }), cookie);
      assert.equal(result.status, 201, 'valid phone should be accepted by either booking endpoint');
      accepted += 1;
    }
  }
  const after = (await request('/staff/state', 'GET', undefined, staff.cookie)).data.bookings.length;
  assert.equal(after, before + accepted);
});

test('full duration and cleaning block a therapist; a different qualified therapist remains bookable', () => {
  const state = initialDemoState(NOW);
  const result = findDemoSchedule({ date: '2026-09-07', time: '14:00', guests: [specific()], groupTiming: 'together', therapists: state.therapists, bookings: [], now: NOW });
  assert.equal(result?.assignments[0].end, '16:00');
  assert.equal(result?.assignments[0].cleanupEnd, '16:05');
  const occupied = [{ date: '2026-09-07', status: 'confirmed' as const, holdExpiresAt: null, assignments: result!.assignments }];
  assert.equal(findDemoSchedule({ date: '2026-09-07', time: '15:00', guests: [specific()], groupTiming: 'together', therapists: state.therapists, bookings: occupied, now: NOW }), null);
  assert.ok(findDemoSchedule({ date: '2026-09-07', time: '15:00', guests: [specific('therapist-02')], groupTiming: 'together', therapists: state.therapists, bookings: occupied, now: NOW }));
  assert.equal(findDemoSchedule({ date: '2026-09-07', time: '16:00', guests: [specific()], groupTiming: 'together', therapists: state.therapists, bookings: occupied, now: NOW }), null);
  assert.ok(findDemoSchedule({ date: '2026-09-07', time: '16:05', guests: [specific()], groupTiming: 'together', therapists: state.therapists, bookings: occupied, now: NOW }));
});

test('mixed packages require both skills, reserve a bed and chair, and validate included add-on skills', () => {
  const mixed = guest({ categoryId: 'aromatherapy', itemId: 'aroma-pkg-foot' });
  assert.equal(isTherapistCompatible(sampleTherapists[0], mixed), false);
  assert.equal(isTherapistCompatible(sampleTherapists[2], mixed), true);
  const result = findDemoSchedule({ date: '2026-09-07', time: '14:00', guests: [mixed], groupTiming: 'together', therapists: sampleTherapists, bookings: [], now: NOW });
  assert.equal(result?.assignments[0].resourceIds.length, 2);
  assert.equal(isTherapistCompatible(sampleTherapists[0], guest({ itemId: 'body-pkg-cupping' })), false);
  assert.equal(isTherapistCompatible(sampleTherapists[1], guest({ itemId: 'body-pkg-cupping' })), true);
});

test('leave, shifts, closing, gender requirements, preferred fallback and six-guest limit are honored', () => {
  const profiles = structuredClone(sampleTherapists);
  profiles[0].leaveDates = ['2026-09-07'];
  const args = { date: '2026-09-07', time: '14:00', groupTiming: 'together' as const, therapists: profiles, bookings: [], now: NOW };
  assert.equal(findDemoSchedule({ ...args, guests: [specific()] }), null);
  const preference = specific(); preference.therapistChoice!.requirement = 'preferred';
  assert.equal(findDemoSchedule({ ...args, guests: [preference] })?.usedFallbackPreference, true);
  assert.equal(findDemoSchedule({ ...args, time: '22:00', guests: [guest()] }), null);
  assert.equal(findDemoSchedule({ ...args, time: '10:30', guests: [guest()] }), null);
  assert.equal(findDemoSchedule({ ...args, guests: Array.from({ length: 7 }, (_, i) => guest({ id: `g${i}` })) }), null);
  const female = guest({ therapistChoice: { mode: 'gender', requirement: 'required', gender: 'female', therapistId: '' } });
  const result = findDemoSchedule({ ...args, guests: [female] });
  assert.equal(profiles.find((p) => p.id === result?.assignments[0].therapistId)?.gender, 'female');
  const flexible = findDemoSchedule({ ...args, groupTiming: 'flexible', guests: [specific('therapist-02'), specific('therapist-03', { id: 'g2', itemId: 'body-90' })] });
  assert.deepEqual(flexible?.assignments.map((a) => a.start), ['14:00', '14:30']);
  assert.deepEqual(flexible?.assignments.map((a) => a.end), ['16:00', '16:00']);
});

test('six qualified guests fit together and impossible flexible groups return promptly', () => {
  const guests = sampleTherapists.map((therapist, index) => specific(therapist.id, { id: `g${index}`, categoryId: index === 4 ? 'aromatherapy' : 'full-body', itemId: index === 4 ? 'aroma-60' : 'body-60' }));
  const args = { date: '2026-09-07', time: '14:00', guests, groupTiming: 'together' as const, therapists: sampleTherapists, bookings: [], now: NOW };
  assert.equal(findDemoSchedule(args)?.assignments.length, 6);
  const impossible = Array.from({ length: 6 }, (_, i) => guest({ id: `g${i}`, categoryId: 'thai', itemId: 'thai-120' }));
  const start = performance.now();
  assert.equal(findDemoSchedule({ ...args, guests: impossible, groupTiming: 'flexible' }), null);
  assert.ok(performance.now() - start < 500, 'Impossible group matching must stay responsive');
});

test('API atomically reserves final capacity and repeated idempotency keys create no duplicate', async (t) => {
  const { request } = await fixture(t);
  const body = input({ guests: [specific()] });
  const responses = await Promise.all([request('/bookings', 'POST', body), request('/bookings', 'POST', { ...body, idempotencyKey: crypto.randomUUID() })]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const winner = responses.find((r) => r.status === 201)!;
  const conflict = responses.find((r) => r.status === 409)!;
  assert.equal(winner.data.booking.status, 'confirmed');
  assert.equal(winner.data.booking.holdExpiresAt, null);
  assert.equal(conflict.data.reason, 'conflict');
  assert.ok(conflict.data.alternatives.length > 0);
  // Use a fresh independent time for a deterministic retry key.
  const repeatBody = input({ time: '18:00' });
  const first = await request('/bookings', 'POST', repeatBody);
  const retry = await request('/bookings', 'POST', repeatBody);
  assert.equal(first.data.booking.status, 'confirmed');
  assert.equal(first.data.booking.holdExpiresAt, null);
  assert.equal(first.data.booking.id, retry.data.booking.id);
  assert.equal((await request('/bookings', 'POST', { ...repeatBody, contactName: 'Changed name' })).status, 409);
});

test('ordinary website bookings confirm immediately and keep capacity held', async (t) => {
  const { request } = await fixture(t);
  const bookingInput = input({
    date: '2026-09-09',
    guests: [guest({ itemId: 'body-60' })],
  });
  const created = await request('/bookings', 'POST', bookingInput);
  assert.equal(created.status, 201);
  assert.equal(created.data.booking.status, 'confirmed');
  assert.equal(created.data.booking.holdExpiresAt, null);

  const therapistId = created.data.booking.assignments[0].therapistId;
  const collision = await request('/bookings', 'POST', input({
    date: bookingInput.date,
    time: bookingInput.time,
    guests: [specific(therapistId, { itemId: 'body-60' })],
  }));
  assert.equal(collision.status, 409);

  const preferredTherapist = specific('therapist-03', { id: 'preferred-guest' });
  preferredTherapist.therapistChoice!.requirement = 'preferred';
  const selectedTherapistBooking = await request('/bookings', 'POST', input({
    date: '2026-09-10',
    guests: [preferredTherapist],
  }));
  assert.equal(selectedTherapistBooking.status, 201);
  assert.equal(selectedTherapistBooking.data.booking.status, 'confirmed');
  assert.equal(selectedTherapistBooking.data.booking.holdExpiresAt, null);

});

test('group website bookings confirm immediately when the complete group fits', async (t) => {
  const { request } = await fixture(t);
  const created = await request('/bookings', 'POST', input({
    date: '2026-09-09',
    guests: [guest(), guest({ id: 'guest-2' })],
  }));
  assert.equal(created.status, 201);
  assert.equal(created.data.booking.status, 'confirmed');
  assert.equal(created.data.booking.holdExpiresAt, null);
  assert.equal(created.data.booking.assignments.length, 2);
});

test('simultaneous full-capacity groups cannot double-book the same team', async (t) => {
  const { request } = await fixture(t);
  const guests = sampleTherapists.map((therapist, index) => specific(therapist.id, {
    id: `group-guest-${index + 1}`,
    categoryId: index === 4 ? 'aromatherapy' : 'full-body',
    itemId: index === 4 ? 'aroma-60' : 'body-60',
  }));
  const first = input({ date: '2026-09-10', guests });
  const second = { ...first, idempotencyKey: crypto.randomUUID() };
  const responses = await Promise.all([
    request('/bookings', 'POST', first),
    request('/bookings', 'POST', second),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const winner = responses.find((response) => response.status === 201)!;
  const conflict = responses.find((response) => response.status === 409)!;
  assert.equal(winner.data.booking.status, 'confirmed');
  assert.equal(winner.data.booking.assignments.length, 6);
  assert.equal(conflict.data.reason, 'conflict');
  assert.ok(conflict.data.alternatives.length > 0);
});

test('today earnings include completed guest work only and total each therapist', () => {
  const summary = calculateDemoDailyEarnings(initialDemoState(NOW), '2026-09-05', undefined, NOW.toISOString());
  assert.equal(summary.completedTreatments, 1);
  assert.equal(summary.gross, 68);
  assert.equal(summary.therapists[0].staffNumber, 'S01');
  assert.equal(summary.therapists[0].gross, 68);
  assert.equal(summary.therapists[0].lines[0].service.en, '1 hour');
  assert.equal(calculateDemoDailyEarnings(initialDemoState(NOW), '2026-09-06').gross, 0);
});

test('server rejects tampered prices, duplicate/included extras, invalid guest counts and short notice', async (t) => {
  const { request } = await fixture(t);
  const created = await request('/bookings', 'POST', { ...input(), total: 1, guests: [guest({ itemId: 'body-60', addOnIds: ['coconut-oil'] })] });
  assert.equal(created.data.booking.total, 78);
  assert.equal(created.data.booking.priceSnapshots![0].total, 78);
  for (const bad of [
    input({ guests: [guest({ addOnIds: ['cupping', 'cupping'] })] }),
    input({ guests: [guest({ itemId: 'body-pkg-cupping', addOnIds: ['cupping'] })] }),
    input({ guests: [guest({ addOnIds: ['herbal-bag'] })] }),
    input({ guests: [] }), input({ guests: Array.from({ length: 7 }, (_, i) => guest({ id: `g${i}` })) }),
    input({ date: '2026-09-05', time: '10:30' }), input({ date: '2026-02-30' }),
  ]) assert.equal((await request('/bookings', 'POST', bad)).status, 400);
  assert.equal((await request('/bookings', 'POST', input({ time: '22:00' }))).status, 409);
});

test('public state exposes occupied times without contact data; staff authentication is enforced', async (t) => {
  const { request, login, base } = await fixture(t);
  await request('/bookings', 'POST', input());
  const publicState = await request('/public-state');
  const serialized = JSON.stringify(publicState.data);
  assert.equal(serialized.includes('Test customer'), false);
  assert.equal(serialized.includes('+60123456789'), false);
  assert.equal(serialized.includes('Private test note'), false);
  assert.equal(serialized.includes('contactName'), false);
  const receiptBooking = (await request('/bookings', 'POST', input({ date: '2026-09-08' }))).data.booking;
  assert.equal((await request(`/bookings/${receiptBooking.id}`)).status, 404);
  assert.equal((await request(`/bookings/${receiptBooking.id}?token=wrong`)).status, 404);
  assert.equal((await request<DemoBooking>(`/bookings/${receiptBooking.id}?token=${receiptBooking.receiptToken}`)).data.contactName, 'Test customer');
  assert.equal((await request('/staff/state')).status, 401);
  assert.equal((await request('/auth', 'POST', { email: 'owner@serene.demo', password: 'wrong' })).status, 401);
  const owner = await login();
  assert.equal((owner.data.user as DemoStaffUser).role, 'owner');
  assert.equal((await request('/staff/state', 'GET', undefined, owner.cookie)).status, 200);
  assert.equal((await request('/session', 'GET', undefined, owner.cookie)).data.user.email, 'owner@serene.demo');
  const csrf = await fetch(`${base}/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal(csrf.status, 403);
  await request('/auth', 'DELETE', undefined, owner.cookie);
  assert.equal((await request('/session', 'GET', undefined, owner.cookie)).data.user, null);
});

test('therapist accounts can only read their own current-day earnings', async (t) => {
  const { request, login } = await fixture(t);
  const therapist = await login('s01');
  assert.equal(therapist.status, 200);
  assert.equal(therapist.data.user.role, 'therapist');
  assert.equal(therapist.data.user.therapistId, 'therapist-01');
  assert.equal((await request('/staff/state', 'GET', undefined, therapist.cookie)).status, 403);
  const today = await request<DemoDailyEarnings>('/staff/today-earnings?date=2020-01-01', 'GET', undefined, therapist.cookie);
  assert.equal(today.status, 200);
  assert.equal(today.data.date, '2026-09-05');
  assert.equal(today.data.therapists.length, 1);
  assert.equal(today.data.therapists[0].staffNumber, 'S01');
  assert.equal(today.data.gross, 68);
  assert.equal((await request('/staff/bookings', 'POST', input(), therapist.cookie)).status, 403);
  assert.equal((await request('/staff/bookings/a101', 'PATCH', { action: 'status', status: 'confirmed' }, therapist.cookie)).status, 403);
  assert.equal((await request('/staff/therapists/therapist-01', 'PATCH', {}, therapist.cookie)).status, 403);
  assert.equal((await request('/staff/reset', 'POST', {}, therapist.cookie)).status, 403);

  const receptionist = await login('receptionist');
  const frontDeskToday = await request<DemoDailyEarnings>('/staff/today-earnings', 'GET', undefined, receptionist.cookie);
  assert.equal(frontDeskToday.status, 200);
  assert.equal(frontDeskToday.data.therapists.length, 6);
});

test('legacy pending holds still expire and release their allocation', () => {
  const state = initialDemoState(NOW);
  const pending = structuredClone(state.bookings[1]);
  pending.id = 'legacy-pending';
  pending.status = 'pending';
  pending.holdExpiresAt = new Date(NOW.getTime() + 30 * 60_000).toISOString();
  state.bookings = [pending];

  assert.equal(expirePending(state, new Date(NOW.getTime() + 29 * 60_000)).changed, false);
  const expired = expirePending(state, new Date(NOW.getTime() + 31 * 60_000));
  assert.equal(expired.changed, true);
  assert.equal(expired.state.bookings[0].status, 'expired');
  assert.ok(findDemoSchedule({
    date: pending.date,
    time: pending.time,
    guests: [specific(pending.assignments[0].therapistId, {
      categoryId: pending.guests[0].categoryId,
      itemId: pending.guests[0].itemId,
    })],
    groupTiming: 'together',
    therapists: expired.state.therapists,
    bookings: expired.state.bookings,
    now: NOW,
  }));
});

test('staff can create external bookings, manage statuses and cannot reopen terminal bookings', async (t) => {
  const { request, login } = await fixture(t);
  const receptionist = await login('receptionist');
  for (const [index, source] of (['phone', 'whatsapp', 'walk_in'] as const).entries()) {
    const created = await request('/staff/bookings', 'POST', input({ time: `${14 + index * 3}:00`, source, guests: [specific()] }), receptionist.cookie);
    assert.equal(created.status, 201);
    assert.equal(created.data.booking.status, 'confirmed');
    assert.equal(created.data.booking.source, source);
  }
  const created = await request('/staff/bookings', 'POST', input({ date: '2026-09-08', source: 'walk_in' }), receptionist.cookie);
  const path = `/staff/bookings/${created.data.booking.id}`;
  assert.equal((await request(path, 'PATCH', { action: 'status', status: 'completed' }, receptionist.cookie)).status, 409);
  for (const status of ['checked_in', 'in_service', 'completed']) assert.equal((await request(path, 'PATCH', { action: 'status', status }, receptionist.cookie)).status, 200);
  assert.equal((await request(path, 'PATCH', { action: 'status', status: 'confirmed' }, receptionist.cookie)).status, 409);
});

test('staff can record an agreed last-minute phone booking while the public notice rule remains', async (t) => {
  const clock = new Date('2026-09-05T02:45:00Z'); // 10:45 MYT
  const { request, login } = await fixture(t, { now: () => clock });
  const lastMinute = input({ date: '2026-09-05', time: '11:00', source: 'phone', guests: [guest({ itemId: 'body-30' })] });
  assert.equal((await request('/bookings', 'POST', lastMinute)).status, 400);
  const receptionist = await login('receptionist');
  const created = await request('/staff/bookings', 'POST', lastMinute, receptionist.cookie);
  assert.equal(created.status, 201);
  assert.equal(created.data.booking.status, 'confirmed');
});

test('counter add-ons extend only the selected guest and preserve locked prices and group allocations', async (t) => {
  const { request, login } = await fixture(t);
  const receptionist = await login('receptionist');
  const created = await request('/staff/bookings', 'POST', input({
    source: 'phone',
    guests: [
      specific('therapist-03', { categoryId: 'foot', itemId: 'foot-60', addOnIds: ['thai-balm'] }),
      specific('therapist-02', { id: 'guest-2', itemId: 'body-60', addOnIds: ['coconut-oil'] }),
    ],
  }), receptionist.cookie);
  assert.equal(created.status, 201);
  const before = created.data.booking;
  assert.equal(before.total, 136);
  const footSession = catalog.find((category) => category.id === 'foot')!.treatments.find((item) => item.id === 'foot-60')!;
  const originalPrice = footSession.price;
  let updated;
  try {
    // A later catalog edit must not reprice a treatment already sold.
    footSession.price = 150;
    updated = await request(`/staff/bookings/${before.id}`, 'PATCH', {
      action: 'add_addons', guestId: 'guest-1', addOnIds: ['herbal-bag'], source: 'counter', total: 1, price: 1,
    }, receptionist.cookie);
  } finally {
    footSession.price = originalPrice;
  }
  assert.equal(updated.status, 200);
  const after = updated.data.booking;
  assert.equal(after.total, 144);
  assert.equal(after.status, 'confirmed');
  assert.deepEqual(after.guests[0].addOnIds, ['thai-balm', 'herbal-bag']);
  assert.deepEqual(after.guests[1], before.guests[1]);
  assert.deepEqual(after.assignments[1], before.assignments[1]);
  assert.deepEqual(after.priceSnapshots!.find((snapshot) => snapshot.guestId === 'guest-2'), before.priceSnapshots![1]);
  const selectedPrice = after.priceSnapshots!.find((snapshot) => snapshot.guestId === 'guest-1')!;
  assert.equal(selectedPrice.itemPrice, 50);
  assert.equal(selectedPrice.total, 66);
  assert.deepEqual(selectedPrice.addOns.map(({ id, price }) => ({ id, price })), [
    { id: 'thai-balm', price: 8 }, { id: 'herbal-bag', price: 8 },
  ]);
  assert.deepEqual(after.assignments[0], { ...before.assignments[0], end: '15:20', cleanupEnd: '15:25' });
  assert.equal(after.addOnSales!.length, 1);
  const sale = after.addOnSales![0];
  assert.ok(sale.id);
  assert.equal(sale.guestId, 'guest-1');
  assert.equal(sale.therapistId, 'therapist-03');
  assert.equal(sale.addOnId, 'herbal-bag');
  assert.equal(sale.price, 8);
  assert.equal(sale.addedMinutes, 20);
  assert.equal(sale.source, 'counter');
  assert.equal(sale.recordedBy, receptionist.data.user.email);
  assert.equal(sale.addedAt, NOW.toISOString());
  assert.ok(sale.name.en && sale.name.zh);
  const publicState = JSON.stringify((await request('/public-state')).data);
  assert.equal(publicState.includes('addOnSales'), false);
  assert.equal(publicState.includes(sale.id), false);
  assert.equal(after.receiptToken, undefined, 'Receptionist responses never grant receipt capabilities');
  const owner = await login();
  const ownerBooking = (await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((booking) => booking.id === after.id)!;
  const receipt = await request<DemoBooking>(`/bookings/${after.id}?token=${ownerBooking.receiptToken}`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.data.total, 144);
  assert.equal(receipt.data.addOnSales![0].recordedBy, undefined);
  assert.equal(JSON.stringify(receipt.data).includes(receptionist.data.user.email), false);
});

test('in-service add-ons handle a past start and overrun, then count once in completed daily earnings', async (t) => {
  let clock = new Date(NOW);
  const { request, login } = await fixture(t, { now: () => clock });
  const owner = await login();
  const therapist = await login('s03');
  const created = await request('/staff/bookings', 'POST', input({
    date: '2026-09-05', time: '16:00', source: 'walk_in',
    guests: [specific('therapist-03', { categoryId: 'foot', itemId: 'foot-60' })],
  }), owner.cookie);
  assert.equal(created.status, 201);
  const path = `/staff/bookings/${created.data.booking.id}`;
  for (const status of ['checked_in', 'in_service']) {
    assert.equal((await request(path, 'PATCH', { action: 'status', status }, owner.cookie)).status, 200);
  }
  // Resolve the earlier sample treatment explicitly; it no longer releases
  // its therapist/chair automatically just because the planned end passed.
  clock = new Date('2026-09-05T07:00:00Z');
  assert.equal((await request('/staff/bookings/a103', 'PATCH', { action: 'status', status: 'completed' }, owner.cookie)).status, 200);
  clock = new Date('2026-09-05T08:15:00Z'); // The appointment began 15 minutes ago in Malaysia.
  const extra = { action: 'add_addons', guestId: 'guest-1', addOnIds: ['thai-balm'], source: 'during_service' };
  const added = await request(path, 'PATCH', extra, owner.cookie);
  assert.equal(added.status, 200);
  assert.equal(added.data.booking.total, 58);
  assert.deepEqual(added.data.booking.assignments, created.data.booking.assignments);
  assert.equal(added.data.booking.addOnSales![0].source, 'during_service');
  assert.equal(added.data.booking.addOnSales![0].addedMinutes, 0);
  assert.equal(added.data.booking.addOnSales![0].addedAt, clock.toISOString());
  const duplicate = await request(path, 'PATCH', extra, owner.cookie);
  assert.ok([400, 409].includes(duplicate.status));
  const stored = (await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((booking) => booking.id === created.data.booking.id)!;
  assert.deepEqual(stored, added.data.booking);
  clock = new Date('2026-09-05T09:07:00Z'); // Service is still running after its originally planned end.
  const extended = await request(path, 'PATCH', { ...extra, addOnIds: ['herbal-bag'] }, owner.cookie);
  assert.equal(extended.status, 200);
  assert.equal(extended.data.booking.total, 66);
  assert.deepEqual(extended.data.booking.assignments[0], {
    ...created.data.booking.assignments[0], end: '17:30', cleanupEnd: '17:35',
  });
  const beforeCompletion = await request<DemoDailyEarnings>('/staff/today-earnings', 'GET', undefined, therapist.cookie);
  assert.equal(beforeCompletion.data.gross, 50); // Earlier sample treatment only.
  assert.equal((await request(path, 'PATCH', { action: 'status', status: 'completed' }, owner.cookie)).status, 200);
  const earnings = await request<DemoDailyEarnings>('/staff/today-earnings', 'GET', undefined, therapist.cookie);
  assert.equal(earnings.data.gross, beforeCompletion.data.gross + 66);
  assert.equal(earnings.data.completedTreatments, 2);
  const line = earnings.data.therapists[0].lines.find((entry) => entry.bookingId === created.data.booking.id)!;
  assert.equal(line.gross, 66);
  assert.equal(line.addOns.length, 2);
});

test('late add-ons validate authorization, treatment compatibility, duplicate sales and included package extras', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login();
  const therapist = await login('s01');
  const created = await request('/staff/bookings', 'POST', input({
    guests: [specific('therapist-01', { itemId: 'body-60', addOnIds: ['coconut-oil'] })], source: 'phone',
  }), owner.cookie);
  assert.equal(created.status, 201);
  const path = `/staff/bookings/${created.data.booking.id}`;
  const valid = { action: 'add_addons', guestId: 'guest-1', addOnIds: ['thai-balm'], source: 'counter' };
  assert.equal((await request(path, 'PATCH', valid)).status, 401);
  assert.equal((await request(path, 'PATCH', valid, therapist.cookie)).status, 403);
  for (const invalid of [
    { ...valid, guestId: 'missing-guest' },
    { ...valid, addOnIds: [] },
    { ...valid, addOnIds: 'thai-balm' },
    { ...valid, addOnIds: ['thai-balm', 'thai-balm'] },
    { ...valid, addOnIds: ['coconut-oil'] },
    { ...valid, addOnIds: ['herbal-bag'] },
    { ...valid, addOnIds: ['cupping'] }, // This therapist cannot provide cupping.
    { ...valid, source: 'online' },
  ]) assert.equal((await request(path, 'PATCH', invalid, owner.cookie)).status, 400);
  const unchanged = (await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((booking) => booking.id === created.data.booking.id);
  assert.deepEqual(unchanged, created.data.booking);
  assert.equal((await request(path, 'PATCH', { action: 'status', status: 'checked_in' }, owner.cookie)).status, 200);
  assert.equal((await request(path, 'PATCH', valid, owner.cookie)).status, 200);
  const bundled = await request('/staff/bookings', 'POST', input({
    date: '2026-09-08', guests: [specific('therapist-02', { itemId: 'body-pkg-cupping' })], source: 'phone',
  }), owner.cookie);
  assert.equal(bundled.status, 201);
  assert.equal((await request(`/staff/bookings/${bundled.data.booking.id}`, 'PATCH', { ...valid, addOnIds: ['cupping'] }, owner.cookie)).status, 400);
});

test('late duration extras cannot overlap the next therapist or the existing chair allocation', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login();
  for (const [date, nextTherapist] of [['2026-09-07', 'therapist-03'], ['2026-09-08', 'therapist-05']]) {
    const first = await request('/staff/bookings', 'POST', input({
      date, source: 'phone', guests: [specific('therapist-03', { categoryId: 'foot', itemId: 'foot-60' })],
    }), owner.cookie);
    const next = await request('/staff/bookings', 'POST', input({
      date, time: '15:05', source: 'phone', guests: [specific(nextTherapist, { categoryId: 'foot', itemId: 'foot-60' })],
    }), owner.cookie);
    assert.equal(first.status, 201);
    assert.equal(next.status, 201);
    assert.deepEqual(first.data.booking.assignments[0].resourceIds, next.data.booking.assignments[0].resourceIds);
    const extension = await request(`/staff/bookings/${first.data.booking.id}`, 'PATCH', {
      action: 'add_addons', guestId: 'guest-1', addOnIds: ['herbal-bag'], source: 'counter',
    }, owner.cookie);
    assert.equal(extension.status, 409);
    assert.equal(extension.data.reason, 'conflict');
    assert.deepEqual(extension.data.alternatives, []);
    const state = (await request('/staff/state', 'GET', undefined, owner.cookie)).data;
    assert.deepEqual(state.bookings.find((booking) => booking.id === first.data.booking.id), first.data.booking);
    assert.deepEqual(state.bookings.find((booking) => booking.id === next.data.booking.id), next.data.booking);
  }
});

test('late extras honor therapist shift end and shop closing without changing the sale', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login();
  const first = await request('/staff/bookings', 'POST', input({
    source: 'phone', guests: [specific('therapist-03', { categoryId: 'foot', itemId: 'foot-60' })],
  }), owner.cookie);
  assert.equal(first.status, 201);
  assert.equal((await request('/staff/therapists/therapist-03', 'PATCH', { shiftEnd: '15:15' }, owner.cookie)).status, 200);
  const closing = await request('/staff/bookings', 'POST', input({
    date: '2026-09-08', time: '22:30', source: 'phone', guests: [specific('therapist-05', { categoryId: 'foot', itemId: 'foot-60' })],
  }), owner.cookie);
  assert.equal(closing.status, 201);
  for (const [booking, addOnId] of [[first.data.booking, 'herbal-bag'], [closing.data.booking, 'shoulder-30']] as const) {
    const result = await request(`/staff/bookings/${booking.id}`, 'PATCH', {
      action: 'add_addons', guestId: 'guest-1', addOnIds: [addOnId], source: 'counter',
    }, owner.cookie);
    assert.equal(result.status, 409);
    assert.equal(result.data.reason, 'conflict');
    const stored = (await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((entry) => entry.id === booking.id);
    assert.deepEqual(stored, booking);
  }
});

test('a concurrent late extension and next booking cannot both reserve the same therapist', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login();
  const first = await request('/staff/bookings', 'POST', input({
    source: 'phone', guests: [specific('therapist-03', { categoryId: 'foot', itemId: 'foot-60' })],
  }), owner.cookie);
  assert.equal(first.status, 201);
  const [extension, next] = await Promise.all([
    request(`/staff/bookings/${first.data.booking.id}`, 'PATCH', {
      action: 'add_addons', guestId: 'guest-1', addOnIds: ['herbal-bag'], source: 'counter',
    }, owner.cookie),
    request('/staff/bookings', 'POST', input({
      time: '15:05', source: 'phone', guests: [specific('therapist-03', { categoryId: 'foot', itemId: 'foot-60' })],
    }), owner.cookie),
  ]);
  assert.equal([extension, next].filter((response) => response.status === 200 || response.status === 201).length, 1);
  assert.equal([extension, next].filter((response) => response.status === 409).length, 1);
  const state = (await request('/staff/state', 'GET', undefined, owner.cookie)).data;
  const stored = state.bookings.find((booking) => booking.id === first.data.booking.id)!;
  if (extension.status === 200) {
    assert.equal(stored.total, 58);
    assert.equal(stored.assignments[0].cleanupEnd, '15:25');
    assert.equal(stored.addOnSales!.length, 1);
    assert.equal(state.bookings.filter((booking) => booking.date === '2026-09-07').length, 1);
  } else {
    assert.deepEqual(stored, first.data.booking);
    assert.equal(next.status, 201);
  }
});

test('completed, cancelled and no-show bookings reject late add-ons without changing their records', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login();
  const pathsToTerminal = [['checked_in', 'in_service', 'completed'], ['cancelled'], ['no_show']];
  for (const [index, statuses] of pathsToTerminal.entries()) {
    const created = await request('/staff/bookings', 'POST', input({
      date: `2026-09-${String(7 + index).padStart(2, '0')}`, source: 'phone', guests: [specific('therapist-01', { itemId: 'body-60' })],
    }), owner.cookie);
    assert.equal(created.status, 201);
    const path = `/staff/bookings/${created.data.booking.id}`;
    let terminal = created.data.booking;
    for (const status of statuses) {
      const result = await request(path, 'PATCH', { action: 'status', status }, owner.cookie);
      assert.equal(result.status, 200);
      terminal = result.data.booking;
    }
    assert.equal((await request(path, 'PATCH', {
      action: 'add_addons', guestId: 'guest-1', addOnIds: ['thai-balm'], source: 'counter',
    }, owner.cookie)).status, 409);
    const stored = (await request('/staff/state', 'GET', undefined, owner.cookie)).data.bookings.find((booking) => booking.id === terminal.id);
    assert.deepEqual(stored, terminal);
  }
});

test('conflicting reschedules preserve original allocations; reassignment respects required therapist', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login();
  const first = await request('/staff/bookings', 'POST', input({ guests: [specific()], source: 'phone' }), owner.cookie);
  const second = await request('/staff/bookings', 'POST', input({ time: '18:00', guests: [specific()], source: 'phone' }), owner.cookie);
  const result = await request(`/staff/bookings/${second.data.booking.id}`, 'PATCH', { action: 'reschedule', date: '2026-09-07', time: '15:00' }, owner.cookie);
  assert.equal(result.status, 409);
  const state: DemoState = (await request('/staff/state', 'GET', undefined, owner.cookie)).data;
  assert.deepEqual(state.bookings.find((b) => b.id === second.data.booking.id)?.assignments, second.data.booking.assignments);
  const reassign = await request(`/staff/bookings/${first.data.booking.id}`, 'PATCH', { action: 'reassign', guestId: 'guest-1', therapistId: 'therapist-02' }, owner.cookie);
  assert.equal(reassign.status, 409);
  const ordinary = await request('/staff/bookings', 'POST', input({ date: '2026-09-08', source: 'phone' }), owner.cookie);
  const successful = await request(`/staff/bookings/${ordinary.data.booking.id}`, 'PATCH', { action: 'reassign', guestId: 'guest-1', therapistId: 'therapist-02' }, owner.cookie);
  assert.equal(successful.data.booking.assignments[0].therapistId, 'therapist-02');
});

test('owner profile changes and receptionist schedules enforce permissions and existing assignments', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login(); const receptionist = await login('receptionist');
  const state: DemoState = (await request('/staff/state', 'GET', undefined, owner.cookie)).data;
  const profile = state.therapists[0];
  assert.equal((await request(`/staff/therapists/${profile.id}`, 'PATCH', { ...profile, name: { en: 'New', zh: '新' } }, receptionist.cookie)).status, 403);
  assert.equal((await request(`/staff/therapists/${profile.id}`, 'PATCH', { ...profile, leaveDates: ['2026-09-09'] }, receptionist.cookie)).status, 200);
  assert.equal((await request(`/staff/therapists/${profile.id}`, 'PATCH', { ...profile, leaveDates: ['2026-09-06'] }, owner.cookie)).status, 409);
  assert.equal((await request(`/staff/therapists/${profile.id}`, 'PATCH', { ...profile, name: { en: 'Updated sample', zh: '新样本' } }, owner.cookie)).status, 200);
  assert.equal((await request('/staff/reset', 'POST', {}, receptionist.cookie)).status, 403);
  assert.equal((await request('/staff/reset', 'POST', {}, owner.cookie)).status, 200);
});

test('owner cannot change gender when it would break an active required-gender booking', async (t) => {
  const { request, login } = await fixture(t);
  const owner = await login();
  const requiredFemale = guest({ therapistChoice: { mode: 'gender', requirement: 'required', gender: 'female', therapistId: '' } });
  const created = await request('/staff/bookings', 'POST', input({ date: '2026-09-08', source: 'phone', guests: [requiredFemale] }), owner.cookie);
  assert.equal(created.status, 201);
  const assignedId = created.data.booking.assignments[0].therapistId;
  const state: DemoState = (await request('/staff/state', 'GET', undefined, owner.cookie)).data;
  const profile = state.therapists.find((entry) => entry.id === assignedId)!;
  assert.equal(profile.gender, 'female');
  assert.equal((await request(`/staff/therapists/${profile.id}`, 'PATCH', { ...profile, gender: 'male' }, owner.cookie)).status, 409);
});

test('SQLite persists sample bookings across a backend restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'serene-demo-test-'));
  t.after(async () => { rmSync(directory, { recursive: true, force: true }); });
  const dbPath = join(directory, 'test.sqlite');
  let closeFirst: (() => Promise<void>) | undefined;
  const first = await fixture({ after: (fn) => { closeFirst = fn; } }, { dbPath });
  const created = await first.request('/bookings', 'POST', input());
  await closeFirst!();
  const second = await fixture(t, { dbPath });
  const owner = await second.login();
  const state: DemoState = (await second.request('/staff/state', 'GET', undefined, owner.cookie)).data;
  assert.ok(state.bookings.some((booking: DemoBooking) => booking.id === created.data.booking.id));
});
