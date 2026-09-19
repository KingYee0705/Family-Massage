import { malaysiaDateValue, type DemoBooking, type DemoReservationResult, type DemoStaffRole, type DemoState, type StaffBooking, type StaffReservationResult, type StaffState } from '../app/demo-booking.ts';

/** Response-only projection. Never edit persisted financial records. */
export function staffBooking(booking: DemoBooking, role: DemoStaffRole, now: Date): StaffBooking {
  if (role === 'owner') return booking;
  const operational = { ...booking };
  delete operational.receiptToken;
  if (booking.date >= malaysiaDateValue(now)) return operational;
  // Allowlist historical fields so future financial fields cannot leak by default.
  return {
    id: booking.id, reference: booking.reference, source: booking.source,
    date: booking.date, time: booking.time, groupTiming: booking.groupTiming,
    contactName: booking.contactName, contactPhone: booking.contactPhone, notes: booking.notes,
    guests: booking.guests, assignments: booking.assignments, status: booking.status,
    createdAt: booking.createdAt, holdExpiresAt: booking.holdExpiresAt, completedAt: booking.completedAt,
    therapistSnapshots: booking.therapistSnapshots, financialsHidden: true,
    priceSnapshots: booking.priceSnapshots?.map(({ guestId, category, item, addOns }) => ({
      guestId, category, item, addOns: addOns.map(({ id, name }) => ({ id, name })),
    })),
    addOnSales: booking.addOnSales?.map(({ id, guestId, therapistId, addOnId, name, addedMinutes, source, addedAt, recordedBy }) => ({
      id, guestId, therapistId, addOnId, name, addedMinutes, source, addedAt, recordedBy,
    })),
  };
}

export function staffState(state: DemoState, role: DemoStaffRole, now: Date): StaffState {
  if (role === 'owner') return state;
  return { version: state.version, seedDate: state.seedDate, therapists: state.therapists,
    bookings: state.bookings.map((booking) => staffBooking(booking, role, now)),
    // Audit prose contains historical sale totals, even in entries created today.
    // Keep operational event metadata, not financially sensitive free-form text.
    audit: state.audit.map(({ id, at, actor, bookingId }) => ({ id, at, actor, bookingId, action: 'Operational record updated' })),
  };
}

export function staffResult(result: DemoReservationResult, role: DemoStaffRole, now: Date): StaffReservationResult {
  return result.ok ? { ok: true, booking: staffBooking(result.booking, role, now) } : result;
}
