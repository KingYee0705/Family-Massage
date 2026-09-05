import { bookingSettings, business, catalog, type GuestSelection, type Locale } from './catalog.ts';

export type BookingDraft = {
  guests: GuestSelection[];
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
  estimatedTherapists: number;
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
  | { kind: 'date_required' }
  | { kind: 'time_required' }
  | { kind: 'past_time' }
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

export function buildWhatsAppUrl(message: string, phone = business.whatsappNumber) {
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function isFutureAppointment(date: string, time: string, now = new Date()) {
  if (!date || !time) return false;
  const appointment = new Date(`${date}T${time}:00`);
  return !Number.isNaN(appointment.getTime()) && appointment.getTime() > now.getTime();
}

export function isValidBookingPhone(phone: string) {
  return /^\+?[0-9\s-]{8,18}$/.test(phone.trim());
}

export function getBookingValidationIssues(draft: BookingDraft, now = new Date()): BookingValidationIssue[] {
  const issues: BookingValidationIssue[] = [];
  draft.guests.forEach((guest, guestIndex) => {
    if (!getMenuItem(guest.categoryId, guest.itemId)) issues.push({ kind: 'guest_service', guestIndex });
  });
  if (!draft.date) issues.push({ kind: 'date_required' });
  if (!draft.time) issues.push({ kind: 'time_required' });
  if (draft.date && draft.time && !isFutureAppointment(draft.date, draft.time, now)) issues.push({ kind: 'past_time' });
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
    if (!canCalculate || !isFutureAppointment(date, time, now)) return { time, available: false };

    const startMinutes = timeToMinutes(time);
    const longestBooking = Math.max(...durations) + settings.turnaroundMinutes;
    if (startMinutes + longestBooking > closingMinutes) return { time, available: false };

    for (let elapsed = 0; elapsed < longestBooking; elapsed += settings.intervalMinutes) {
      const activeGuests = durations.filter(
        (duration) => elapsed < duration + settings.turnaroundMinutes,
      ).length;
      const busyTherapists = settings.estimatedBusyTherapistsByTime[minutesToTime(startMinutes + elapsed)] ?? 0;
      if (busyTherapists + activeGuests > settings.estimatedTherapists) {
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
  const value = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value);
}

export function buildOrderMessage(draft: BookingDraft, reference: string, locale: Locale) {
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
    lines.push('', `*Guest subtotal: ${formatRinggit(guestTotal(guest))}*`);
    return [lines.join('\n')];
  });

  const lines = [
    '*NEW BOOKING REQUEST*',
    business.name,
    `Ref: ${reference}`,
    '_Pending staff confirmation_',
    '',
    '*APPOINTMENT*',
    '',
    `Date: ${displayDate(draft.date)}`,
    `Time: ${draft.time}`,
    `Guests: ${draft.guests.length}`,
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
    'Please reply to confirm this time or suggest the nearest available time.',
    '',
    locale === 'zh'
      ? '_顾客已了解所选时间在店员确认前并未保留。_'
      : '_Customer understands the requested time is not reserved until staff confirms it._',
  ];

  return lines.join('\n');
}
