import test from 'node:test';
import assert from 'node:assert/strict';
import { blockingAssignments, findDemoSchedule, initialDemoState } from './demo-booking.ts';
import { overrunWarnings, roomSchedule, shopResources } from './room-schedule.ts';

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

test('overdue mixed resources and every group therapist remain occupied across dates', () => {
  const state = fixture(); const booking = state.bookings[0];
  booking.status = 'in_service';
  booking.assignments[0].resourceIds.push('chair-1');
  booking.guests.push({ ...booking.guests[0], id: 'second' });
  booking.assignments.push({ ...booking.assignments[0], guestId: 'second', therapistId: 'therapist-02', resourceIds: ['bed-2', 'chair-2'] });
  const late = new Date('2026-09-20T03:00:00Z');
  const report = roomSchedule(state, '2026-09-20', '11:00', late);
  assert.equal(report.freeRooms, 4); assert.equal(report.freeChairs, 4);
  assert.equal(report.bookings, 0, 'Carry-over work must not inflate today’s booking count');
  assert.equal(report.availableTherapists, 3, 'Two occupied therapists plus one not yet on shift');
  assert.equal(blockingAssignments(state.bookings, '2026-09-21', late).length, 2);
  const guests = booking.guests.map((guest, index) => ({ ...guest, therapistChoice: { mode: 'specific' as const, requirement: 'required' as const, gender: '' as const, therapistId: `therapist-0${index + 1}` } }));
  const args = { guests, date: '2026-09-20', time: '14:00', groupTiming: 'together' as const, therapists: state.therapists, bookings: state.bookings, now: late };
  assert.equal(findDemoSchedule(args), null);
  // A different therapist must not use either the bed or chair still occupied.
  const other = findDemoSchedule({ ...args, guests: [{ ...guests[0], therapistChoice: { ...guests[0].therapistChoice, therapistId: 'therapist-04' } }] });
  assert.ok(other); assert.equal(other.assignments[0].resourceIds.includes('bed-1'), false);
  const foot = findDemoSchedule({ ...args, guests: [{ ...guests[0], categoryId: 'foot', itemId: 'foot-60', therapistChoice: { ...guests[0].therapistChoice, therapistId: 'therapist-03' } }] });
  assert.ok(foot); assert.equal(foot.assignments[0].resourceIds.includes('chair-1'), false);
  booking.status = 'completed'; booking.completedAt = '2026-09-20T03:00:00Z';
  assert.equal(roomSchedule(state, '2026-09-20', '11:04', late).freeRooms, 4);
  assert.equal(roomSchedule(state, '2026-09-20', '11:05', late).freeRooms, 6);
  assert.equal(roomSchedule(state, '2026-09-20', '11:05', late).freeChairs, 6);
  assert.ok(findDemoSchedule(args));
  assert.equal(overrunWarnings(state, late).length, 0);
});

test('overrun warnings identify existing therapist and room conflicts without changing bookings', () => {
  const state = fixture(); state.bookings[0].status = 'in_service';
  const upcoming = structuredClone(state.bookings[0]); upcoming.id = 'upcoming'; upcoming.reference = 'TEST-UPCOMING'; upcoming.status = 'confirmed';
  upcoming.time = '17:00'; upcoming.assignments[0] = { ...upcoming.assignments[0], start: '17:00', end: '18:00', cleanupEnd: '18:05' };
  state.bookings.push(upcoming);
  const before = structuredClone(state);
  const late = new Date('2026-09-19T08:30:00Z');
  assert.equal(overrunWarnings(state, late)[0].conflicts[0].id, upcoming.id);
  assert.equal(roomSchedule(state, date, '17:00', late).resources[0].status, 'check');
  upcoming.assignments[0].therapistId = 'therapist-04';
  assert.equal(overrunWarnings(state, late)[0].conflicts[0].id, upcoming.id, 'A room-only conflict is visible');
  upcoming.assignments[0].therapistId = before.bookings[1].assignments[0].therapistId;
  assert.deepEqual(state, before);
  state.bookings[0].status = 'completed';
  state.bookings[0].completedAt = '2026-09-19T08:58:00Z';
  const cleaning = new Date('2026-09-19T08:59:00Z');
  assert.equal(overrunWarnings(state, cleaning)[0].cleaning, true);
  assert.equal(overrunWarnings(state, cleaning)[0].conflicts[0].id, upcoming.id);
  assert.equal(overrunWarnings(state, new Date('2026-09-19T09:03:00Z')).length, 0);
});
