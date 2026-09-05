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
    date: '2026-09-04',
    time: '14:30',
    contactName: 'Maya Lee',
    contactPhone: '0123456789',
    notes: '',
  }, new Date('2026-09-03T12:00:00'));

  assert.deepEqual(issues, []);
});

test('creates inclusive 30-minute booking time choices', () => {
  const slots = createTimeSlots('10:00', '21:30', 30);
  assert.equal(slots.length, 24);
  assert.equal(slots[0], '10:00');
  assert.equal(slots.at(-1), '21:30');
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
  assert.equal(estimatedGuestDuration(guest), 90);
});

test('disables a start time when overlapping services exceed estimated staff capacity', () => {
  const longGuest = { ...guest, itemId: 'body-120', addOnIds: [] };
  const now = new Date('2026-09-03T12:00:00');
  const oneGuestSlots = estimateTimeSlotAvailability([longGuest], '2026-09-04', now);
  const twoGuestSlots = estimateTimeSlotAvailability([longGuest, { ...longGuest, id: 'guest-2' }], '2026-09-04', now);

  assert.equal(oneGuestSlots.find((slot) => slot.time === '14:00')?.available, true);
  assert.equal(twoGuestSlots.find((slot) => slot.time === '14:00')?.available, false);
  assert.equal(oneGuestSlots.find((slot) => slot.time === '20:00')?.available, false);
});

test('creates a stable-format reference', () => {
  assert.equal(createReference(new Date('2026-09-03T12:00:00'), 0), 'SFM-260903-0000');
});

test('formats a complete WhatsApp request', () => {
  const draft: BookingDraft = {
    guests: [guest],
    date: '2026-09-04',
    time: '14:30',
    contactName: 'Maya Lee',
    contactPhone: '0123456789',
    notes: 'Quiet room, please',
  };
  const message = buildOrderMessage(draft, 'SFM-260903-ABCD', 'en');
  assert.match(message, /\*NEW BOOKING REQUEST\*/);
  assert.match(message, /_Pending staff confirmation_\n\n\*APPOINTMENT\*\n\n/);
  assert.match(message, /Date: Fri, 4 Sept 2026\nTime: 14:30\nGuests: 1\n\n/);
  assert.match(message, /\*GUEST 1 - Maya\*\n\nService/);
  assert.match(message, /Service: Full Body Massage/);
  assert.match(message, /Session: 1 hour \(RM 68\)/);
  assert.match(message, /\n\nAdd-ons:\n- Coconut oil \(RM 10\)/);
  assert.match(message, /\*CUSTOMER\*\n\nName: Maya Lee[\s\S]*WhatsApp: 0123456789/);
  assert.match(message, /\*ESTIMATED TOTAL: RM 98\*/);
  assert.match(message, /\*STAFF ACTION\*\n\nPlease reply to confirm this time or suggest the nearest available time\./);
  assert.match(message, /requested time is not reserved until staff confirms it/);
  assert.doesNotMatch(message, /📅|🕐|👥/);
  const url = buildWhatsAppUrl(message);
  assert.ok(url?.startsWith('https://wa.me/6589160743?text='));
  assert.match(decodeURIComponent(url!), /Maya Lee/);
});
