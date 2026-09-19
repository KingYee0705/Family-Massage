import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, changeTherapistChoice, isGuestReady, matchingTherapists } from './booking-flow.ts';
import { emptyTherapistChoice, sampleTherapists } from './demo-booking.ts';
import type { GuestSelection } from './catalog.ts';

const guest: GuestSelection = { id: 'g', name: '', categoryId: 'full-body', itemId: 'body-60', addOnIds: [], therapistPreference: '' };
test('gender and specific choices keep compatible therapists only', () => {
  for (const gender of ['male', 'female'] as const) {
    const result = matchingTherapists({ ...guest, therapistChoice: { ...emptyTherapistChoice(), mode: 'gender', gender, requirement: 'required' } }, sampleTherapists);
    assert.ok(result.length);
    assert.ok(result.every((person) => person.gender === gender));
  }
  assert.equal(matchingTherapists({ ...guest, therapistChoice: { ...emptyTherapistChoice(), mode: 'specific', therapistId: 'therapist-01', requirement: 'required' } }, sampleTherapists)[0].id, 'therapist-01');
});
test('changing to an incompatible therapist clears treatment without changing the person', () => {
  const choice = { ...emptyTherapistChoice(), mode: 'specific', therapistId: 'therapist-01', requirement: 'required' } as const;
  const next = changeTherapistChoice({ ...guest, categoryId: 'thai', itemId: 'thai-60' }, choice, sampleTherapists);
  assert.equal(next.itemId, '');
  assert.deepEqual(next.therapistChoice, choice);
  assert.equal(isGuestReady(next, sampleTherapists), false);
});
test('preferred fallback permits busy-person substitution but not unsupported treatments', () => {
  const choice = { ...emptyTherapistChoice(), mode: 'specific', therapistId: 'therapist-01', requirement: 'preferred' } as const;
  assert.ok(matchingTherapists({ ...guest, therapistChoice: choice }, sampleTherapists).length > 1);
  assert.equal(matchingTherapists({ ...guest, categoryId: 'thai', itemId: 'thai-60', therapistChoice: choice }, sampleTherapists).length, 0);
});
test('date strip crosses month and year boundaries', () => {
  assert.deepEqual(calendarDays('2026-12-31', 3), ['2026-12-31', '2027-01-01', '2027-01-02']);
});
