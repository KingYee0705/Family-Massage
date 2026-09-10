import { createHash } from 'node:crypto';
import { catalog } from '../app/catalog.ts';
import type { BossAudit, BossDay, BossMonthReport, BossSaleLine, BossSales, BossTherapistMonth, BossTotals } from '../app/boss-types.ts';
import { malaysiaDateValue, type DemoBooking, type DemoState } from '../app/demo-booking.ts';
import { getMenuItem, guestTotal } from '../app/order.ts';

export type BossFinanceState = {
  settings: { therapistId: string; effectiveMonth: string; rentalCents: number; electricityCents: number }[];
  overrides: { month: string; therapistId: string; rentalCents: number; electricityCents: number }[];
  statements: { id: string; month: string; savedAt: string; savedBy: string; report: BossMonthReport }[];
  closed: Record<string, string>;
  audit: BossAudit[];
};

const salesKeys = ['completedTreatments', 'serviceCents', 'bookedExtrasCents', 'laterExtrasCents', 'grossCents'] as const;
const totalKeys = [...salesKeys, 'commissionCents', 'shopShareCents', 'rentalCents', 'electricityCents', 'netCents'] as const;
const emptySales = (): BossSales => ({ completedTreatments: 0, serviceCents: 0, bookedExtrasCents: 0, laterExtrasCents: 0, grossCents: 0 });
const emptyTotals = (): BossTotals => ({ ...emptySales(), commissionCents: 0, shopShareCents: 0, rentalCents: 0, electricityCents: 0, netCents: 0 });
const cents = (ringgit: number) => Math.round(ringgit * 100);
const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

/** Clearly labelled example deductions for the local demo, not real payroll. */
export function initialBossFinance(state: DemoState): BossFinanceState {
  const sampleRentals = [20000, 30000, 20000, 30000, 0, 20000];
  const sampleElectricity = [7800, 7800, 4000, 4000, 0, 7800];
  return {
    settings: [...state.therapists].sort((a, b) => a.id.localeCompare(b.id)).map((therapist, index) => ({
      therapistId: therapist.id,
      effectiveMonth: '2000-01',
      rentalCents: sampleRentals[index % sampleRentals.length],
      electricityCents: sampleElectricity[index % sampleElectricity.length],
    })),
    overrides: [],
    statements: [],
    closed: {},
    audit: [],
  };
}

function reportMonths(state: DemoState, finance: BossFinanceState, now: Date) {
  const current = malaysiaDateValue(now).slice(0, 7);
  const [year, month] = current.split('-').map(Number);
  const months = new Set<string>();
  for (let offset = 0; offset <= 12; offset += 1) {
    months.add(new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 7));
  }
  for (const booking of state.bookings) months.add(booking.date.slice(0, 7));
  for (const statement of finance.statements) months.add(statement.month);
  return [...months].filter((entry) => validMonth(entry) && entry <= current).sort().reverse();
}

