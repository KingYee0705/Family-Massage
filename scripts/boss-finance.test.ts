import test from 'node:test';
import assert from 'node:assert/strict';
import { initialDemoState, type DemoBooking, type DemoState } from '../app/demo-booking.ts';
import { calculateBossMonth, initialBossFinance, type BossFinanceState } from './boss-finance.ts';

const NOW = new Date('2026-09-10T04:00:00Z');

function fixture() {
  const state = initialDemoState(NOW);
  state.bookings = [];
  const finance = initialBossFinance(state);
  return { state, finance };
}

function booking(overrides: Partial<DemoBooking> = {}): DemoBooking {
  const original = initialDemoState(NOW).bookings[0];
  return { ...original, date: '2026-09-04', ...overrides };
}

function withPrice(value: number, therapistId = 'therapist-01', id = 'sale-1'): DemoBooking {
  const result = booking({ id, reference: id, total: value });
  result.assignments[0].therapistId = therapistId;
  result.priceSnapshots = [{
    guestId: result.guests[0].id,
    category: { en: 'Full Body Massage', zh: '全身按摩' },
    item: { en: 'Saved 1-hour treatment', zh: '已记录的一小时疗程' },
    itemPrice: value, addOns: [], total: value,
  }];
  return result;
}

function therapist(state: DemoState, finance: BossFinanceState, id = 'therapist-01', month = '2026-09') {
  return calculateBossMonth(state, finance, month, NOW).therapists.find((entry) => entry.therapistId === id)!;
}

test('treatment, prebooked extras and later full-price extras each earn 50% exactly once', () => {
  const { state, finance } = fixture();
  const sale = withPrice(86);
  sale.guests[0].addOnIds = ['coconut-oil', 'thai-balm'];
  sale.priceSnapshots![0].itemPrice = 68;
  sale.priceSnapshots![0].addOns = [
    { id: 'coconut-oil', name: { en: 'Coconut oil', zh: '椰油' }, price: 10 },
    { id: 'thai-balm', name: { en: 'Thai balm', zh: '泰风油' }, price: 8 },
  ];
  sale.addOnSales = [{
    id: 'extra-1', guestId: sale.guests[0].id, therapistId: 'therapist-01', addOnId: 'thai-balm',
    name: { en: 'Thai balm', zh: '泰风油' }, price: 8, addedMinutes: 0,
    source: 'during_service', addedAt: '2026-09-04T03:30:00Z',
  }];
  state.bookings = [sale];
  const result = therapist(state, finance);
  assert.equal(result.serviceCents, 6800);
  assert.equal(result.bookedExtrasCents, 1000);
  assert.equal(result.laterExtrasCents, 800);
  assert.equal(result.grossCents, 8600);
  assert.equal(result.commissionCents, 4300);
  assert.equal(result.shopShareCents, 4300);
  assert.equal(result.completedTreatments, 1);
  assert.equal(result.days[3].lines[0].extras.length, 2);
  assert.deepEqual(result.days[3].lines[0].extras.map((extra) => extra.source), ['booking', 'during_service']);
});

test('stored sale prices and agreed total stay fixed even when the current catalog differs', () => {
  const { state, finance } = fixture();
  const sale = withPrice(63);
  sale.guests[0].addOnIds = ['thai-balm'];
  sale.priceSnapshots![0].itemPrice = 60;
  sale.priceSnapshots![0].addOns = [{ id: 'thai-balm', name: { en: 'Historic balm', zh: '旧价格泰风油' }, price: 3 }];
  sale.addOnSales = [{
    id: 'extra-old', guestId: sale.guests[0].id, therapistId: 'therapist-01', addOnId: 'thai-balm',
    name: { en: 'Historic balm', zh: '旧价格泰风油' }, price: 3, addedMinutes: 0,
    source: 'counter', addedAt: '2026-09-04T03:00:00Z',
  }];
  state.bookings = [sale];
  const result = therapist(state, finance);
  assert.equal(result.grossCents, 6300);
  assert.equal(result.serviceCents, 6000);
  assert.equal(result.laterExtrasCents, 300);
  assert.equal(result.commissionCents, 3150);
  assert.equal(result.days[3].lines[0].service.en, 'Full Body Massage · Saved 1-hour treatment');
  assert.equal(result.days[3].lines[0].service.zh, '全身按摩 · 已记录的一小时疗程');
  assert.equal(result.days[3].lines[0].extras[0].priceCents, 300);
});

