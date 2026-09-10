import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingSettings, catalog } from './catalog.ts';
import { buildOrderMessage, buildWhatsAppUrl, createReference, createTimeSlots, estimateTimeSlotAvailability, estimatedGuestDuration, getBookingValidationIssues, guestTotal, isFutureAppointment, orderTotal } from './order.ts';
import type { BookingDraft } from './order.ts';

const guest = {
  id: 'guest-1',
  name: 'Maya',
  categoryId: 'full-body',
  itemId: 'body-60',
  addOnIds: ['coconut-oil', 'ear-candling'],
  therapistPreference: 'Amy',
};

test('calculates treatments and category add-ons', () => {
  assert.equal(guestTotal(guest), 98);
  assert.equal(orderTotal([guest, { ...guest, id: 'guest-2', addOnIds: [] }]), 166);
});

test('matches every price shown on the four supplied shop menus', () => {
  const expected: Record<string, Record<string, number>> = {
    aromatherapy: {
      'aroma-60': 85, 'aroma-90': 125, 'aroma-120': 150,
      'aroma-pkg-ear': 140, 'aroma-pkg-cupping': 150, 'aroma-pkg-guasha': 150, 'aroma-pkg-foot': 125,
      'ear-candling': 20, 'gua-sha': 35, cupping: 35, 'fire-cupping': 45, 'bleeding-cupping': 55, 'body-scrubbing': 55,
    },
    thai: {
      'thai-60': 80, 'thai-90': 100, 'thai-120': 140,
      'thai-pkg-cupping': 105, 'thai-pkg-guasha': 105, 'thai-pkg-foot': 120, 'thai-pkg-ear': 120, 'thai-pkg-scrub': 125,
      'thai-balm': 8, 'ear-candling': 20, 'gua-sha': 35, cupping: 35, 'fire-cupping': 45, 'bleeding-cupping': 55, 'body-scrubbing': 55,
    },
    'full-body': {
      'body-30': 45, 'body-60': 68, 'body-90': 100, 'body-120': 130,
      'body-pkg-cupping': 95, 'body-pkg-guasha': 95, 'body-pkg-foot': 110, 'body-pkg-ear': 110, 'body-pkg-scrub': 115,
      'thai-balm': 8, 'coconut-oil': 10, 'aroma-oil': 15, 'ear-candling': 20, 'gua-sha': 35, cupping: 35, 'fire-cupping': 45, 'bleeding-cupping': 55, 'body-scrubbing': 55,
    },
    foot: {
      'foot-30': 38, 'foot-60': 50, 'foot-90': 75, 'foot-120': 98,
      'foot-pkg-scrub': 65, 'foot-pkg-cupping': 80, 'foot-pkg-shoulder': 85, 'foot-pkg-body-30': 85, 'foot-pkg-body-first': 95, 'foot-pkg-body-60': 110,
      'herbal-bag': 8, 'thai-balm': 8, 'coconut-oil': 10, 'ear-candling': 20, 'foot-scrubbing': 20, 'gua-sha': 35, cupping: 35, 'fire-cupping': 45, 'shoulder-15': 20, 'shoulder-30': 40,
    },
  };

  for (const category of catalog) {
    const actual = Object.fromEntries([...category.treatments, ...category.packages, ...category.addOns].map((entry) => [entry.id, entry.price]));
    assert.deepEqual(actual, expected[category.id], category.id);
  }
});

test('supports a six-person group', () => {
  assert.equal(orderTotal(Array.from({ length: 6 }, (_, index) => ({ ...guest, id: String(index) }))), 588);
});

test('checks that the requested time is in the future', () => {
  const now = new Date('2026-09-03T12:00:00');
  assert.equal(isFutureAppointment('2026-09-03', '12:30', now), true);
  assert.equal(isFutureAppointment('2026-09-03', '11:30', now), false);
});

test('lists every missing booking detail for the validation checklist', () => {
  const issues = getBookingValidationIssues({
    guests: [{ ...guest, itemId: '' }],
    groupTiming: 'together',
    date: '',
    time: '',
    contactName: '',
    contactPhone: '123',
    notes: '',
  });

  assert.deepEqual(issues.map((issue) => issue.kind), [
    'guest_service',
    'date_required',
    'time_required',
    'contact_name',
    'contact_phone',
  ]);
});

test('accepts a complete future booking with no validation issues', () => {
  const issues = getBookingValidationIssues({
    guests: [guest],
    groupTiming: 'together',
    date: '2026-09-04',
    time: '14:30',
    contactName: 'Maya Lee',
    contactPhone: '0123456789',
    notes: '',
  }, new Date('2026-09-03T12:00:00'));

  assert.deepEqual(issues, []);
});

