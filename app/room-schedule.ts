import { bookingSettings, type LocalizedText } from './catalog.ts';
import { malaysiaDateValue, type DemoAssignment, type DemoBooking, type DemoState } from './demo-booking.ts';
import { getCategory, getMenuItem } from './order.ts';

export const shopResources = [
  ...Array.from({ length: bookingSettings.massageBeds }, (_, index) => ({ id: 'bed-' + (index + 1), kind: 'room' as const, name: { en: 'Room ' + (index + 1), zh: (index + 1) + ' 号房' } })),
  ...Array.from({ length: bookingSettings.footMassageChairs }, (_, index) => ({ id: 'chair-' + (index + 1), kind: 'chair' as const, name: { en: 'Foot chair ' + (index + 1), zh: (index + 1) + ' 号足椅' } })),
];
export const minuteValue = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export function shopTime(now = new Date()) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(now); }
export type RoomVisit = { key: string; bookingId: string; reference: string; status: DemoBooking['status']; guestName: string; therapist: LocalizedText; staffNumber: string; treatment: LocalizedText; assignment: DemoAssignment };
export type RoomStatus = 'free' | 'reserved' | 'in_service' | 'cleaning' | 'check' | 'closed';
const excluded = new Set(['cancelled', 'expired', 'no_show']);

export function roomSchedule(state: DemoState, date: string, time: string, now = new Date()) {
  const bookings = state.bookings.filter((booking) => booking.date === date && !excluded.has(booking.status)
    && !(booking.status === 'pending' && booking.holdExpiresAt && new Date(booking.holdExpiresAt) <= now));
  const visits: RoomVisit[] = bookings.flatMap((booking) => booking.assignments.map((assignment) => {
    const guest = booking.guests.find((entry) => entry.id === assignment.guestId);
    const snapshot = booking.therapistSnapshots?.find((entry) => entry.guestId === assignment.guestId);
    const therapist = state.therapists.find((entry) => entry.id === assignment.therapistId);
    const price = booking.priceSnapshots?.find((entry) => entry.guestId === assignment.guestId);
    const category = guest ? getCategory(guest.categoryId) : undefined;
    const item = guest ? getMenuItem(guest.categoryId, guest.itemId) : undefined;
    return { key: booking.id + '/' + assignment.guestId, bookingId: booking.id, reference: booking.reference, status: booking.status, guestName: guest?.name || booking.contactName, therapist: snapshot?.name ?? therapist?.name ?? { en: assignment.therapistId, zh: assignment.therapistId }, staffNumber: snapshot?.staffNumber ?? therapist?.staffNumber ?? '', treatment: { en: (price?.category.en ?? category?.name.en ?? '') + ' · ' + (price?.item.en ?? item?.name.en ?? ''), zh: (price?.category.zh ?? category?.name.zh ?? '') + ' · ' + (price?.item.zh ?? item?.name.zh ?? '') }, assignment };
  })).sort((a, b) => a.assignment.start.localeCompare(b.assignment.start));
  const live = date === malaysiaDateValue(now) && Math.abs(minuteValue(time) - minuteValue(shopTime(now))) < 1;
  const closed = time < bookingSettings.firstTime || time >= bookingSettings.closingTime;
  const resources = shopResources.map((resource) => {
    const schedule = visits.filter((visit) => visit.assignment.resourceIds.includes(resource.id));
    const current = schedule.filter((visit) => visit.assignment.start <= time && visit.assignment.cleanupEnd > time);
    // A treatment still marked in service must not look like an empty room
    // just because its estimated finish has passed. Staff must check it.
    const overdue = live ? schedule.filter((visit) => visit.status === 'in_service' && visit.assignment.end <= time) : [];
    const active = overdue[0] ?? current[0];
    const next = schedule.find((visit) => visit.assignment.start > time);
    let status: RoomStatus = closed ? 'closed' : 'free';
    if (overdue.length || current.length > 1) status = 'check';
    else if (active) status = time >= active.assignment.end ? 'cleaning' : active.status === 'in_service' ? 'in_service' : 'reserved';
    return { ...resource, schedule, active, next, status, occupiedUntil: active?.assignment.cleanupEnd ?? null };
  });
  const busyTherapists = new Set(visits.filter((visit) => (visit.assignment.start <= time && visit.assignment.cleanupEnd > time) || (live && visit.status === 'in_service' && visit.assignment.end <= time)).map((visit) => visit.assignment.therapistId));
  const availableTherapists = closed ? 0 : state.therapists.filter((therapist) => therapist.active && !therapist.leaveDates.includes(date) && therapist.shiftStart <= time && therapist.shiftEnd > time && !busyTherapists.has(therapist.id)).length;
  return { bookings: bookings.length, customers: bookings.reduce((sum, booking) => sum + booking.guests.length, 0), resources, visits, availableTherapists,
    freeRooms: resources.filter((resource) => resource.kind === 'room' && resource.status === 'free').length,
    freeChairs: resources.filter((resource) => resource.kind === 'chair' && resource.status === 'free').length,
    checks: resources.filter((resource) => resource.status === 'check').length, closed, live };
}
