import {
  bookingSettings,
  catalog,
  type GuestSelection,
  type LocalizedText,
  type TherapistChoice,
  type TherapistGender,
} from './catalog.ts';
import {
  createTimeSlots,
  estimatedGuestDuration,
  getMenuItem,
  guestTotal,
} from './order.ts';

export type TherapistProfile = {
  id: string;
  staffNumber: string;
  name: LocalizedText;
  gender: TherapistGender;
  imageUrl: string;
  specialties: LocalizedText;
  description: LocalizedText;
  categoryIds: string[];
  addOnIds: string[];
  leaveDates: string[];
  shiftStart: string;
  shiftEnd: string;
  active: boolean;
};

export type DemoBookingStatus =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'in_service'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired';

export type DemoBookingSource = 'online' | 'phone' | 'whatsapp' | 'walk_in';
export type DemoResourceType = 'bed' | 'chair';

export type DemoAssignment = {
  guestId: string;
  therapistId: string;
  start: string;
  end: string;
  cleanupEnd: string;
  resourceIds: string[];
};

export type DemoAddOnSale = {
  id: string;
  guestId: string;
  therapistId: string;
  addOnId: string;
  name: LocalizedText;
  price: number;
  addedMinutes: number;
  source: 'counter' | 'during_service';
  addedAt: string;
  recordedBy?: string;
};

export type DemoBooking = {
  id: string;
  reference: string;
  source: DemoBookingSource;
  date: string;
  time: string;
  groupTiming: 'together' | 'flexible';
  contactName: string;
  contactPhone: string;
  notes: string;
  guests: GuestSelection[];
  assignments: DemoAssignment[];
  total: number;
  status: DemoBookingStatus;
  createdAt: string;
  holdExpiresAt: string | null;
  receiptToken?: string;
  priceSnapshots?: { guestId: string; category: LocalizedText; item: LocalizedText; itemPrice: number; addOns: { id: string; name: LocalizedText; price: number }[]; total: number }[];
  therapistSnapshots?: { guestId: string; therapistId: string; staffNumber: string; name: LocalizedText }[];
  addOnSales?: DemoAddOnSale[];
};

export type DemoOccupancy = Pick<DemoBooking, 'date' | 'status' | 'holdExpiresAt' | 'assignments'>;
export type DemoStaffRole = 'owner' | 'receptionist' | 'therapist';
export type DemoStaffUser = { id: string; email: string; name: string; role: DemoStaffRole; therapistId?: string };
export type DemoAuditEntry = { id: string; at: string; actor: string; action: string; bookingId?: string };

export type DemoEarningLine = {
  bookingId: string;
  reference: string;
  guestId: string;
  therapistId: string;
  start: string;
  end: string;
  customerName: string;
  guestName: string;
  service: LocalizedText;
  addOns: LocalizedText[];
  gross: number;
};

export type DemoTherapistDailyEarnings = {
  therapistId: string;
  staffNumber: string;
  name: LocalizedText;
  imageUrl: string;
  completedTreatments: number;
  gross: number;
  lines: DemoEarningLine[];
};

export type DemoDailyEarnings = {
  date: string;
  generatedAt: string;
  completedTreatments: number;
  gross: number;
  therapists: DemoTherapistDailyEarnings[];
};

export type DemoState = {
  version: 3;
  seedDate: string;
  therapists: TherapistProfile[];
  bookings: DemoBooking[];
  audit: DemoAuditEntry[];
};
export type DemoPublicState = Omit<DemoState, 'bookings' | 'audit'> & { bookings: DemoOccupancy[] };

export type DemoScheduleResult = {
  assignments: DemoAssignment[];
  usedFallbackPreference: boolean;
};

export type DemoSlot = {
  time: string;
  available: boolean;
};

export type DemoReservationInput = {
  date: string;
  time: string;
  groupTiming: 'together' | 'flexible';
  contactName: string;
  contactPhone: string;
  notes: string;
  guests: GuestSelection[];
  source?: DemoBookingSource;
  idempotencyKey?: string;
};

