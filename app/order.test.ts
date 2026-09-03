import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderMessage, buildWhatsAppUrl, createReference, guestTotal, isFutureAppointment, orderTotal } from './order.ts';
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
  assert.match(message, /_Pending staff confirmation_\n\n\*APPOINTMENT\*/);
  assert.match(message, /Date: Fri, 4 Sept 2026\nTime: 14:30\nGuests: 1\n\n/);
  assert.match(message, /\*GUEST 1 - Maya\*/);
  assert.match(message, /Service: Full Body Massage/);
  assert.match(message, /Session: 1 hour \(RM 68\)/);
  assert.match(message, /Add-ons:\n- Coconut oil \(RM 10\)/);
  assert.match(message, /\*CUSTOMER\*[\s\S]*Name: Maya Lee[\s\S]*WhatsApp: 0123456789/);
  assert.match(message, /\*ESTIMATED TOTAL: RM 98\*/);
  assert.match(message, /\*STAFF ACTION\*\nPlease reply to confirm/);
  assert.doesNotMatch(message, /📅|🕐|👥/);
  const url = buildWhatsAppUrl(message);
  assert.ok(url?.startsWith('https://wa.me/6589160743?text='));
  assert.match(decodeURIComponent(url!), /Maya Lee/);
});
