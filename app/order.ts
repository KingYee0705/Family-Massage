import { business, catalog, type GuestSelection, type Locale } from './catalog.ts';

export type BookingDraft = {
  guests: GuestSelection[];
  date: string;
  time: string;
  contactName: string;
  contactPhone: string;
  notes: string;
};

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
  const guestLines = draft.guests.flatMap((guest, index) => {
    const category = getCategory(guest.categoryId);
    const item = getMenuItem(guest.categoryId, guest.itemId);
    if (!category || !item) return [];
    const extras = guest.addOnIds
      .map((id) => category.addOns.find((entry) => entry.id === id))
      .filter((entry) => Boolean(entry));
    const name = guest.name.trim() ? ` · ${guest.name.trim()}` : '';
    const lines = [
      `${index + 1}. Guest ${index + 1}${name}`,
      `   ${category.name.en}: ${item.name.en} — ${formatRinggit(item.price)}`,
    ];
    if (extras.length) {
      lines.push(`   Extras: ${extras.map((extra) => `${extra!.name.en} (${formatRinggit(extra!.price)})`).join(', ')}`);
    }
    if (guest.therapistPreference.trim()) {
      lines.push(`   Therapist preference: ${guest.therapistPreference.trim()}`);
    }
    lines.push(`   Subtotal: ${formatRinggit(guestTotal(guest))}`);
    return lines;
  });

  return [
    `New appointment request · ${business.name}`,
    `Reference: ${reference}`,
    '',
    ...guestLines,
    '',
    `Preferred time: ${displayDate(draft.date)} at ${draft.time}`,
    `Contact: ${draft.contactName.trim()} · ${draft.contactPhone.trim()}`,
    draft.notes.trim() ? `Notes: ${draft.notes.trim()}` : '',
    `Estimated total: ${formatRinggit(orderTotal(draft.guests))}`,
    '',
    locale === 'zh'
      ? '我了解此预约需等待店员回复确认。'
      : 'I understand this request is pending staff confirmation.',
  ].filter(Boolean).join('\n');
}