export type DemoReservationResult =
  | { ok: true; booking: DemoBooking }
  | { ok: false; reason: 'conflict'; alternatives: string[] };

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function calculateDemoDailyEarnings(
  state: DemoState,
  date: string,
  therapistId?: string,
  generatedAt = new Date().toISOString(),
): DemoDailyEarnings {
  const profiles = state.therapists
    .filter((therapist) => !therapistId || therapist.id === therapistId)
    .sort((a, b) => a.staffNumber.localeCompare(b.staffNumber));
  const linesByTherapist = new Map(profiles.map((therapist) => [therapist.id, [] as DemoEarningLine[]]));

  for (const booking of state.bookings.filter((entry) => entry.date === date && entry.status === 'completed')) {
    for (const assignment of booking.assignments) {
      const lines = linesByTherapist.get(assignment.therapistId);
      if (!lines) continue;
      const guest = booking.guests.find((entry) => entry.id === assignment.guestId);
      if (!guest) continue;
      const category = catalog.find((entry) => entry.id === guest.categoryId);
      const item = getMenuItem(guest.categoryId, guest.itemId);
      const snapshot = booking.priceSnapshots?.find((entry) => entry.guestId === guest.id);
      const gross = snapshot?.total ?? guestTotal(guest);
      lines.push({
        bookingId: booking.id,
        reference: booking.reference,
        guestId: guest.id,
        therapistId: assignment.therapistId,
        start: assignment.start,
        end: assignment.end,
        customerName: booking.contactName,
        guestName: guest.name,
        service: snapshot?.item ?? item?.name ?? { en: guest.itemId, zh: guest.itemId },
        addOns: snapshot?.addOns.map((entry) => entry.name)
          ?? guest.addOnIds.map((id) => category?.addOns.find((entry) => entry.id === id)?.name).filter((entry): entry is LocalizedText => Boolean(entry)),
        gross,
      });
    }
  }

  const therapists = profiles.map((profile): DemoTherapistDailyEarnings => {
    const lines = (linesByTherapist.get(profile.id) ?? []).sort((a, b) => a.start.localeCompare(b.start));
    return {
      therapistId: profile.id,
      staffNumber: profile.staffNumber,
      name: profile.name,
      imageUrl: profile.imageUrl,
      completedTreatments: lines.length,
      gross: roundMoney(lines.reduce((sum, line) => sum + line.gross, 0)),
      lines,
    };
  });
  return {
    date,
    generatedAt,
    completedTreatments: therapists.reduce((sum, entry) => sum + entry.completedTreatments, 0),
    gross: roundMoney(therapists.reduce((sum, entry) => sum + entry.gross, 0)),
    therapists,
  };
}

const STATE_EVENT = 'serene-demo-state-change';
const BLOCKING_STATUSES = new Set<DemoBookingStatus>(['pending', 'confirmed', 'checked_in', 'in_service', 'completed']);
const BED_IDS = Array.from({ length: bookingSettings.massageBeds }, (_, index) => `bed-${index + 1}`);
const CHAIR_IDS = Array.from({ length: bookingSettings.footMassageChairs }, (_, index) => `chair-${index + 1}`);

export const emptyTherapistChoice = (): TherapistChoice => ({
  mode: 'none',
  requirement: 'preferred',
  gender: '',
  therapistId: '',
});

