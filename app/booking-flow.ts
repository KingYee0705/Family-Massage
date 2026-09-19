import type { GuestSelection, TherapistChoice } from './catalog.ts';
import { isTherapistCompatible, therapistMatchesPreference, type TherapistProfile } from './demo-booking.ts';
import { getMenuItem } from './order.ts';

export function matchingTherapists(guest: GuestSelection, therapists: TherapistProfile[]) {
  // A preferred person may be substituted when busy, not when unqualified.
  if (guest.therapistChoice?.mode === 'specific' && !therapists.some((therapist) => therapist.id === guest.therapistChoice?.therapistId && isTherapistCompatible(therapist, guest))) return [];
  return therapists.filter((therapist) => isTherapistCompatible(therapist, guest)
    && (guest.therapistChoice?.requirement !== 'required' || therapistMatchesPreference(therapist, guest.therapistChoice)));
}
export function changeTherapistChoice(guest: GuestSelection, choice: TherapistChoice, therapists: TherapistProfile[]): GuestSelection {
  const next = { ...guest, therapistChoice: choice, therapistPreference: '' };
  return guest.itemId && !matchingTherapists(next, therapists).length ? { ...next, itemId: '', addOnIds: [] } : next;
}
export function isGuestReady(guest: GuestSelection, therapists: TherapistProfile[]) {
  return Boolean(getMenuItem(guest.categoryId, guest.itemId)) && matchingTherapists(guest, therapists).length > 0;
}
export function shiftDate(date: string, days: number) {
  const value = new Date(date + 'T12:00:00Z');
  if (Number.isNaN(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function calendarDays(start: string, count = 7) { return Array.from({ length: count }, (_, index) => shiftDate(start, index)); }
