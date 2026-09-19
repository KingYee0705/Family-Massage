import { bookingSettings, business, catalog, type GuestSelection, type Locale } from './catalog.ts';

export type BookingDraft = {
  guests: GuestSelection[];
  groupTiming: 'together' | 'flexible';
  date: string;
  time: string;
  contactName: string;
  contactPhone: string;
  notes: string;
};

export type DemoAvailabilitySettings = {
  firstTime: string;
  lastTime: string;
  closingTime: string;
  intervalMinutes: number;
  minimumLeadMinutes: number;
  estimatedTherapists: number;
  maximumConcurrentCustomers: number;
  turnaroundMinutes: number;
  estimatedBusyTherapistsByTime: Readonly<Record<string, number>>;
  estimatedItemDurationMinutes: Readonly<Record<string, number>>;
  estimatedAddOnDurationMinutes: Readonly<Record<string, number>>;
};

export type DemoTimeSlot = {
  time: string;
  available: boolean;
};

export type BookingValidationIssue =
  | { kind: 'guest_service'; guestIndex: number }
  | { kind: 'guest_therapist'; guestIndex: number }
  | { kind: 'date_required' }
  | { kind: 'time_required' }
  | { kind: 'past_time' }
  | { kind: 'minimum_notice' }
  | { kind: 'contact_name' }
  | { kind: 'contact_phone' };

export function getCategory(categoryId: string) {
  return catalog.find((category) => category.id === categoryId);
}

export function getMenuItem(categoryId: string, itemId: string) {
  const category = getCategory(categoryId);
  return category?.treatments.concat(category.packages).find((item) => item.id === itemId);
}

export function guestTotal(guest: GuestSelection) {
  const category = getCategory(guest.categoryId);
  const item = getMenuItem(guest.categoryId, guest.itemId);
  if (!category || !item) return 0;

  const extras = guest.addOnIds.reduce((sum, addOnId) => {
    return sum + (category.addOns.find((extra) => extra.id === addOnId)?.price ?? 0);
  }, 0);

  return item.price + extras;
}

export function orderTotal(guests: GuestSelection[]) {
  return guests.reduce((total, guest) => total + guestTotal(guest), 0);
}

export function formatRinggit(value: number) {
  return `RM ${value}`;
}

export function buildWhatsAppUrl(message: string, phone: string = business.whatsappNumber) {
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function isFutureAppointment(date: string, time: string, now = new Date(), minimumLeadMinutes = 0) {
  if (!date || !time) return false;
  const appointment = new Date(`${date}T${time}:00+08:00`);
  return !Number.isNaN(appointment.getTime())
    && appointment.getTime() >= now.getTime() + minimumLeadMinutes * 60_000;
}

export function isValidBookingPhone(phone: string) {
  const value = phone.trim();
  // Count digits, not formatting characters. Keep local numbers and ordinary
  // international formatting without treating this as contact verification.
  if (!/^\+?[0-9 ()-]+$/.test(value)) return false;
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 15
    && (!value.startsWith('+') || digits[0] !== '0');
}

export function getBookingValidationIssues(draft: BookingDraft, now = new Date()): BookingValidationIssue[] {
  const issues: BookingValidationIssue[] = [];
  draft.guests.forEach((guest, guestIndex) => {
    if (!getMenuItem(guest.categoryId, guest.itemId)) issues.push({ kind: 'guest_service', guestIndex });
    if (guest.therapistChoice?.mode === 'specific' && !guest.therapistChoice.therapistId) {
      issues.push({ kind: 'guest_therapist', guestIndex });
    }
  });
  if (!draft.date) issues.push({ kind: 'date_required' });
  if (!draft.time) issues.push({ kind: 'time_required' });
  if (draft.date && draft.time && !isFutureAppointment(draft.date, draft.time, now)) {
    issues.push({ kind: 'past_time' });
  } else if (draft.date && draft.time && !isFutureAppointment(draft.date, draft.time, now, bookingSettings.minimumLeadMinutes)) {
    issues.push({ kind: 'minimum_notice' });
  }
  if (draft.contactName.trim().length < 2) issues.push({ kind: 'contact_name' });
  if (!isValidBookingPhone(draft.contactPhone)) issues.push({ kind: 'contact_phone' });
  return issues;
}

export function createTimeSlots(firstTime: string, lastTime: string, intervalMinutes: number) {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const start = toMinutes(firstTime);
  const end = toMinutes(lastTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || intervalMinutes <= 0 || end < start) return [];

  const slots: string[] = [];
  for (let value = start; value <= end; value += intervalMinutes) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    slots.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  }
  return slots;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function estimatedGuestDuration(
  guest: GuestSelection,
  settings: DemoAvailabilitySettings = bookingSettings,
) {
  const itemMinutes = settings.estimatedItemDurationMinutes[guest.itemId];
  if (!itemMinutes) return 0;
  return itemMinutes + guest.addOnIds.reduce(
    (total, id) => total + (settings.estimatedAddOnDurationMinutes[id] ?? 0),
    0,
  );
}

export function estimateTimeSlotAvailability(
  guests: GuestSelection[],
  date: string,
  now = new Date(),
  settings: DemoAvailabilitySettings = bookingSettings,
): DemoTimeSlot[] {
  const times = createTimeSlots(settings.firstTime, settings.lastTime, settings.intervalMinutes);
  const durations = guests.map((guest) => estimatedGuestDuration(guest, settings));
  const canCalculate = Boolean(date) && durations.length > 0 && durations.every((duration) => duration > 0);
  const closingMinutes = timeToMinutes(settings.closingTime);

  return times.map((time) => {
    if (!canCalculate || !isFutureAppointment(date, time, now, settings.minimumLeadMinutes)) return { time, available: false };

    const startMinutes = timeToMinutes(time);
    const longestBooking = Math.max(...durations) + settings.turnaroundMinutes;
    if (startMinutes + longestBooking > closingMinutes) return { time, available: false };

    for (let elapsed = 0; elapsed < longestBooking; elapsed += settings.intervalMinutes) {
      const activeGuests = durations.filter(
        (duration) => elapsed < duration + settings.turnaroundMinutes,
      ).length;
      const busyTherapists = settings.estimatedBusyTherapistsByTime[minutesToTime(startMinutes + elapsed)] ?? 0;
      const capacityLimit = Math.min(settings.estimatedTherapists, settings.maximumConcurrentCustomers);
      if (busyTherapists + activeGuests > capacityLimit) {
        return { time, available: false };
      }
    }

    return { time, available: true };
  });
}

export function createReference(now = new Date(), random = Math.random()) {
  const date = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const suffix = Math.floor(random * 36 ** 4).toString(36).padStart(4, '0').toUpperCase();
  return `SFM-${date}-${suffix}`;
}

function displayDate(date: string) {
  const value = new Date(`${date}T00:00:00+08:00`);
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value);
}