export const sampleTherapists: TherapistProfile[] = [
  {
    id: 'therapist-01',
    staffNumber: 'S01',
    name: { en: 'Mei', zh: '美' },
    gender: 'female',
    imageUrl: '/therapists/therapist-01.png',
    specialties: { en: 'Aromatherapy · Relaxation', zh: '精油按摩 · 舒缓放松' },
    description: { en: 'Gentle, calming techniques for guests who prefer a slower pace.', zh: '擅长温和舒缓的手法，适合喜欢慢节奏放松的客人。' },
    categoryIds: ['aromatherapy', 'full-body'],
    addOnIds: ['thai-balm', 'coconut-oil', 'aroma-oil', 'ear-candling', 'body-scrubbing'],
    leaveDates: [],
    shiftStart: '11:00',
    shiftEnd: '23:59',
    active: true,
  },
  {
    id: 'therapist-02',
    staffNumber: 'S02',
    name: { en: 'Jian', zh: '健' },
    gender: 'male',
    imageUrl: '/therapists/therapist-02.png',
    specialties: { en: 'Thai stretching · Firm pressure', zh: '泰式拉伸 · 深层按压' },
    description: { en: 'Focused stretching and firmer pressure for tired, tense muscles.', zh: '擅长伸展与较有力度的按压，帮助舒缓紧绷肌肉。' },
    categoryIds: ['thai', 'full-body'],
    addOnIds: ['thai-balm', 'coconut-oil', 'aroma-oil', 'gua-sha', 'cupping', 'fire-cupping', 'bleeding-cupping', 'body-scrubbing'],
    leaveDates: [],
    shiftStart: '11:00',
    shiftEnd: '23:59',
    active: true,
  },
  {
    id: 'therapist-03',
    staffNumber: 'S03',
    name: { en: 'Lina', zh: '丽娜' },
    gender: 'female',
    imageUrl: '/therapists/therapist-03.png',
    specialties: { en: 'Foot care · Gua Sha', zh: '足部护理 · 刮痧' },
    description: { en: 'Detailed foot care and balanced full-body relaxation treatments.', zh: '细致的足部护理，并擅长平衡舒适的全身放松疗程。' },
    categoryIds: ['foot', 'full-body', 'aromatherapy'],
    addOnIds: ['herbal-bag', 'thai-balm', 'coconut-oil', 'aroma-oil', 'ear-candling', 'foot-scrubbing', 'gua-sha', 'cupping', 'shoulder-15', 'shoulder-30'],
    leaveDates: [],
    shiftStart: '11:00',
    shiftEnd: '23:59',
    active: true,
  },
  {
    id: 'therapist-04',
    staffNumber: 'S04',
    name: { en: 'Ray', zh: '睿' },
    gender: 'male',
    imageUrl: '/therapists/therapist-04.png',
    specialties: { en: 'Traditional Thai · Mobility', zh: '传统泰式 · 身体伸展' },
    description: { en: 'Rhythmic Thai techniques designed to improve comfort and mobility.', zh: '运用有节奏的传统泰式手法，帮助身体舒展与活动。' },
    categoryIds: ['thai', 'full-body'],
    addOnIds: ['thai-balm', 'coconut-oil', 'aroma-oil', 'ear-candling', 'gua-sha', 'cupping', 'fire-cupping', 'body-scrubbing'],
    leaveDates: [],
    shiftStart: '11:00',
    shiftEnd: '23:59',
    active: true,
  },
  {
    id: 'therapist-05',
    staffNumber: 'S05',
    name: { en: 'Suki', zh: '淑琪' },
    gender: 'female',
    imageUrl: '/therapists/therapist-05.png',
    specialties: { en: 'Foot massage · Aromatherapy', zh: '足部按摩 · 精油按摩' },
    description: { en: 'Warm, attentive care with a focus on feet and gentle aromatherapy.', zh: '细心温暖的服务，专长足部按摩及温和精油护理。' },
    categoryIds: ['foot', 'aromatherapy'],
    addOnIds: ['herbal-bag', 'thai-balm', 'coconut-oil', 'ear-candling', 'foot-scrubbing', 'cupping', 'body-scrubbing', 'shoulder-15', 'shoulder-30'],
    leaveDates: [],
    shiftStart: '11:00',
    shiftEnd: '23:59',
    active: true,
  },
  {
    id: 'therapist-06',
    staffNumber: 'S06',
    name: { en: 'Kai', zh: '凯' },
    gender: 'male',
    imageUrl: '/therapists/therapist-06.png',
    specialties: { en: 'Family groups · Mixed treatments', zh: '家庭同行 · 综合疗程' },
    description: { en: 'Versatile techniques and broad treatment experience for group visits.', zh: '手法多样、疗程经验全面，适合家庭及多人同行预约。' },
    categoryIds: ['aromatherapy', 'thai', 'full-body', 'foot'],
    addOnIds: [...new Set(catalog.flatMap((category) => category.addOns.map((extra) => extra.id)))],
    leaveDates: [],
    shiftStart: '12:00',
    shiftEnd: '23:59',
    active: true,
  },
];

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function malaysiaDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+08:00`);
}

export function malaysiaDateValue(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function therapistChoiceLabel(choice: TherapistChoice | undefined, locale: 'en' | 'zh', therapists = sampleTherapists) {
  if (!choice || choice.mode === 'none') return locale === 'zh' ? '无偏好' : 'No preference';
  const strength = choice.requirement === 'required'
    ? (locale === 'zh' ? '必须安排' : 'Required')
    : (locale === 'zh' ? '尽量安排' : 'Preferred');
  if (choice.mode === 'gender') {
    const gender = choice.gender === 'female'
      ? (locale === 'zh' ? '女按摩师' : 'Female therapist')
      : (locale === 'zh' ? '男按摩师' : 'Male therapist');
    return `${gender} · ${strength}`;
  }
  const therapist = therapists.find((entry) => entry.id === choice.therapistId);
  return therapist ? `${therapist.staffNumber} · ${therapist.name[locale]} · ${strength}` : strength;
}

export function isTherapistCompatible(therapist: TherapistProfile, guest: GuestSelection) {
  return therapist.active && getRequiredCategoryIds(guest).every((id) => therapist.categoryIds.includes(id))
    && getRequiredAddOnIds(guest).every((id) => therapist.addOnIds.includes(id));
}

export function therapistMatchesPreference(
  therapist: Pick<TherapistProfile, 'id' | 'gender'>,
  choice: TherapistChoice | undefined,
) {
  if (!choice || choice.mode === 'none') return true;
  if (choice.mode === 'specific') return therapist.id === choice.therapistId;
  return therapist.gender === choice.gender;
}

export function getIncludedAddonIds(guest: Pick<GuestSelection, 'itemId'>): string[] {
  const suffix = guest.itemId.split('-pkg-')[1];
  return ({ ear: ['ear-candling'], cupping: ['cupping'], guasha: ['gua-sha'], scrub: [guest.itemId.startsWith('foot-') ? 'foot-scrubbing' : 'body-scrubbing'], shoulder: ['shoulder-30'] } as Record<string, string[]>)[suffix] ?? [];
}

export function getRequiredCategoryIds(guest: GuestSelection): string[] {
  if (['aroma-pkg-foot', 'thai-pkg-foot', 'body-pkg-foot'].includes(guest.itemId)) return [guest.categoryId, 'foot'];
  if (['foot-pkg-body-30', 'foot-pkg-body-first', 'foot-pkg-body-60'].includes(guest.itemId)) return ['foot', 'full-body'];
  return [guest.categoryId];
}

export function getRequiredAddOnIds(guest: GuestSelection): string[] {
  return [...new Set([...guest.addOnIds, ...getIncludedAddonIds(guest)])];
}

function desiredTherapists(guest: GuestSelection, therapists: TherapistProfile[]) {
  const compatible = therapists.filter((therapist) => isTherapistCompatible(therapist, guest));
  const choice = guest.therapistChoice ?? emptyTherapistChoice();
  if (choice.mode === 'none') return { therapists: compatible, hasFallback: false };

  const desired = compatible.filter((therapist) => therapistMatchesPreference(therapist, choice));
  if (choice.requirement === 'required') return { therapists: desired, hasFallback: false };
  return {
    therapists: [...desired, ...compatible.filter((therapist) => !desired.some((entry) => entry.id === therapist.id))],
    hasFallback: desired.length > 0,
  };
}

function requiredResourceTypes(guest: GuestSelection): DemoResourceType[] {
  const mixedResourceItems = new Set([
    'aroma-pkg-foot',
    'thai-pkg-foot',
    'body-pkg-foot',
    'foot-pkg-body-30',
    'foot-pkg-body-first',
    'foot-pkg-body-60',
  ]);
  if (mixedResourceItems.has(guest.itemId)) return ['bed', 'chair'];
  return guest.categoryId === 'foot' ? ['chair'] : ['bed'];
}

function availableResourceIds(
  types: DemoResourceType[],
  start: number,
  end: number,
  occupied: DemoAssignment[],
) {
  const selected: string[] = [];
  for (const type of types) {
    const candidates = type === 'bed' ? BED_IDS : CHAIR_IDS;
    const id = candidates.find((candidate) => !occupied.some((assignment) => (
      assignment.resourceIds.includes(candidate)
      && intervalsOverlap(start, end, timeToMinutes(assignment.start), timeToMinutes(assignment.cleanupEnd))
    )));
    if (!id) return null;
    selected.push(id);
  }
  return selected;
}

function blockingAssignments(bookings: DemoOccupancy[], date: string, now: Date) {
  return bookings.flatMap((booking) => {
    if (booking.date !== date || !BLOCKING_STATUSES.has(booking.status)) return [];
    if (booking.status === 'pending' && booking.holdExpiresAt && new Date(booking.holdExpiresAt) <= now) return [];
    return booking.assignments;
  });
}

// Later extras extend the same therapist, start and bed/chair. Re-running the
// group allocator could silently move another guest or switch an occupied bed.
export function extendDemoAssignment(args: {
  guest: GuestSelection;
  assignment: DemoAssignment;
  addedMinutes: number;
  date: string;
  therapist: TherapistProfile;
  bookings: DemoOccupancy[];
  now?: Date;
  inService?: boolean;
}): DemoAssignment | null {
  const { assignment, therapist, addedMinutes } = args;
  const now = args.now ?? new Date();
  if (!Number.isInteger(addedMinutes) || addedMinutes < 0
    || therapist.id !== assignment.therapistId || !isTherapistCompatible(therapist, args.guest)
    || therapist.leaveDates.includes(args.date)) return null;
  const start = timeToMinutes(assignment.start);
  const originalEnd = timeToMinutes(assignment.end);
  // A service may already have overrun. A new timed extra must reserve future
  // time as well, rather than recording its whole extension in the past.
  const dayStart = new Date(`${args.date}T00:00:00+08:00`).getTime();
  const currentMinute = Math.ceil((now.getTime() - dayStart) / 300_000) * 5;
  const extensionStart = args.inService && addedMinutes > 0 ? Math.max(originalEnd, currentMinute) : originalEnd;
  const end = extensionStart + addedMinutes;
  const cleanupEnd = end + bookingSettings.turnaroundMinutes;
  if (start < timeToMinutes(therapist.shiftStart) || cleanupEnd > timeToMinutes(therapist.shiftEnd)
    || cleanupEnd > timeToMinutes(bookingSettings.closingTime)) return null;
  const occupied = blockingAssignments(args.bookings, args.date, now);
  if (occupied.some((other) => intervalsOverlap(start, cleanupEnd, timeToMinutes(other.start), timeToMinutes(other.cleanupEnd))
    && (other.therapistId === assignment.therapistId || other.resourceIds.some((id) => assignment.resourceIds.includes(id))))) return null;
  for (let minute = start; minute < cleanupEnd; minute += 5) {
    if (occupied.filter((other) => intervalsOverlap(minute, Math.min(minute + 5, cleanupEnd), timeToMinutes(other.start), timeToMinutes(other.cleanupEnd))).length >= bookingSettings.maximumConcurrentCustomers) return null;
  }
  return { ...assignment, end: minutesToTime(end), cleanupEnd: minutesToTime(cleanupEnd) };
}

function offsetChoices(duration: number, longestDuration: number, flexible: boolean) {
  if (!flexible) return [0];
  const preferred = Math.min(30, Math.max(0, roundToFive(longestDuration - duration)));
  return Array.from(new Set([
    preferred,
    ...Array.from({ length: 7 }, (_, index) => index * 5),
  ])).sort((a, b) => {
    const finishA = a + duration;
    const finishB = b + duration;
    return Math.abs(longestDuration - finishA) - Math.abs(longestDuration - finishB);
  });
}

export function findDemoSchedule(args: {
  guests: GuestSelection[];
  date: string;
  time: string;
  groupTiming: 'together' | 'flexible';
  bookings: DemoOccupancy[];
  therapists: TherapistProfile[];
  now?: Date;
}): DemoScheduleResult | null {
  const now = args.now ?? new Date();
  if (!args.guests.length || args.guests.length > bookingSettings.maximumConcurrentCustomers || new Set(args.guests.map((g) => g.id)).size !== args.guests.length || args.guests.some((guest) => !getMenuItem(guest.categoryId, guest.itemId))) return null;

  const durations = args.guests.map((guest) => estimatedGuestDuration(guest));
  if (durations.some((duration) => duration <= 0)) return null;
  const longestDuration = Math.max(...durations);
  const baseStart = timeToMinutes(args.time);
  if (!Number.isFinite(baseStart) || baseStart < timeToMinutes(bookingSettings.firstTime)) return null;
  const existing = blockingAssignments(args.bookings, args.date, now);
  const working: DemoAssignment[] = [];
  let usedFallbackPreference = false;

  const queue = args.guests.map((guest, index) => {
    const options = desiredTherapists(guest, args.therapists);
    return { guest, duration: durations[index], options };
  }).sort((a, b) => a.options.therapists.length - b.options.therapists.length || b.duration - a.duration);

  // Every supported treatment overlaps the group's first 30-minute start window.
  // A distinct-therapist matching precheck avoids exponential impossible groups.
  for (let mask = 1; mask < 1 << queue.length; mask += 1) {
    const subset = queue.filter((_, index) => (mask & (1 << index)) !== 0);
    if (new Set(subset.flatMap((entry) => entry.options.therapists.map((t) => t.id))).size < subset.length) return null;
  }
  let searchSteps = 0;

  function assign(index: number): boolean {
    if (index >= queue.length) return true;
    const entry = queue[index];
    const choice = entry.guest.therapistChoice ?? emptyTherapistChoice();
    const offsets = offsetChoices(entry.duration, longestDuration, args.groupTiming === 'flexible');

    for (const offset of offsets) {
      const start = baseStart + offset;
      const end = start + entry.duration;
      const cleanupEnd = end + bookingSettings.turnaroundMinutes;
      if (cleanupEnd > timeToMinutes(bookingSettings.closingTime)) continue;

      for (let therapistIndex = 0; therapistIndex < entry.options.therapists.length; therapistIndex += 1) {
        if (++searchSteps > 12_000) return false;
        const therapist = entry.options.therapists[therapistIndex];
        if (therapist.leaveDates.includes(args.date)) continue;
        if (start < timeToMinutes(therapist.shiftStart) || cleanupEnd > timeToMinutes(therapist.shiftEnd)) continue;
        const occupied = [...existing, ...working];
        let overCapacity = false;
        for (let minute = start; minute < cleanupEnd; minute += 5) {
          if (occupied.filter((a) => intervalsOverlap(minute, Math.min(minute + 5, cleanupEnd), timeToMinutes(a.start), timeToMinutes(a.cleanupEnd))).length >= bookingSettings.maximumConcurrentCustomers) {
            overCapacity = true;
            break;
          }
        }
        if (overCapacity) continue;
        const therapistBusy = occupied.some((assignment) => (
          assignment.therapistId === therapist.id
          && intervalsOverlap(start, cleanupEnd, timeToMinutes(assignment.start), timeToMinutes(assignment.cleanupEnd))
        ));
        if (therapistBusy) continue;
        const resourceIds = availableResourceIds(requiredResourceTypes(entry.guest), start, cleanupEnd, occupied);
        if (!resourceIds) continue;

        working.push({
          guestId: entry.guest.id,
          therapistId: therapist.id,
          start: minutesToTime(start),
          end: minutesToTime(end),
          cleanupEnd: minutesToTime(cleanupEnd),
          resourceIds,
        });
        const matchesPreference = therapistMatchesPreference(therapist, choice);
        const isFallback = choice.requirement === 'preferred' && !matchesPreference;
        const previousFallback = usedFallbackPreference;
        if (isFallback) usedFallbackPreference = true;
        if (assign(index + 1)) return true;
        usedFallbackPreference = previousFallback;
        working.pop();
      }
    }
    return false;
  }

  if (!assign(0)) return null;
  return {
    assignments: args.guests.map((guest) => working.find((assignment) => assignment.guestId === guest.id)!),
    usedFallbackPreference,
  };
}

export function calculateDemoAvailability(args: {
  guests: GuestSelection[];
  date: string;
  groupTiming: 'together' | 'flexible';
  bookings: DemoOccupancy[];
  therapists: TherapistProfile[];
  now?: Date;
}) {
  const now = args.now ?? new Date();
  return createTimeSlots(bookingSettings.firstTime, bookingSettings.lastTime, bookingSettings.intervalMinutes).map((time): DemoSlot => {
    const appointment = malaysiaDateTime(args.date, time);
    const meetsNotice = args.date && appointment.getTime() >= now.getTime() + bookingSettings.minimumLeadMinutes * 60_000;
    if (!meetsNotice) return { time, available: false };
    return {
      time,
      available: Boolean(findDemoSchedule({ ...args, time, now })),
    };
  });
}

export function nearestAvailableTimes(selectedTime: string, slots: DemoSlot[], count = 3) {
  const selected = timeToMinutes(selectedTime);
  return slots.filter((slot) => slot.available)
    .sort((a, b) => Math.abs(timeToMinutes(a.time) - selected) - Math.abs(timeToMinutes(b.time) - selected))
    .slice(0, count)
    .map((slot) => slot.time);
}

function makeGuest(id: string, name: string, categoryId: string, itemId: string): GuestSelection {
  return {
    id,
    name,
    categoryId,
    itemId,
    addOnIds: [],
    therapistPreference: '',
    therapistChoice: emptyTherapistChoice(),
  };
}

function seedBooking(args: {
  id: string;
  date: string;
  time: string;
  therapistId: string;
  resourceIds: string[];
  guest: GuestSelection;
  contactName: string;
  status: DemoBookingStatus;
  source: DemoBookingSource;
  createdAt: Date;
}): DemoBooking {
  const duration = estimatedGuestDuration(args.guest);
  const start = timeToMinutes(args.time);
  return {
    id: args.id,
    reference: `DEMO-${args.id.toUpperCase()}`,
    source: args.source,
    date: args.date,
    time: args.time,
    groupTiming: 'together',
    contactName: args.contactName,
    contactPhone: '01X-XXX XXXX',
    notes: 'Sample booking — not a real customer',
    guests: [args.guest],
    assignments: [{
      guestId: args.guest.id,
      therapistId: args.therapistId,
      start: args.time,
      end: minutesToTime(start + duration),
      cleanupEnd: minutesToTime(start + duration + bookingSettings.turnaroundMinutes),
      resourceIds: args.resourceIds,
    }],
    total: guestTotal(args.guest),
    status: args.status,
    createdAt: args.createdAt.toISOString(),
    holdExpiresAt: args.status === 'pending' ? new Date(args.createdAt.getTime() + 30 * 60_000).toISOString() : null,
  };
}

export function initialDemoState(now = new Date()): DemoState {
  const today = malaysiaDateValue(now);
  const tomorrow = addDays(today, 1);
  const seedNow = new Date(now);
  return {
    version: 3,
    seedDate: today,
    therapists: structuredClone(sampleTherapists),
    audit: [],
    bookings: [
      seedBooking({ id: 'a101', date: today, time: '11:00', therapistId: 'therapist-01', resourceIds: ['bed-1'], guest: makeGuest('sample-a', 'Sample A', 'full-body', 'body-60'), contactName: 'Sample customer', status: 'completed', source: 'walk_in', createdAt: seedNow }),
      seedBooking({ id: 'a102', date: today, time: '13:00', therapistId: 'therapist-02', resourceIds: ['bed-2'], guest: makeGuest('sample-b', 'Sample B', 'thai', 'thai-120'), contactName: 'Sample customer', status: 'confirmed', source: 'phone', createdAt: seedNow }),
      seedBooking({ id: 'a103', date: today, time: '14:00', therapistId: 'therapist-03', resourceIds: ['chair-1'], guest: makeGuest('sample-c', 'Sample C', 'foot', 'foot-60'), contactName: 'Sample customer', status: 'in_service', source: 'whatsapp', createdAt: seedNow }),
      seedBooking({ id: 'a104', date: today, time: '18:30', therapistId: 'therapist-05', resourceIds: ['bed-3'], guest: makeGuest('sample-d', 'Sample D', 'aromatherapy', 'aroma-90'), contactName: 'Sample customer', status: 'confirmed', source: 'online', createdAt: seedNow }),
      seedBooking({ id: 'a105', date: today, time: '20:00', therapistId: 'therapist-06', resourceIds: ['chair-2'], guest: makeGuest('sample-e', 'Sample E', 'foot', 'foot-60'), contactName: 'Sample customer', status: 'confirmed', source: 'online', createdAt: seedNow }),
      seedBooking({ id: 'a201', date: tomorrow, time: '14:00', therapistId: 'therapist-01', resourceIds: ['bed-1'], guest: makeGuest('sample-f', 'Sample F', 'aromatherapy', 'aroma-120'), contactName: 'Sample customer', status: 'confirmed', source: 'phone', createdAt: seedNow }),
      seedBooking({ id: 'a202', date: tomorrow, time: '14:00', therapistId: 'therapist-02', resourceIds: ['bed-2'], guest: makeGuest('sample-g', 'Sample G', 'thai', 'thai-120'), contactName: 'Sample customer', status: 'confirmed', source: 'whatsapp', createdAt: seedNow }),
    ],
  };
}

export function expirePending(state: DemoState, now = new Date()) {
  let changed = false;
  const bookings = state.bookings.map((booking) => {
    if (booking.status !== 'pending' || !booking.holdExpiresAt || new Date(booking.holdExpiresAt) > now) return booking;
    changed = true;
    return { ...booking, status: 'expired' as const };
  });
  return { state: changed ? { ...state, bookings } : state, changed };
}

export class DemoApiError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.name = 'DemoApiError'; this.status = status; }
}

async function demoRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/demo${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Demo-Client': 'serene-local' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new DemoApiError('The local booking server is unavailable. Start the local demo and try again.'); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new DemoApiError('The local booking server is unavailable.'); }
  if (!response.ok && !(response.status === 409 && (data as { reason?: string }).reason === 'conflict')) {
    throw new DemoApiError((data as { error?: string }).error ?? 'Unable to complete this request.', response.status);
  }
  if (method !== 'GET' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STATE_EVENT));
  return data as T;
}

export const loadDemoState = () => demoRequest<DemoPublicState>('/public-state');
export const loadStaffDemoState = () => demoRequest<DemoState>('/staff/state');
export const loadTodayDemoEarnings = () => demoRequest<DemoDailyEarnings>('/staff/today-earnings');
export async function getDemoSession() { return (await demoRequest<{ user: DemoStaffUser | null }>('/session')).user; }
export async function loginDemoStaff(email: string, password: string) { return (await demoRequest<{ user: DemoStaffUser }>('/auth', 'POST', { email, password })).user; }
export async function logoutDemoStaff() { await demoRequest('/auth', 'DELETE'); }
export const reserveDemoBooking = (input: DemoReservationInput) => demoRequest<DemoReservationResult>('/bookings', 'POST', { ...input, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() });
export const readDemoBooking = (id: string, receiptToken: string) => demoRequest<DemoBooking>(`/bookings/${encodeURIComponent(id)}?token=${encodeURIComponent(receiptToken)}`);
export const reserveStaffDemoBooking = (input: DemoReservationInput) => demoRequest<DemoReservationResult>('/staff/bookings', 'POST', { ...input, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() });
export async function updateDemoBookingStatus(id: string, status: DemoBookingStatus) { return (await demoRequest<{ ok: true; booking: DemoBooking }>(`/staff/bookings/${encodeURIComponent(id)}`, 'PATCH', { action: 'status', status })).booking; }
export const rescheduleDemoBooking = (id: string, date: string, time: string, groupTiming?: 'together' | 'flexible') => demoRequest<DemoReservationResult>(`/staff/bookings/${encodeURIComponent(id)}`, 'PATCH', { action: 'reschedule', date, time, groupTiming });
export const reassignDemoBooking = (id: string, guestId: string, therapistId: string) => demoRequest<DemoReservationResult>(`/staff/bookings/${encodeURIComponent(id)}`, 'PATCH', { action: 'reassign', guestId, therapistId });
export const addDemoBookingAddOns = (id: string, guestId: string, addOnIds: string[], source: DemoAddOnSale['source']) => demoRequest<DemoReservationResult>(`/staff/bookings/${encodeURIComponent(id)}`, 'PATCH', { action: 'add_addons', guestId, addOnIds, source });
export async function updateDemoTherapist(profile: TherapistProfile) { return (await demoRequest<{ profile: TherapistProfile }>(`/staff/therapists/${encodeURIComponent(profile.id)}`, 'PATCH', profile)).profile; }
export const resetDemoState = () => demoRequest<DemoState>('/staff/reset', 'POST');

export function subscribeDemoState(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const timer = window.setInterval(callback, 15_000);
  window.addEventListener(STATE_EVENT, callback);
  window.addEventListener('focus', callback);
  return () => { window.clearInterval(timer); window.removeEventListener(STATE_EVENT, callback); window.removeEventListener('focus', callback); };
}

export function demoBookingServiceName(booking: DemoBooking, locale: 'en' | 'zh') {
  return booking.guests.map((guest) => {
    const item = getMenuItem(guest.categoryId, guest.itemId);
    return item?.name[locale] ?? guest.itemId;
  }).join(', ');
}

export function catalogCategoryOptions() {
  return catalog.map((category) => ({ id: category.id, name: category.name }));
}