test('old seed records fall back to the catalog and packages keep included extras inside service sales', () => {
  const { state, finance } = fixture();
  const plain = booking();
  const bundle = booking({ id: 'bundle' });
  bundle.guests[0].itemId = 'body-pkg-cupping';
  bundle.assignments[0].therapistId = 'therapist-02';
  state.bookings = [plain, bundle];
  const result = calculateBossMonth(state, finance, '2026-09', NOW);
  assert.equal(result.therapists[0].grossCents, 6800);
  assert.equal(result.therapists[1].serviceCents, 9500);
  assert.equal(result.therapists[1].bookedExtrasCents, 0);
  assert.equal(result.therapists[1].laterExtrasCents, 0);
  assert.equal(result.totals.grossCents, 16300);
});

test('commission is rounded once per therapist per month and shop shares exactly reconcile', () => {
  const { state, finance } = fixture();
  state.bookings = [withPrice(0.01), withPrice(0.01, 'therapist-01', 'sale-2'), withPrice(0.01, 'therapist-02', 'sale-3')];
  const result = calculateBossMonth(state, finance, '2026-09', NOW);
  assert.equal(result.therapists[0].commissionCents, 1, 'Two half-sen treatments round only once at month end');
  assert.equal(result.therapists[1].commissionCents, 1);
  assert.equal(result.totals.commissionCents, 2);
  assert.equal(result.totals.shopShareCents, 1);
  assert.equal(result.totals.grossCents, result.totals.commissionCents + result.totals.shopShareCents);
  assert.ok(result.therapists[0].netCents < 0, 'A deduction shortfall stays visible and is not silently clamped');
});

test('only completed treatments in the booking month count; every calendar day and inactive therapist is present', () => {
  const { state, finance } = fixture();
  state.therapists[0].active = false;
  state.bookings = [
    booking(), booking({ id: 'confirmed', status: 'confirmed' }), booking({ id: 'cancelled', status: 'cancelled' }),
    booking({ id: 'in-service', status: 'in_service' }), booking({ id: 'previous', date: '2026-08-31' }),
    booking({ id: 'future', date: '2026-10-01' }),
  ];
  const result = calculateBossMonth(state, finance, '2026-09', NOW);
  assert.equal(result.totals.completedTreatments, 1);
  assert.equal(result.totals.grossCents, 6800);
  assert.equal(result.therapists.length, 6);
  assert.equal(result.therapists[0].active, false);
  assert.equal(result.therapists[0].days.length, 30);
  assert.equal(result.therapists[0].days[0].grossCents, 0);
  assert.equal(result.therapists[0].days[3].grossCents, 6800);
  assert.equal(calculateBossMonth(state, finance, '2024-02', NOW).therapists[0].days.length, 29);
});

test('a removed therapist is recovered from historical snapshots without losing assigned group sales', () => {
  const { state, finance } = fixture();
  const sale = withPrice(68);
  const secondGuest = { ...sale.guests[0], id: 'second-guest', name: 'Second guest' };
  sale.guests.push(secondGuest);
  sale.assignments.push({ ...sale.assignments[0], guestId: secondGuest.id, therapistId: 'former-therapist' });
  sale.priceSnapshots!.push({ ...sale.priceSnapshots![0], guestId: secondGuest.id, itemPrice: 80, total: 80 });
  sale.therapistSnapshots = [{ guestId: secondGuest.id, therapistId: 'former-therapist', staffNumber: 'S00', name: { en: 'Former staff', zh: '前员工' } }];
  state.bookings = [sale];
  const result = calculateBossMonth(state, finance, '2026-09', NOW);
  const former = result.therapists.find((entry) => entry.therapistId === 'former-therapist')!;
  assert.equal(former.name.en, 'Former staff');
  assert.equal(former.active, false);
  assert.equal(former.grossCents, 8000);
  assert.equal(result.totals.grossCents, 14800);
  assert.equal(result.totals.completedTreatments, 2);
});

test('fixed amounts vary by therapist, effective dates preserve earlier months and month overrides do not leak', () => {
  const { state, finance } = fixture();
  assert.notEqual(finance.settings[0].rentalCents, finance.settings[1].rentalCents);
  finance.settings.push({ therapistId: 'therapist-01', effectiveMonth: '2026-09', rentalCents: 40000, electricityCents: 9000 });
  finance.overrides.push({ month: '2026-09', therapistId: 'therapist-01', rentalCents: 45000, electricityCents: 9100 });
  assert.equal(therapist(state, finance, 'therapist-01', '2026-08').rentalCents, 20000);
  assert.equal(therapist(state, finance).rentalCents, 45000);
  assert.equal(therapist(state, finance).electricityCents, 9100);
  assert.equal(therapist(state, finance, 'therapist-01', '2026-10').rentalCents, 40000);
  assert.equal(therapist(state, finance, 'therapist-01', '2026-10').electricityCents, 9000);
  assert.equal(therapist(state, finance, 'therapist-02').rentalCents, 30000);
});

