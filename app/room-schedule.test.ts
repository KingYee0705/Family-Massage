import test from 'node:test';
import assert from 'node:assert/strict';
import { initialDemoState } from './demo-booking.ts';
import { roomSchedule, shopResources } from './room-schedule.ts';

const now = new Date('2026-09-19T06:00:00Z');
const date = '2026-09-19';
function fixture() {
  const state = initialDemoState(now);
  const booking = structuredClone(state.bookings[0]);
  booking.date = date; booking.time = '14:00'; booking.status = 'confirmed';
  booking.assignments[0] = { ...booking.assignments[0], start: '14:00', end: '16:00', cleanupEnd: '16:05', resourceIds: ['bed-1'] };
  state.bookings = [booking];
  return state;
}
test('six separate rooms and six separate chairs', () => {
  assert.equal(shopResources.filter((r) => r.kind === 'room').length, 6);
  assert.equal(shopResources.filter((r) => r.kind === 'chair').length, 6);
});
test('two-hour appointment occupies room through cleaning, then releases exactly at 16:05', () => {
  const state = fixture();
  for (const time of ['14:00', '15:00', '15:59']) assert.equal(roomSchedule(state, date, time, now).freeRooms, 5);
  assert.equal(roomSchedule(state, date, '16:00', now).resources[0].status, 'cleaning');
  assert.equal(roomSchedule(state, date, '16:04', now).freeRooms, 5);
  assert.equal(roomSchedule(state, date, '16:05', now).freeRooms, 6);
  assert.equal(roomSchedule(state, date, '13:00', now).resources[0].next?.assignment.start, '14:00');
});
test('mixed-resource guest is counted once, group guests separately', () => {
  const state = fixture(); const booking = state.bookings[0];
  booking.assignments[0].resourceIds.push('chair-1');
  let report = roomSchedule(state, date, '14:00', now);
  assert.equal(report.customers, 1); assert.equal(report.freeRooms, 5); assert.equal(report.freeChairs, 5);
  booking.guests.push({ ...booking.guests[0], id: 'second' });
  booking.assignments.push({ ...booking.assignments[0], guestId: 'second', therapistId: 'therapist-02', resourceIds: ['bed-2'] });
  report = roomSchedule(state, date, '14:00', now);
  assert.equal(report.customers, 2); assert.equal(report.bookings, 1); assert.equal(report.freeRooms, 4);
});
test('cancelled, no-show and expired pending reservations do not occupy rooms', () => {
  for (const status of ['cancelled', 'no_show', 'expired', 'pending'] as const) {
    const state = fixture(); state.bookings[0].status = status; state.bookings[0].holdExpiresAt = '2026-09-19T05:59:00Z';
    const report = roomSchedule(state, date, '14:00', now);
    assert.equal(report.customers, 0); assert.equal(report.freeRooms, 6);
  }
});
test('overrun is flagged live, completed cleaning stays reserved, leave excludes staff', () => {
  const state = fixture(); state.bookings[0].status = 'in_service';
  const late = new Date('2026-09-19T08:30:00Z');
  assert.equal(roomSchedule(state, date, '16:30', late).resources[0].status, 'check');
  assert.equal(roomSchedule(state, date, '16:30', now).resources[0].status, 'free');
  state.bookings[0].status = 'completed';
  assert.equal(roomSchedule(state, date, '16:04', late).resources[0].status, 'cleaning');
  state.therapists.forEach((therapist) => therapist.leaveDates.push(date));
  assert.equal(roomSchedule(state, date, '14:00', now).availableTherapists, 0);
});