export function buildOrderMessage(
  draft: BookingDraft,
  reference: string,
  locale: Locale,
  status: 'request' | 'confirmed' | 'pending' | 'checked_in' | 'in_service' | 'completed' | 'cancelled' | 'no_show' | 'expired' = 'request',
  assignments: { guestId: string; therapist: string; start: string; end: string }[] = [],
) {
  const guestBlocks = draft.guests.flatMap((guest, index) => {
    const category = getCategory(guest.categoryId);
    const item = getMenuItem(guest.categoryId, guest.itemId);
    if (!category || !item) return [];
    const extras = guest.addOnIds
      .map((id) => category.addOns.find((entry) => entry.id === id))
      .filter((entry) => Boolean(entry));
    const name = guest.name.trim() ? ` - ${guest.name.trim()}` : '';
    const lines = [
      `*GUEST ${index + 1}${name}*`,
      '',
      `Service: ${category.name.en}`,
      `${item.kind === 'package' ? 'Package' : 'Session'}: ${item.name.en} (${formatRinggit(item.price)})`,
    ];
    if (extras.length) lines.push('', 'Add-ons:');
    extras.forEach((extra) => lines.push(`- ${extra!.name.en} (${formatRinggit(extra!.price)})`));
    if (guest.therapistPreference.trim()) {
      lines.push('', `Therapist preference: ${guest.therapistPreference.trim()}`);
    }
    const assignment = assignments.find((entry) => entry.guestId === guest.id);
    if (assignment) lines.push('', `Assigned: ${assignment.therapist}`, `Session time: ${assignment.start}–${assignment.end} (Malaysia time)`);
    lines.push('', `*Guest subtotal: ${formatRinggit(guestTotal(guest))}*`);
    return [lines.join('\n')];
  });

  const lines = [
    status === 'request' ? '*NEW BOOKING DRAFT*' : '*DEMO TEST BOOKING — NOT A REAL APPOINTMENT*',
    business.name,
    `Ref: ${reference}`,
    status === 'request' ? '_Live capacity has not been checked_' : status === 'pending' ? '_Legacy demo hold · awaiting staff action_' : `_Demo status: ${status.replaceAll('_', ' ')}_`,
    '',
    '*APPOINTMENT*',
    '',
    `Date: ${displayDate(draft.date)}`,
    `Time: ${draft.time}`,
    `Guests: ${draft.guests.length}`,
    ...(draft.guests.length > 1 ? [`Group timing: ${draft.groupTiming === 'flexible' ? 'Flexible or staggered starts are okay' : 'Prefer to start together'}`] : []),
    '',
    ...guestBlocks.flatMap((block) => [block, '']),
    '*CUSTOMER*',
    '',
    `Name: ${draft.contactName.trim()}`,
    `WhatsApp: ${draft.contactPhone.trim()}`,
    ...(draft.notes.trim() ? [`Notes: ${draft.notes.trim()}`] : []),
    '',
    `*ESTIMATED TOTAL: ${formatRinggit(orderTotal(draft.guests))}*`,
    '',
    '*STAFF ACTION*',
    '',
    status !== 'request' && status !== 'pending'
      ? 'This sample appointment is already saved in the demo dashboard.'
      : status === 'pending'
        ? 'Open the demo dashboard to manage this older pending hold.'
        : 'Submit this draft through the live booking system before treating it as reserved.',
    '',
    status !== 'request'
      ? (locale === 'zh' ? '_仅供产品测试，不构成真实预约。_' : '_Product test only. No real shop appointment has been made._')
      : locale === 'zh'
        ? '_完成实时空位检查前，此预约草稿不会保留任何时段。_'
        : '_This draft is not reserved until the live capacity check succeeds._',
  ];

  return lines.join('\n');
}
