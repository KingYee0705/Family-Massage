import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookingSettings, catalog, type GuestSelection } from '../app/catalog.ts';
import { getMenuItem, guestTotal, isValidBookingPhone, orderTotal } from '../app/order.ts';
import {
  calculateDemoAvailability, calculateDemoDailyEarnings, emptyTherapistChoice, expirePending, extendDemoAssignment, findDemoSchedule,
  getIncludedAddonIds, initialDemoState, isTherapistCompatible, nearestAvailableTimes,
  malaysiaDateValue, sampleTherapists, therapistChoiceLabel, therapistMatchesPreference,
  type DemoAddOnSale, type DemoBooking, type DemoBookingStatus, type DemoOccupancy, type DemoReservationInput,
  type DemoReservationResult, type DemoStaffRole, type DemoStaffUser, type DemoState, type TherapistProfile,
} from '../app/demo-booking.ts';
import { calculateBossMonth, initialBossFinance, type BossFinanceState } from './boss-finance.ts';
import type { BossMonthReport } from '../app/boss-types.ts';

// Deliberately local-only: no production deployment, database, or live booking mode.
const SESSION_HOURS = 8;
const COOKIE = 'serene_demo_session';
const ACTIVE: DemoBookingStatus[] = ['pending', 'confirmed', 'checked_in', 'in_service'];
const TRANSITIONS: Record<DemoBookingStatus, DemoBookingStatus[]> = {
  pending: ['confirmed', 'cancelled'], confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_service', 'cancelled', 'no_show'], in_service: ['completed'],
  completed: [], cancelled: [], no_show: [], expired: [],
};
class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const dateValid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const timeValid = (time: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
const appointmentDate = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);

function deductionCents(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000
    || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw new HttpError(400, `Enter a valid ${label} amount in RM, with no more than two decimal places.`);
  return Math.round(value * 100);
}

function text(value: unknown, label: string, max = 200, min = 0): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new HttpError(400, `Invalid ${label}.`);
  return value.trim();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected an object.');
  return value as Record<string, unknown>;
}
function stringList(value: unknown, label: string, allowed?: string[]): string[] {
  if (!Array.isArray(value) || value.length > 400 || value.some((v) => typeof v !== 'string') || new Set(value).size !== value.length || (allowed && value.some((v) => !allowed.includes(v)))) throw new HttpError(400, `Invalid ${label}.`);
  return value as string[];
}

function validateInput(value: unknown, state: DemoState, now: Date, staff: boolean): DemoReservationInput {
  const input = object(value);
  const date = text(input.date, 'date', 10, 10);
  const time = text(input.time, 'time', 5, 5);
  if (!dateValid(date) || !timeValid(time) || Number(time.slice(3)) % (staff ? 5 : 30) !== 0) throw new HttpError(400, 'Choose a valid appointment date and time.');
  const source = staff ? (input.source ?? 'phone') : 'online';
  if (!['online', 'phone', 'whatsapp', 'walk_in'].includes(source as string)) throw new HttpError(400, 'Invalid booking source.');
  // Staff may need to record a last-minute call, WhatsApp message, or walk-in.
  // The one-hour notice rule remains enforced for customer website bookings.
  const minimum = staff ? 0 : bookingSettings.minimumLeadMinutes;
  if (appointmentDate(date, time).getTime() < now.getTime() + minimum * 60_000) throw new HttpError(400, minimum ? 'Appointments need at least one hour of notice.' : 'Choose a time that has not passed.');
  if (input.groupTiming !== 'together' && input.groupTiming !== 'flexible') throw new HttpError(400, 'Invalid group timing.');
  if (!Array.isArray(input.guests) || input.guests.length < 1 || input.guests.length > bookingSettings.maximumConcurrentCustomers) throw new HttpError(400, 'Select one to six guests.');
  const guests = input.guests.map((raw): GuestSelection => {
    const guest = object(raw);
    const categoryId = text(guest.categoryId, 'service category', 50, 1);
    const itemId = text(guest.itemId, 'service', 70, 1);
    const category = catalog.find((c) => c.id === categoryId);
    if (!category || !getMenuItem(categoryId, itemId)) throw new HttpError(400, 'Choose a valid service for every guest.');
    const addOnIds = stringList(guest.addOnIds, 'add-ons', category.addOns.map((a) => a.id));
    if (getIncludedAddonIds({ itemId }).some((id) => addOnIds.includes(id))) throw new HttpError(400, 'An add-on is already included in this package.');
    const choice = guest.therapistChoice === undefined ? emptyTherapistChoice() : object(guest.therapistChoice);
    if (!['none', 'gender', 'specific'].includes(choice.mode as string) || !['required', 'preferred'].includes(choice.requirement as string)) throw new HttpError(400, 'Invalid therapist preference.');
    if (choice.mode === 'gender' && !['male', 'female'].includes(choice.gender as string)) throw new HttpError(400, 'Choose a therapist gender.');
    const selection: GuestSelection = {
      id: text(guest.id, 'guest ID', 100, 1), name: text(guest.name ?? '', 'guest name', 100), categoryId, itemId, addOnIds,
      therapistPreference: '', therapistChoice: {
        mode: choice.mode as 'none' | 'gender' | 'specific', requirement: choice.requirement as 'required' | 'preferred',
        gender: choice.mode === 'gender' ? choice.gender as 'male' | 'female' : '', therapistId: choice.mode === 'specific' ? text(choice.therapistId, 'therapist', 100, 1) : '',
      },
    };
    if (choice.mode === 'specific') {
      const therapist = state.therapists.find((t) => t.id === selection.therapistChoice!.therapistId);
      if (!therapist || !isTherapistCompatible(therapist, selection)) throw new HttpError(400, 'The selected therapist cannot provide this treatment.');
    }
    selection.therapistPreference = therapistChoiceLabel(selection.therapistChoice, 'en', state.therapists);
    return selection;
  });
  if (new Set(guests.map((g) => g.id)).size !== guests.length) throw new HttpError(400, 'Guest IDs must be unique.');
  const contactName = text(input.contactName, 'contact name', 100, 2);
  const contactPhone = text(input.contactPhone, 'contact phone', 25, 8);
  if (!isValidBookingPhone(contactPhone)) throw new HttpError(400, 'Enter a valid contact phone number.');
  return { date, time, guests, groupTiming: input.groupTiming, contactName, contactPhone, notes: text(input.notes ?? '', 'notes', 1500), source: source as DemoReservationInput['source'] };
}