test('financial revisions ignore read times and audit metadata, but detect changed sales', () => {
  const { state, finance } = fixture();
  state.bookings = [withPrice(68)];
  const originalState = structuredClone(state);
  const originalFinance = structuredClone(finance);
  const first = calculateBossMonth(state, finance, '2026-09', NOW);
  assert.deepEqual(state, originalState);
  assert.deepEqual(finance, originalFinance);
  finance.audit.push({ id: 'audit-1', month: '2026-09', at: NOW.toISOString(), actor: 'owner', action: 'Viewed statement' });
  const second = calculateBossMonth(state, finance, '2026-09', new Date('2026-09-11T03:00:00Z'));
  assert.notEqual(first.generatedAt, second.generatedAt);
  assert.equal(first.revision, second.revision);
  state.bookings.push(withPrice(76, 'therapist-01', 'new-sale'));
  assert.notEqual(calculateBossMonth(state, finance, '2026-09', NOW).revision, first.revision);
});

test('closed reports retain saved prices, deductions and daily rows despite later edits', () => {
  const { state, finance } = fixture();
  state.bookings = [withPrice(68)];
  const saved = calculateBossMonth(state, finance, '2026-09', NOW);
  finance.statements.push({ id: 'statement-1', month: '2026-09', savedAt: NOW.toISOString(), savedBy: 'owner@serene.demo', report: structuredClone(saved) });
  finance.closed['2026-09'] = 'statement-1';
  finance.overrides.push({ month: '2026-09', therapistId: 'therapist-01', rentalCents: 90000, electricityCents: 8000 });
  state.bookings[0].priceSnapshots![0].total = 999;
  state.therapists[0].name.en = 'Changed profile name';
  const result = calculateBossMonth(state, finance, '2026-09', new Date('2026-10-01T03:00:00Z'));
  assert.equal(result.status, 'closed');
  assert.equal(result.statementId, 'statement-1');
  assert.equal(result.savedAt, NOW.toISOString());
  assert.deepEqual(result.therapists, saved.therapists);
  assert.deepEqual(result.totals, saved.totals);
  assert.equal(result.revision, saved.revision);
  assert.equal(result.statementHistory.length, 1);
  result.therapists[0].days[3].lines[0].grossCents = 0;
  assert.equal(finance.statements[0].report.therapists[0].days[3].lines[0].grossCents, 6800, 'Returned report cannot mutate the saved statement');
});

test('statement and audit history keep newest insertion first when timestamps match', () => {
  const { state, finance } = fixture();
  const report = calculateBossMonth(state, finance, '2026-09', NOW);
  for (const id of ['older-z', 'newer-a']) {
    finance.statements.push({ id, month: '2026-09', savedAt: NOW.toISOString(), savedBy: 'owner', report });
    finance.audit.push({ id, month: '2026-09', at: NOW.toISOString(), actor: 'owner', action: id });
  }
  const original = structuredClone(finance);
  const result = calculateBossMonth(state, finance, '2026-09', NOW);
  assert.deepEqual(result.statementHistory.map((entry) => entry.id), ['newer-a', 'older-z']);
  assert.deepEqual(result.audit.map((entry) => entry.id), ['newer-a', 'older-z']);
  assert.deepEqual(finance, original);
});

test('month choices use Malaysia local time, retain older saved/booking months and omit future months', () => {
  const { state, finance } = fixture();
  state.bookings = [booking({ date: '2022-01-01' }), booking({ id: 'future', date: '2027-01-01' })];
  const now = new Date('2026-08-31T17:00:00Z');
  const report = calculateBossMonth(state, finance, '2026-09', now);
  const older = calculateBossMonth(state, finance, '2020-05', now);
  finance.statements.push({ id: 'old', month: '2020-05', savedAt: now.toISOString(), savedBy: 'owner', report: older });
  const months = calculateBossMonth(state, finance, '2026-09', now).availableMonths;
  assert.equal(report.availableMonths[0], '2026-09');
  assert.ok(months.includes('2025-09'));
  assert.ok(months.includes('2022-01'));
  assert.ok(months.includes('2020-05'));
  assert.ok(!months.includes('2027-01'));
  assert.throws(() => calculateBossMonth(state, finance, '2026-13', now), /valid month/);
});