test('reports a booking that does not meet the one-hour notice rule', () => {
  const issues = getBookingValidationIssues({
    guests: [guest],
    groupTiming: 'together',
    date: '2026-09-03',
    time: '12:30',
    contactName: 'Maya Lee',
    contactPhone: '0123456789',
    notes: '',
  }, new Date('2026-09-03T12:00:00'));

  assert.deepEqual(issues.map((issue) => issue.kind), ['minimum_notice']);
});

test('creates inclusive 30-minute booking time choices', () => {
  const slots = createTimeSlots('10:00', '21:30', 30);
  assert.equal(slots.length, 24);
  assert.equal(slots[0], '10:00');
  assert.equal(slots.at(-1), '21:30');
});

test('enforces the one-hour minimum booking notice', () => {
  const now = new Date('2026-09-03T12:00:00');
  assert.equal(isFutureAppointment('2026-09-03', '12:30', now, bookingSettings.minimumLeadMinutes), false);
  assert.equal(isFutureAppointment('2026-09-03', '13:00', now, bookingSettings.minimumLeadMinutes), true);
});

test('has an estimated duration for every service and add-on', () => {
  for (const category of catalog) {
    for (const item of category.treatments.concat(category.packages)) {
      assert.ok(bookingSettings.estimatedItemDurationMinutes[item.id as keyof typeof bookingSettings.estimatedItemDurationMinutes] > 0, item.id);
    }
    for (const extra of category.addOns) {
      assert.notEqual(bookingSettings.estimatedAddOnDurationMinutes[extra.id as keyof typeof bookingSettings.estimatedAddOnDurationMinutes], undefined, extra.id);
    }
  }
});

test('adds estimated add-on time to a guest visit', () => {
  assert.equal(estimatedGuestDuration(guest), 80);
});

test('disables a start time when overlapping services exceed estimated staff capacity', () => {
  const longGuest = { ...guest, itemId: 'body-120', addOnIds: [] };
  const now = new Date('2026-09-03T12:00:00');
  const oneGuestSlots = estimateTimeSlotAvailability([longGuest], '2026-09-04', now);
  const twoGuestSlots = estimateTimeSlotAvailability([longGuest, { ...longGuest, id: 'guest-2' }], '2026-09-04', now);

  assert.equal(oneGuestSlots.find((slot) => slot.time === '14:00')?.available, true);
  assert.equal(twoGuestSlots.find((slot) => slot.time === '14:00')?.available, false);
  assert.equal(oneGuestSlots.find((slot) => slot.time === '22:00')?.available, false);
});

test('creates a stable-format reference', () => {
  assert.equal(createReference(new Date('2026-09-03T12:00:00'), 0), 'SFM-260903-0000');
});

test('formats a complete WhatsApp booking draft', () => {
  const draft: BookingDraft = {
    guests: [guest],
    groupTiming: 'together',
    date: '2026-09-04',
    time: '14:30',
    contactName: 'Maya Lee',
    contactPhone: '0123456789',
    notes: 'Quiet room, please',
  };
  const message = buildOrderMessage(draft, 'SFM-260903-ABCD', 'en');
  assert.match(message, /\*NEW BOOKING DRAFT\*/);
  assert.match(message, /_Live capacity has not been checked_\n\n\*APPOINTMENT\*\n\n/);
  assert.match(message, /Date: Fri, 4 Sept 2026\nTime: 14:30\nGuests: 1\n\n/);
  assert.match(message, /\*GUEST 1 - Maya\*\n\nService/);
  assert.match(message, /Service: Full Body Massage/);
  assert.match(message, /Session: 1 hour \(RM 68\)/);
  assert.match(message, /\n\nAdd-ons:\n- Coconut oil \(RM 10\)/);
  assert.match(message, /\*CUSTOMER\*\n\nName: Maya Lee[\s\S]*WhatsApp: 0123456789/);
  assert.match(message, /\*ESTIMATED TOTAL: RM 98\*/);
  assert.match(message, /\*STAFF ACTION\*\n\nSubmit this draft through the live booking system before treating it as reserved\./);
  assert.match(message, /not reserved until the live capacity check succeeds/);
  assert.doesNotMatch(message, /📅|🕐|👥/);
  const url = buildWhatsAppUrl(message);
  assert.ok(url?.startsWith('https://wa.me/6589160743?text='));
  assert.match(decodeURIComponent(url!), /Maya Lee/);
});