function priceSnapshots(guests: GuestSelection[]): NonNullable<DemoBooking['priceSnapshots']> {
  return guests.map((guest) => {
    const category = catalog.find((c) => c.id === guest.categoryId)!;
    const item = getMenuItem(guest.categoryId, guest.itemId)!;
    return { guestId: guest.id, category: category.name, item: item.name, itemPrice: item.price, addOns: guest.addOnIds.map((id) => category.addOns.find((a) => a.id === id)!), total: guestTotal(guest) };
  });
}
function snapshotTherapists(booking: DemoBooking, state: DemoState) {
  booking.therapistSnapshots = booking.assignments.map((assignment) => {
    const therapist = state.therapists.find((t) => t.id === assignment.therapistId)!;
    return { guestId: assignment.guestId, therapistId: therapist.id, staffNumber: therapist.staffNumber, name: therapist.name };
  });
  // Commission follows the therapist who serves this guest if staff reassign
  // the visit after selling an extra at the counter.
  booking.addOnSales?.forEach((sale) => {
    const assignment = booking.assignments.find((entry) => entry.guestId === sale.guestId);
    if (assignment) sale.therapistId = assignment.therapistId;
  });
}

function customerBooking(booking: DemoBooking): DemoBooking {
  return {
    ...booking,
    ...(booking.addOnSales ? { addOnSales: booking.addOnSales.map((sale) => ({ ...sale, recordedBy: undefined })) } : {}),
  };
}