function monthDays(month: string): BossDay[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, '0')}`,
    ...emptySales(),
    lines: [],
  }));
}

function saleLine(booking: DemoBooking, guestId: string, start: string): BossSaleLine | null {
  const guest = booking.guests.find((entry) => entry.id === guestId);
  if (!guest) return null;
  const category = catalog.find((entry) => entry.id === guest.categoryId);
  const item = getMenuItem(guest.categoryId, guest.itemId);
  const snapshot = booking.priceSnapshots?.find((entry) => entry.guestId === guestId);
  const laterSales = new Map((booking.addOnSales ?? []).filter((sale) => sale.guestId === guestId).map((sale) => [sale.addOnId, sale]));
  const extraRows = snapshot?.addOns ?? guest.addOnIds.flatMap((id) => {
    const extra = category?.addOns.find((entry) => entry.id === id);
    return extra ? [extra] : [];
  });
  // A later sale is also present in the price snapshot. Classify that one row
  // by its recorded source; never add the sale price to the visit total again.
  const extras = [...new Map(extraRows.map((extra) => [extra.id, extra])).values()].map((extra) => {
    const sale = laterSales.get(extra.id);
    return {
      name: structuredClone(sale?.name ?? extra.name),
      priceCents: cents(sale?.price ?? extra.price),
      source: sale?.source ?? 'booking' as const,
    };
  });
  const bookedExtrasCents = extras.filter((extra) => extra.source === 'booking').reduce((sum, extra) => sum + extra.priceCents, 0);
  const laterExtrasCents = extras.filter((extra) => extra.source !== 'booking').reduce((sum, extra) => sum + extra.priceCents, 0);
  const grossCents = cents(snapshot?.total ?? guestTotal(guest));
  const categoryName = snapshot?.category ?? category?.name;
  const itemName = snapshot?.item ?? item?.name ?? { en: guest.itemId, zh: guest.itemId };
  return {
    bookingId: booking.id,
    reference: booking.reference,
    guestId,
    guestName: guest.name,
    start,
    service: categoryName ? { en: `${categoryName.en} · ${itemName.en}`, zh: `${categoryName.zh} · ${itemName.zh}` } : structuredClone(itemName),
    extras,
    completedTreatments: 1,
    // Package-included components stay within the base service price. The
    // agreed total remains authoritative even if catalog prices later change.
    serviceCents: grossCents - bookedExtrasCents - laterExtrasCents,
    bookedExtrasCents,
    laterExtrasCents,
    grossCents,
  };
}

export function calculateBossMonth(state: DemoState, finance: BossFinanceState, month: string, now: Date): BossMonthReport {
  if (!validMonth(month)) throw new Error('Choose a valid month.');
  const availableMonths = reportMonths(state, finance, now);
  const statementHistory = [...finance.statements].reverse().filter((statement) => statement.month === month)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .map((statement) => ({
      id: statement.id, month: statement.month, savedAt: statement.savedAt, savedBy: statement.savedBy,
      grossCents: statement.report.totals.grossCents, netCents: statement.report.totals.netCents,
    }));
  const audit = structuredClone([...finance.audit].reverse().filter((entry) => entry.month === month)
    .sort((a, b) => b.at.localeCompare(a.at)));
  const closedId = finance.closed[month];
  if (closedId) {
    const statement = finance.statements.find((entry) => entry.id === closedId && entry.month === month);
    if (!statement) throw new Error('The saved month statement is missing.');
    return {
      ...structuredClone(statement.report),
      status: 'closed',
      savedAt: statement.savedAt,
      statementId: statement.id,
      generatedAt: now.toISOString(),
      availableMonths,
      statementHistory,
      audit,
    };
  }

  const completed = state.bookings.filter((booking) => booking.status === 'completed' && booking.date.startsWith(`${month}-`));
  const profiles = new Map(state.therapists.map((profile) => [profile.id, {
    therapistId: profile.id, staffNumber: profile.staffNumber, name: structuredClone(profile.name), imageUrl: profile.imageUrl, active: profile.active,
  }]));
  // Preserve sales from historical therapist assignments even if the current
  // profile has since been removed. Inactive profiles are included normally.
  for (const booking of completed) {
    for (const assignment of booking.assignments) {
      if (profiles.has(assignment.therapistId)) continue;
      const snapshot = booking.therapistSnapshots?.find((entry) => entry.therapistId === assignment.therapistId && entry.guestId === assignment.guestId);
      profiles.set(assignment.therapistId, {
        therapistId: assignment.therapistId,
        staffNumber: snapshot?.staffNumber ?? assignment.therapistId,
        name: structuredClone(snapshot?.name ?? { en: assignment.therapistId, zh: assignment.therapistId }),
        imageUrl: '',
        active: false,
      });
    }
  }
  const therapists: BossTherapistMonth[] = [...profiles.values()]
    .sort((a, b) => a.staffNumber.localeCompare(b.staffNumber) || a.therapistId.localeCompare(b.therapistId))
    .map((profile) => ({ ...profile, ...emptyTotals(), days: monthDays(month) }));
  const byTherapist = new Map(therapists.map((therapist) => [therapist.therapistId, therapist]));
  for (const booking of completed) {
    const assignedGuests = new Set<string>();
    for (const assignment of booking.assignments) {
      // Scheduling guarantees one assignment per guest. Guard against a
      // duplicated stored assignment counting the same treatment twice.
      if (assignedGuests.has(assignment.guestId)) continue;
      assignedGuests.add(assignment.guestId);
      const therapist = byTherapist.get(assignment.therapistId);
      const day = therapist?.days.find((entry) => entry.date === booking.date);
      const line = saleLine(booking, assignment.guestId, assignment.start);
      if (!day || !line) continue;
      day.lines.push(line);
      for (const key of salesKeys) day[key] += line[key];
    }
  }
  const totals = emptyTotals();
  for (const therapist of therapists) {
    for (const day of therapist.days) {
      day.lines.sort((a, b) => a.start.localeCompare(b.start) || a.bookingId.localeCompare(b.bookingId) || a.guestId.localeCompare(b.guestId));
      for (const key of salesKeys) therapist[key] += day[key];
    }
    const setting = finance.settings.filter((entry) => entry.therapistId === therapist.therapistId && entry.effectiveMonth <= month)
      .sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0];
    const override = finance.overrides.find((entry) => entry.therapistId === therapist.therapistId && entry.month === month);
    therapist.rentalCents = override?.rentalCents ?? setting?.rentalCents ?? 0;
    therapist.electricityCents = override?.electricityCents ?? setting?.electricityCents ?? 0;
    // Round once per therapist per month to the nearest sen. The shop's
    // remainder guarantees that therapist commission + shop share = sales.
    therapist.commissionCents = Math.round(therapist.grossCents / 2);
    therapist.shopShareCents = therapist.grossCents - therapist.commissionCents;
    therapist.netCents = therapist.commissionCents - therapist.rentalCents - therapist.electricityCents;
    for (const key of totalKeys) totals[key] += therapist[key];
  }
  const revision = createHash('sha256').update(JSON.stringify({ month, commissionPercent: 50, therapists, totals })).digest('hex');
  return {
    month, generatedAt: now.toISOString(), status: 'open', savedAt: null, statementId: null,
    revision, commissionPercent: 50, therapists, totals, availableMonths, statementHistory, audit,
  };
}
