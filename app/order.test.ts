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
  assert.match(message, /Maya Lee/);
  assert.match(message, /Full Body/);
  assert.match(message, /Estimated total: RM 98/);
  assert.match(message, /pending staff confirmation/);
  const url = buildWhatsAppUrl(message);
  assert.ok(url?.startsWith('https://wa.me/6589160743?text='));
  assert.match(decodeURIComponent(url!), /Maya Lee/);
});