export function createDemoServer(options: { dbPath?: string; now?: () => Date } = {}) {
  const dbPath = options.dbPath ?? resolve('.demo-data/demo.sqlite');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,booking_id TEXT NOT NULL);');
  const now = options.now ?? (() => new Date());
  if (!db.prepare('SELECT id FROM state WHERE id=1').get()) db.prepare('INSERT INTO state(id,json) VALUES(1,?)').run(JSON.stringify(initialDemoState(now())));
  // Financial settings and statements never enter the state shared with front
  // desk, therapists, or customer availability responses.
  db.exec('CREATE TABLE IF NOT EXISTS boss_finance (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);');
  if (!db.prepare('SELECT id FROM boss_finance WHERE id=1').get()) {
    const row = db.prepare('SELECT json FROM state WHERE id=1').get() as { json: string };
    db.prepare('INSERT INTO boss_finance(id,json) VALUES(1,?)').run(JSON.stringify(initialBossFinance(JSON.parse(row.json) as DemoState)));
  }
  const demoAccounts: { id: string; email: string; name: string; role: DemoStaffRole }[] = [
    { id: 'owner', email: 'owner@serene.demo', name: 'Demo owner', role: 'owner' },
    { id: 'receptionist', email: 'receptionist@serene.demo', name: 'Demo receptionist', role: 'receptionist' },
    ...sampleTherapists.map((therapist) => ({
      id: therapist.id,
      email: `${therapist.staffNumber.toLowerCase()}@serene.demo`,
      name: therapist.name.en,
      role: 'therapist' as const,
    })),
  ];
  for (const account of demoAccounts) {
    if (!db.prepare('SELECT id FROM users WHERE email=?').get(account.email)) {
      const salt = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(account.id, account.email, account.name, account.role, salt, scryptSync('SereneDemo!', salt, 64).toString('hex'));
    }
  }
  function transaction<T>(action: (state: DemoState) => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const stored = db.prepare('SELECT json FROM state WHERE id=1').get() as { json: string };
      const initial = JSON.parse(stored.json) as DemoState;
      const expired = expirePending(initial, now());
      const state = expired.state;
      if (expired.changed) for (const booking of state.bookings) {
        if (booking.status === 'expired' && initial.bookings.find((b) => b.id === booking.id)?.status === 'pending') audit(state, 'system', 'Pending hold expired', booking.id);
      }
      const result = action(state);
      db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(state));
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function audit(state: DemoState, actor: string, action: string, bookingId?: string) {
    state.audit.push({ id: randomUUID(), at: now().toISOString(), actor, action, ...(bookingId ? { bookingId } : {}) });
  }
  function bossMonth(value: unknown): string {
    const month = text(value, 'month', 7, 7);
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month) || month > malaysiaDateValue(now()).slice(0, 7)) throw new HttpError(400, 'Choose the current month or a previous month.');
    return month;
  }
  function financeTransaction(action: (state: DemoState, finance: BossFinanceState) => BossMonthReport): BossMonthReport {
    return transaction((state) => {
      const row = db.prepare('SELECT json FROM boss_finance WHERE id=1').get() as { json: string };
      const finance = JSON.parse(row.json) as BossFinanceState;
      const result = action(state, finance);
      db.prepare('UPDATE boss_finance SET json=? WHERE id=1').run(JSON.stringify(finance));
      return result;
    });
  }
  function financeAudit(finance: BossFinanceState, month: string, user: DemoStaffUser, action: string) {
    finance.audit.push({ id: randomUUID(), month, at: now().toISOString(), actor: user.email, action });
  }
  function requireBossRevision(report: BossMonthReport, body: Record<string, unknown>) {
    if (text(body.expectedRevision, 'statement version', 100, 8) !== report.revision) throw new HttpError(409, 'These figures changed since you opened them. Refresh the month and review the latest amounts.');
  }
  function readBossMonth(month: string, statementId: string | null): BossMonthReport {
    return financeTransaction((state, finance) => {
      const current = calculateBossMonth(state, finance, month, now());
      if (!statementId) return current;
      const saved = finance.statements.find((entry) => entry.id === statementId && entry.month === month);
      if (!saved) throw new HttpError(404, 'Saved statement not found for this month.');
      return { ...saved.report, availableMonths: current.availableMonths, statementHistory: current.statementHistory, audit: current.audit };
    });
  }
  function saveDeductions(month: string, therapistId: string, raw: unknown, user: DemoStaffUser): BossMonthReport {
    return financeTransaction((state, finance) => {
      const body = object(raw);
      const current = calculateBossMonth(state, finance, month, now());
      if (current.status === 'closed') throw new HttpError(409, 'This month is saved. Reopen it with a reason before making corrections.');
      requireBossRevision(current, body);
      if (!current.therapists.some((entry) => entry.therapistId === therapistId)) throw new HttpError(404, 'Therapist not found.');
      const rentalCents = deductionCents(body.rental, 'rental');
      const electricityCents = deductionCents(body.electricity, 'electricity');
      if (typeof body.applyToFutureMonths !== 'boolean') throw new HttpError(400, 'Choose whether these amounts should apply to future months.');
      finance.overrides = finance.overrides.filter((entry) => entry.month !== month || entry.therapistId !== therapistId);
      finance.overrides.push({ month, therapistId, rentalCents, electricityCents });
      if (body.applyToFutureMonths) {
        finance.settings = finance.settings.filter((entry) => entry.effectiveMonth !== month || entry.therapistId !== therapistId);
        finance.settings.push({ effectiveMonth: month, therapistId, rentalCents, electricityCents });
      }
      financeAudit(finance, month, user, `Updated deductions for ${therapistId}: rental RM ${(rentalCents / 100).toFixed(2)}, electricity RM ${(electricityCents / 100).toFixed(2)}; ${body.applyToFutureMonths ? 'also future defaults' : 'this month only'}`);
      return calculateBossMonth(state, finance, month, now());
    });
  }
  function saveStatement(month: string, raw: unknown, user: DemoStaffUser): BossMonthReport {
    return financeTransaction((state, finance) => {
      const body = object(raw);
      if (month >= malaysiaDateValue(now()).slice(0, 7)) throw new HttpError(409, 'Save the final statement after this month ends. You can print a draft now.');
      const current = calculateBossMonth(state, finance, month, now());
      if (current.status === 'closed') return current;
      requireBossRevision(current, body);
      const id = randomUUID();
      const savedAt = now().toISOString();
      const report: BossMonthReport = structuredClone({ ...current, status: 'closed', savedAt, statementId: id, revision: hash(`${current.revision}:${id}`) });
      finance.statements.push({ id, month, savedAt, savedBy: user.email, report });
      finance.closed[month] = id;
      financeAudit(finance, month, user, 'Saved monthly statement. Figures are frozen; no payment was sent.');
      return calculateBossMonth(state, finance, month, now());
    });
  }
  function reopenMonth(month: string, raw: unknown, user: DemoStaffUser): BossMonthReport {
    return financeTransaction((state, finance) => {
      const body = object(raw);
      const current = calculateBossMonth(state, finance, month, now());
      if (current.status !== 'closed') throw new HttpError(409, 'This month is already open.');
      requireBossRevision(current, body);
      const reason = text(body.reason, 'correction reason', 500, 2);
      delete finance.closed[month];
      financeAudit(finance, month, user, `Reopened monthly statement: ${reason}`);
      return calculateBossMonth(state, finance, month, now());
    });
  }
  function userFor(req: IncomingMessage): DemoStaffUser | null {
    const token = req.headers.cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token) return null;
    const row = db.prepare('SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token), now().toISOString()) as { id: string; email: string; name: string; role: DemoStaffRole } | undefined;
    if (!row) return null;
    return { ...row, ...(row.role === 'therapist' ? { therapistId: row.id } : {}) };
  }
  function staffFor(req: IncomingMessage) {
    const user = userFor(req); if (!user) throw new HttpError(401, 'Please sign in to the staff dashboard.'); return user;
  }
  function conflict(input: DemoReservationInput, state: DemoState): DemoReservationResult {
    return { ok: false, reason: 'conflict', alternatives: nearestAvailableTimes(input.time, calculateDemoAvailability({ ...input, bookings: state.bookings, therapists: state.therapists, now: now() })) };
  }
  function createBooking(raw: unknown, user: DemoStaffUser | null): DemoReservationResult {
    return transaction((state) => {
      const rawObject = object(raw);
      const key = `${user?.id ?? 'public'}:${text(rawObject.idempotencyKey, 'request key', 160, 8)}`;
      const fingerprint = hash(JSON.stringify({ ...rawObject, idempotencyKey: undefined }));
      const existing = db.prepare('SELECT fingerprint,booking_id FROM idempotency WHERE key=?').get(key) as { fingerprint: string; booking_id: string } | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'This request key was already used for a different booking.');
        const booking = state.bookings.find((b) => b.id === existing.booking_id);
        if (booking) return { ok: true, booking };
      }
      const input = validateInput(rawObject, state, now(), Boolean(user));
      const schedule = findDemoSchedule({ ...input, bookings: state.bookings, therapists: state.therapists, now: now() });
      if (!schedule) return conflict(input, state);
      const createdAt = now();
      const booking: DemoBooking = {
        ...input, id: randomUUID(), reference: `DEMO-${input.date.replaceAll('-', '').slice(2)}-${randomBytes(4).toString('hex').toUpperCase()}`,
        source: input.source!, assignments: schedule.assignments, total: orderTotal(input.guests), status: 'confirmed',
        createdAt: createdAt.toISOString(), holdExpiresAt: null,
        receiptToken: randomBytes(24).toString('hex'),
        priceSnapshots: priceSnapshots(input.guests),
      };
      snapshotTherapists(booking, state);
      state.bookings.push(booking);
      audit(state, user?.email ?? 'customer', `Created ${booking.source} booking (${booking.status})`, booking.id);
      db.prepare('INSERT INTO idempotency VALUES(?,?,?)').run(key, fingerprint, booking.id);
      return { ok: true, booking };
    });
  }
  function updateBooking(id: string, raw: unknown, user: DemoStaffUser): DemoReservationResult {
    return transaction((state) => {
      const body = object(raw);
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking) throw new HttpError(404, 'Booking not found.');
      if (body.action === 'status') {
        const status = body.status as DemoBookingStatus;
        if (!TRANSITIONS[booking.status].includes(status)) throw new HttpError(409, 'That status change is no longer available. Refresh the booking.');
        booking.status = status; booking.holdExpiresAt = null;
      } else if (body.action === 'reschedule') {
        if (!['pending', 'confirmed'].includes(booking.status)) throw new HttpError(409, 'Only pending or confirmed bookings can be rescheduled.');
        const input = validateInput({ ...booking, date: body.date, time: body.time, groupTiming: body.groupTiming ?? booking.groupTiming }, state, now(), true);
        const others = state.bookings.filter((b) => b.id !== id);
        const schedule = findDemoSchedule({ ...input, bookings: others, therapists: state.therapists, now: now() });
        if (!schedule) return conflict(input, { ...state, bookings: others });
        booking.date = input.date; booking.time = input.time; booking.groupTiming = input.groupTiming; booking.assignments = schedule.assignments;
        if (booking.status === 'pending') booking.holdExpiresAt = new Date(now().getTime() + 30 * 60_000).toISOString();
        snapshotTherapists(booking, state);
      } else if (body.action === 'add_addons') {
        if (!['confirmed', 'checked_in', 'in_service'].includes(booking.status)) throw new HttpError(409, 'Extras can only be added before this visit is completed or cancelled.');
        const guestId = text(body.guestId, 'guest ID', 100, 1);
        const guest = booking.guests.find((entry) => entry.id === guestId);
        const assignment = booking.assignments.find((entry) => entry.guestId === guestId);
        const therapist = state.therapists.find((entry) => entry.id === assignment?.therapistId);
        const category = catalog.find((entry) => entry.id === guest?.categoryId);
        if (!guest || !assignment || !therapist || !category) throw new HttpError(400, 'Choose a guest with an assigned therapist.');
        const source = body.source;
        if (source !== 'counter' && source !== 'during_service') throw new HttpError(400, 'Choose counter or during service for the extra sale.');
        const addOnIds = stringList(body.addOnIds, 'add-ons', category.addOns.map((extra) => extra.id));
        if (!addOnIds.length) throw new HttpError(400, 'Select at least one extra.');
        const included = getIncludedAddonIds(guest);
        if (addOnIds.some((id) => guest.addOnIds.includes(id) || included.includes(id)
          || booking.addOnSales?.some((sale) => sale.guestId === guestId && sale.addOnId === id))) throw new HttpError(400, 'An extra is already on this visit or included in the package. Refresh the booking.');
        const extras = addOnIds.map((id) => category.addOns.find((extra) => extra.id === id)!);
        const updatedGuest = { ...guest, addOnIds: [...guest.addOnIds, ...addOnIds] };
        if (!isTherapistCompatible(therapist, updatedGuest)) throw new HttpError(400, 'The assigned therapist cannot provide these extras.');
        const durations: Readonly<Record<string, number>> = bookingSettings.estimatedAddOnDurationMinutes;
        const addedMinutes = extras.reduce((sum, extra) => sum + durations[extra.id], 0);
        const occupied: DemoOccupancy[] = state.bookings.filter((entry) => entry.id !== booking.id);
        occupied.push({ ...booking, assignments: booking.assignments.filter((entry) => entry.guestId !== guestId) });
        const extended = extendDemoAssignment({ guest: updatedGuest, assignment, addedMinutes, date: booking.date, therapist,
          bookings: occupied, now: now(), inService: booking.status === 'in_service' });
        if (!extended) return { ok: false, reason: 'conflict', alternatives: [] };

        // Preserve all prices agreed earlier. Only the new sale uses today's
        // menu price; never accept a caller-supplied price or commission amount.
        const extraCents = extras.reduce((sum, extra) => sum + Math.round(extra.price * 100), 0);
        const snapshots = booking.priceSnapshots ?? priceSnapshots(booking.guests);
        const previousPrice = snapshots.find((entry) => entry.guestId === guestId) ?? priceSnapshots([guest])[0];
        const updatedPrice = { ...previousPrice, addOns: [...previousPrice.addOns, ...extras], total: (Math.round(previousPrice.total * 100) + extraCents) / 100 };
        booking.priceSnapshots = [...snapshots.filter((entry) => entry.guestId !== guestId), updatedPrice];
        booking.guests = booking.guests.map((entry) => entry.id === guestId ? updatedGuest : entry);
        booking.assignments = booking.assignments.map((entry) => entry.guestId === guestId ? extended : entry);
        booking.total = (Math.round(booking.total * 100) + extraCents) / 100;
        const addedAt = now().toISOString();
        booking.addOnSales = [...(booking.addOnSales ?? []), ...extras.map((extra): DemoAddOnSale => ({
          id: randomUUID(), guestId, therapistId: therapist.id, addOnId: extra.id, name: extra.name, price: extra.price,
          addedMinutes: durations[extra.id], source, addedAt, recordedBy: user.email,
        }))];
        audit(state, user.email, `add_addons: ${source}; guest ${guestId}; therapist ${therapist.staffNumber}; ${extras.map((extra) => `${extra.name.en} RM ${extra.price}`).join(', ')}; total RM ${booking.total}; ends ${extended.end}`, booking.id);
        return { ok: true, booking };
      } else if (body.action === 'reassign') {
        if (!['pending', 'confirmed', 'checked_in'].includes(booking.status)) throw new HttpError(409, 'This booking can no longer be reassigned.');
        const guest = booking.guests.find((g) => g.id === body.guestId);
        const assignment = booking.assignments.find((a) => a.guestId === body.guestId);
        const therapist = state.therapists.find((t) => t.id === body.therapistId);
        if (!guest || !assignment || !therapist || !isTherapistCompatible(therapist, guest)) throw new HttpError(400, 'Choose a compatible therapist.');
        const choice = guest.therapistChoice;
        if (choice?.requirement === 'required' && ((choice.mode === 'specific' && choice.therapistId !== therapist.id) || (choice.mode === 'gender' && choice.gender !== therapist.gender))) throw new HttpError(409, 'This therapist does not match the customer’s required preference.');
        const occupied: DemoOccupancy[] = state.bookings.filter((b) => b.id !== id);
        occupied.push({ ...booking, assignments: booking.assignments.filter((a) => a.guestId !== guest.id) });
        const schedule = findDemoSchedule({ guests: [{ ...guest, therapistChoice: { mode: 'specific', requirement: 'required', therapistId: therapist.id, gender: '' } }], date: booking.date, time: assignment.start, groupTiming: 'together', bookings: occupied, therapists: state.therapists, now: now() });
        if (!schedule) return { ok: false, reason: 'conflict', alternatives: [] };
        booking.assignments = booking.assignments.map((a) => a.guestId === guest.id ? schedule.assignments[0] : a);
        snapshotTherapists(booking, state);
      } else { throw new HttpError(400, 'Invalid booking action.'); }
      audit(state, user.email, `${body.action}: ${body.status ?? `${booking.date} ${booking.time}`}`, booking.id);
      return { ok: true, booking };
    });
  }
  function updateTherapist(id: string, raw: unknown, user: DemoStaffUser) {
    return transaction((state) => {
      const current = state.therapists.find((t) => t.id === id);
      if (!current) throw new HttpError(404, 'Therapist not found.');
      const value = object(raw);
      const profile = { ...current, ...value, id } as TherapistProfile;
      if (user.role !== 'owner') {
        for (const key of Object.keys(value)) {
          if (!['shiftStart', 'shiftEnd', 'leaveDates'].includes(key) && JSON.stringify(value[key]) !== JSON.stringify(current[key as keyof TherapistProfile])) throw new HttpError(403, 'Only the owner can edit therapist profiles and skills.');
        }
      }
      for (const key of ['name', 'specialties', 'description'] as const) {
        const localized = object(profile[key]);
        profile[key] = { en: text(localized.en, `${key} (English)`, 500, 1), zh: text(localized.zh, `${key} (Chinese)`, 500, 1) };
      }
      profile.staffNumber = text(profile.staffNumber, 'staff number', 20, 1);
      if (state.therapists.some((t) => t.id !== id && t.staffNumber === profile.staffNumber)) throw new HttpError(400, 'Staff number is already in use.');
      if (!['male', 'female'].includes(profile.gender) || typeof profile.active !== 'boolean') throw new HttpError(400, 'Invalid therapist profile.');
      profile.categoryIds = stringList(profile.categoryIds, 'service skills', catalog.map((c) => c.id));
      profile.addOnIds = stringList(profile.addOnIds, 'add-on skills', [...new Set(catalog.flatMap((c) => c.addOns.map((a) => a.id)))]);
      profile.leaveDates = stringList(profile.leaveDates, 'leave dates');
      if (profile.leaveDates.some((d) => !dateValid(d))) throw new HttpError(400, 'Invalid leave date.');
      if (!timeValid(profile.shiftStart) || !timeValid(profile.shiftEnd) || profile.shiftStart >= profile.shiftEnd) throw new HttpError(400, 'Shift end must be after shift start.');
      if (typeof profile.imageUrl !== 'string' || profile.imageUrl.length > 200_000 || !(/^\/therapists\/[\w.-]+\.(?:png|svg|webp|jpg)$/.test(profile.imageUrl) || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(profile.imageUrl))) throw new HttpError(400, 'Use a demo portrait or a PNG/JPEG/WebP image under 150 KB.');
      for (const booking of state.bookings.filter((b) => ACTIVE.includes(b.status))) {
        for (const assignment of booking.assignments.filter((a) => a.therapistId === id && appointmentDate(booking.date, a.cleanupEnd) > now())) {
          const guest = booking.guests.find((g) => g.id === assignment.guestId)!;
          const requiredPreferenceMismatch = guest.therapistChoice?.requirement === 'required'
            && !therapistMatchesPreference(profile, guest.therapistChoice);
          if (!isTherapistCompatible(profile, guest) || requiredPreferenceMismatch || profile.leaveDates.includes(booking.date) || assignment.start < profile.shiftStart || assignment.cleanupEnd > profile.shiftEnd) throw new HttpError(409, `Reassign booking ${booking.reference} before changing this therapist’s availability, profile, or skills.`);
        }
      }
      state.therapists = state.therapists.map((t) => t.id === id ? profile : t);
      audit(state, user.email, `Updated therapist ${profile.staffNumber}`);
      return { profile };
    });
  }

  const attempts = new Map<string, { count: number; until: number }>();
  async function readBody(req: IncomingMessage) {
    let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 250_000) throw new HttpError(413, 'Request too large.'); }
    try { return data ? JSON.parse(data) : {}; } catch { throw new HttpError(400, 'Invalid JSON request.'); }
  }
  function send(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const method = req.method ?? 'GET';
      if (!path.startsWith('/api/demo/')) throw new HttpError(404, 'Not found.');
      // Fetch-only mutation header and local Origin validation stop cross-site forms.
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers['x-demo-client'] !== 'serene-local') throw new HttpError(403, 'Invalid demo client.');
        if (req.headers.origin) {
          const origin = new URL(req.headers.origin);
          if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new HttpError(403, 'Local demo requests only.');
        }
      }
      if (path === '/api/demo/public-state' && method === 'GET') {
        return send(res, 200, transaction((state) => ({ version: state.version, seedDate: state.seedDate, therapists: state.therapists, bookings: state.bookings.filter((b) => [...ACTIVE, 'completed'].includes(b.status)).map(({ date, status, holdExpiresAt, assignments }) => ({ date, status, holdExpiresAt, assignments: assignments.map(({ therapistId, start, end, cleanupEnd, resourceIds }, index) => ({ guestId: `occupied-${index}`, therapistId, start, end, cleanupEnd, resourceIds })) })) })));
      }
      if (path === '/api/demo/session' && method === 'GET') return send(res, 200, { user: userFor(req) });
      if (path === '/api/demo/auth' && method === 'POST') {
        const key = req.socket.remoteAddress ?? 'local'; const previous = attempts.get(key);
        if (previous && previous.until > now().getTime() && previous.count >= 12) throw new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
        const body = object(await readBody(req)); const email = text(body.email, 'email', 200, 1).toLowerCase(); const password = text(body.password, 'password', 200, 1);
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email) as ({ id: string; email: string; name: string; role: DemoStaffRole; salt: string; password_hash: string }) | undefined;
        const supplied = scryptSync(password, user?.salt ?? 'missing-user', 64);
        if (!user || !timingSafeEqual(supplied, Buffer.from(user.password_hash, 'hex'))) {
          attempts.set(key, { count: previous && previous.until > now().getTime() ? previous.count + 1 : 1, until: previous && previous.until > now().getTime() ? previous.until : now().getTime() + 15 * 60_000 });
          throw new HttpError(401, 'Incorrect email or password.');
        }
        attempts.delete(key); const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, new Date(now().getTime() + SESSION_HOURS * 3_600_000).toISOString());
        res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/demo; Max-Age=${SESSION_HOURS * 3600}`);
        return send(res, 200, { user: { id: user.id, email: user.email, name: user.name, role: user.role, ...(user.role === 'therapist' ? { therapistId: user.id } : {}) } });
      }
      if (path === '/api/demo/auth' && method === 'DELETE') {
        const token = req.headers.cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
        res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/demo; Max-Age=0`);
        return send(res, 200, { ok: true });
      }
      if (path === '/api/demo/bookings' && method === 'POST') { const result = createBooking(await readBody(req), null); return send(res, result.ok ? 201 : 409, result.ok ? { ...result, booking: customerBooking(result.booking) } : result); }
      const receiptMatch = /^\/api\/demo\/bookings\/([^/]+)$/.exec(path);
      if (receiptMatch && method === 'GET') {
        const token = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
        const receipt = transaction((state) => {
          const booking = state.bookings.find((b) => b.id === decodeURIComponent(receiptMatch[1]));
          if (!booking?.receiptToken || !timingSafeEqual(Buffer.from(hash(booking.receiptToken)), Buffer.from(hash(token)))) throw new HttpError(404, 'Booking receipt not found.');
          return customerBooking(booking);
        });
        return send(res, 200, receipt);
      }
      const user = staffFor(req);
      if (path.startsWith('/api/demo/boss/')) {
        if (user.role !== 'owner') throw new HttpError(403, 'Only the boss account can access monthly financial records.');
        if (path === '/api/demo/boss/month' && method === 'GET') {
          const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
          return send(res, 200, readBossMonth(bossMonth(params.get('month') ?? malaysiaDateValue(now()).slice(0, 7)), params.get('statementId')));
        }
        const deductionsMatch = /^\/api\/demo\/boss\/month\/([^/]+)\/therapists\/([^/]+)$/.exec(path);
        if (deductionsMatch && method === 'PATCH') return send(res, 200, saveDeductions(bossMonth(decodeURIComponent(deductionsMatch[1])), decodeURIComponent(deductionsMatch[2]), await readBody(req), user));
        const statementMatch = /^\/api\/demo\/boss\/month\/([^/]+)\/(close|reopen)$/.exec(path);
        if (statementMatch && method === 'POST') {
          const month = bossMonth(decodeURIComponent(statementMatch[1]));
          const body = await readBody(req);
          return send(res, 200, statementMatch[2] === 'close' ? saveStatement(month, body, user) : reopenMonth(month, body, user));
        }
        throw new HttpError(404, 'Boss action not found.');
      }
      if (path === '/api/demo/staff/today-earnings' && method === 'GET') {
        const generatedAt = now();
        return send(res, 200, transaction((state) => calculateDemoDailyEarnings(state, malaysiaDateValue(generatedAt), user.therapistId, generatedAt.toISOString())));
      }
      if (path === '/api/demo/staff/state' && method === 'GET') {
        if (user.role === 'therapist') throw new HttpError(403, 'Therapists can only view their own work and earnings for today.');
        return send(res, 200, transaction((state) => state));
      }
      if (path === '/api/demo/staff/bookings' && method === 'POST') {
        if (user.role === 'therapist') throw new HttpError(403, 'Therapists cannot create bookings.');
        const result = createBooking(await readBody(req), user); return send(res, result.ok ? 201 : 409, result);
      }
      const bookingMatch = /^\/api\/demo\/staff\/bookings\/([^/]+)$/.exec(path);
      if (bookingMatch && method === 'PATCH') {
        if (user.role === 'therapist') throw new HttpError(403, 'Therapists cannot change bookings.');
        const result = updateBooking(decodeURIComponent(bookingMatch[1]), await readBody(req), user); return send(res, result.ok ? 200 : 409, result);
      }
      const therapistMatch = /^\/api\/demo\/staff\/therapists\/([^/]+)$/.exec(path);
      if (therapistMatch && method === 'PATCH') {
        if (user.role === 'therapist') throw new HttpError(403, 'Therapists cannot change profiles or schedules.');
        return send(res, 200, updateTherapist(decodeURIComponent(therapistMatch[1]), await readBody(req), user));
      }
      if (path === '/api/demo/staff/reset' && method === 'POST') {
        if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can reset demo data.');
        return send(res, 200, transaction((state) => { const fresh = initialDemoState(now()); Object.assign(state, fresh); db.prepare('DELETE FROM idempotency').run(); audit(state, user.email, 'Reset sample demo data'); return state; }));
      }
      throw new HttpError(404, 'Not found.');
    } catch (error) { if (!(error instanceof HttpError)) console.error('Local demo request failed:', error); send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'The local demo could not complete this request.' }); }
  });
  const timer = setInterval(() => { try { transaction(() => undefined); db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now().toISOString()); } catch (error) { console.error('Demo cleanup failed:', error); } }, 15_000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); db.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DEMO_API_PORT ?? 4311);
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log(`Local booking database ready at http://127.0.0.1:${port} (sample bookings only)`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
}
