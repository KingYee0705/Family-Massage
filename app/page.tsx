'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Image from 'next/image';
import {
  business,
  catalog,
  ui,
  type GuestSelection,
  type Locale,
} from './catalog';
import {
  buildOrderMessage,
  buildWhatsAppUrl,
  estimatedGuestDuration,
  formatRinggit,
  getBookingValidationIssues,
  getCategory,
  getMenuItem,
  guestTotal,
  orderTotal,
  type BookingValidationIssue,
  type BookingDraft,
} from './order';
import {
  calculateDemoAvailability,
  emptyTherapistChoice,
  getIncludedAddonIds,
  isTherapistCompatible,
  loadDemoState,
  malaysiaDateValue,
  reserveDemoBooking,
  readDemoBooking,
  sampleTherapists,
  subscribeDemoState,
  therapistChoiceLabel,
  type DemoBooking,
  type DemoPublicState,
} from './demo-booking';

const emptyGuest = (id: string): GuestSelection => ({
  id,
  name: '',
  categoryId: catalog[0].id,
  itemId: '',
  addOnIds: [],
  therapistPreference: '',
  therapistChoice: emptyTherapistChoice(),
});

const initialDemoState = (): DemoPublicState => ({
  version: 3,
  seedDate: '',
  therapists: sampleTherapists,
  bookings: [],
});

function durationLabel(minutes: number, locale: Locale) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (locale === 'zh') {
    return `${hours ? `${hours} 小时` : ''}${remainder ? ` ${remainder} 分钟` : ''}`.trim();
  }
  return `${hours ? `${hours} hr` : ''}${remainder ? ` ${remainder} min` : ''}`.trim();
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>('en');
  const [menuCategoryId, setMenuCategoryId] = useState(catalog[0].id);
  const [guests, setGuests] = useState<GuestSelection[]>([emptyGuest('guest-1')]);
  const [activeGuestIndex, setActiveGuestIndex] = useState(0);
  const [groupTiming, setGroupTiming] = useState<'together' | 'flexible'>('together');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [minimumDate] = useState(() => malaysiaDateValue(new Date()));
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reference, setReference] = useState('');
  const [sendStatus, setSendStatus] = useState<'idle' | 'missing' | 'blocked' | 'copied'>('idle');
  const [demoState, setDemoState] = useState<DemoPublicState>(initialDemoState);
  const [savedBooking, setSavedBooking] = useState<DemoBooking | null>(null);
  const [bookingConflict, setBookingConflict] = useState<string[] | null>(null);
  const [availabilityReady, setAvailabilityReady] = useState(false);
  const [apiError, setApiError] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isReserving, setIsReserving] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const validationSummaryRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef('');

  const text = ui[locale];
  const menuCategory = getCategory(menuCategoryId)!;
  const activeGuest = guests[activeGuestIndex];
  const activeCategory = getCategory(activeGuest.categoryId)!;
  const activeTherapistChoice = activeGuest.therapistChoice ?? emptyTherapistChoice();
  const activeTherapists = demoState.therapists.filter((therapist) => therapist.active);
  const selectedItem = getMenuItem(activeGuest.categoryId, activeGuest.itemId);
  const total = orderTotal(guests);
  const allGuestsConfigured = guests.every((guest) => Boolean(getMenuItem(guest.categoryId, guest.itemId)));
  const estimatedVisitMinutes = Math.max(0, ...guests.map((guest) => estimatedGuestDuration(guest)));
  const demoTimeSlots = useMemo(() => calculateDemoAvailability({
    guests,
    date,
    groupTiming,
    bookings: demoState.bookings,
    therapists: demoState.therapists,
  }), [guests, date, groupTiming, demoState.bookings, demoState.therapists]);
  const groupedTimeSlots = [
    { label: text.morning, slots: demoTimeSlots.filter((slot) => Number(slot.time.slice(0, 2)) < 12) },
    { label: text.afternoon, slots: demoTimeSlots.filter((slot) => Number(slot.time.slice(0, 2)) >= 12 && Number(slot.time.slice(0, 2)) < 17) },
    { label: text.evening, slots: demoTimeSlots.filter((slot) => Number(slot.time.slice(0, 2)) >= 17) },
  ];

  const draft: BookingDraft = useMemo(() => ({
    guests,
    groupTiming,
    date,
    time,
    contactName,
    contactPhone,
    notes,
  }), [guests, groupTiming, date, time, contactName, contactPhone, notes]);
  const validationIssues = getBookingValidationIssues(draft);

  const messageDraft: BookingDraft = useMemo(() => ({
    ...(savedBooking ?? draft),
    guests: (savedBooking?.guests ?? draft.guests).map((guest) => ({
      ...guest,
      therapistPreference: therapistChoiceLabel(guest.therapistChoice, 'en', demoState.therapists),
    })),
  }), [draft, savedBooking, demoState.therapists]);

  const orderMessage = useMemo(
    () => reference && date && time
      ? buildOrderMessage(messageDraft, reference, locale, savedBooking?.status ?? 'request',
        savedBooking?.assignments.map((assignment) => {
          const therapist = demoState.therapists.find((entry) => entry.id === assignment.therapistId);
          const snapshot = savedBooking.therapistSnapshots?.find((entry) => entry.guestId === assignment.guestId);
          return { guestId: assignment.guestId, therapist: snapshot ? `${snapshot.staffNumber} · ${snapshot.name.en}` : therapist ? `${therapist.staffNumber} · ${therapist.name.en}` : assignment.therapistId, start: assignment.start, end: assignment.end };
        }))
      : '',
    [messageDraft, reference, locale, date, time, savedBooking, demoState.therapists],
  );

  const refreshAvailability = useCallback(async () => {
    try {
      setDemoState(await loadDemoState());
      setAvailabilityReady(true);
      setApiError(false);
    } catch {
      setApiError(true);
      setAvailabilityReady(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-Hans';
  }, [locale]);

  useEffect(() => {
    const task = window.setTimeout(() => { void refreshAvailability(); }, 0);
    const unsubscribe = subscribeDemoState(() => { void refreshAvailability(); });
    return () => { window.clearTimeout(task); unsubscribe(); };
  }, [refreshAvailability]);

  useEffect(() => {
    const id = savedBooking?.id;
    const token = savedBooking?.receiptToken;
    if (!id || !token) return;
    let cancelled = false;
    const refreshReceipt = async () => {
      try {
        const latest = await readDemoBooking(id, token);
        if (cancelled) return;
        setSavedBooking(latest);
        setDate(latest.date);
        setTime(latest.time);
        setGuests(latest.guests);
      } catch { /* Preserve the last receipt when the demo server is temporarily unavailable. */ }
    };
    const timer = window.setInterval(() => { void refreshReceipt(); }, 15_000);
    const onFocus = () => { void refreshReceipt(); };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [savedBooking?.id, savedBooking?.receiptToken]);

  useEffect(() => {
    if (!showReview) return;
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowReview(false); reviewButtonRef.current?.focus(); }
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showReview]);

  function clearBookingOutcome() {
    setSavedBooking(null);
    setBookingConflict(null);
    setReference('');
    setSubmitError('');
    idempotencyKey.current = '';
  }

  function updateGuest(id: string, patch: Partial<GuestSelection>) {
    setGuests((current) => current.map((guest) => {
      if (guest.id !== id) return guest;
      const next = { ...guest, ...patch };
      if (!('therapistChoice' in patch) && next.therapistChoice?.mode === 'specific') {
        const therapist = demoState.therapists.find((entry) => entry.id === next.therapistChoice?.therapistId);
        if (!therapist || !isTherapistCompatible(therapist, next)) {
          next.therapistChoice = { ...next.therapistChoice, therapistId: '' };
        }
      }
      return next;
    }));
    if ('categoryId' in patch || 'itemId' in patch || 'addOnIds' in patch || 'therapistChoice' in patch) setTime('');
    clearBookingOutcome();
  }

  function chooseCategory(categoryId: string) {
    updateGuest(activeGuest.id, { categoryId, itemId: '', addOnIds: [], therapistChoice: emptyTherapistChoice() });
  }

  function chooseMenuItem(categoryId: string, itemId: string) {
    const guestId = activeGuest.id;
    flushSync(() => {
      setGuests((current) => current.map((guest) => guest.id === guestId
        ? {
            ...guest,
            categoryId,
            itemId,
            addOnIds: [],
            therapistChoice: guest.categoryId === categoryId ? guest.therapistChoice : emptyTherapistChoice(),
          }
        : guest));
      setTime('');
      clearBookingOutcome();
    });
    requestAnimationFrame(() => document.getElementById(`service-field-${guestId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    }));
  }

  function toggleAddOn(addOnId: string) {
    if (getIncludedAddonIds(activeGuest).includes(addOnId)) return;
    const exists = activeGuest.addOnIds.includes(addOnId);
    updateGuest(activeGuest.id, {
      addOnIds: exists
        ? activeGuest.addOnIds.filter((id) => id !== addOnId)
        : [...activeGuest.addOnIds, addOnId],
    });
  }

  function addGuest() {
    if (guests.length >= 6) return;
    const next = [...guests, emptyGuest(`guest-${crypto.randomUUID()}`)];
    setGuests(next);
    setActiveGuestIndex(next.length - 1);
    setTime('');
    clearBookingOutcome();
  }

  function removeGuest(index: number) {
    if (guests.length === 1) return;
    const next = guests.filter((_, guestIndex) => guestIndex !== index);
    setGuests(next);
    setActiveGuestIndex(Math.min(index, next.length - 1));
    setTime('');
    clearBookingOutcome();
  }

  function hasValidationIssue(kind: BookingValidationIssue['kind'], guestIndex?: number) {
    return validationAttempted && validationIssues.some((issue) => issue.kind === kind
      && (!('guestIndex' in issue) || issue.guestIndex === guestIndex));
  }

  function validationIssueLabel(issue: BookingValidationIssue) {
    if (issue.kind === 'guest_service') {
      const guest = guests[issue.guestIndex];
      return `${guest.name.trim() || `${text.guest} ${issue.guestIndex + 1}`}: ${text.missingGuestService}`;
    }
    if (issue.kind === 'guest_therapist') {
      const guest = guests[issue.guestIndex];
      return `${guest.name.trim() || `${text.guest} ${issue.guestIndex + 1}`}: ${text.missingTherapist}`;
    }
    if (issue.kind === 'date_required') return text.missingDate;
    if (issue.kind === 'time_required') return text.missingTime;
    if (issue.kind === 'past_time') return text.pastTime;
    if (issue.kind === 'minimum_notice') return text.minimumNotice;
    if (issue.kind === 'contact_name') return text.invalidContactName;
    return text.invalidPhone;
  }

  function goToValidationIssue(issue: BookingValidationIssue) {
    let targetId = '';
    if (issue.kind === 'guest_service') {
      const guest = guests[issue.guestIndex];
      flushSync(() => setActiveGuestIndex(issue.guestIndex));
      targetId = `service-field-${guest.id}`;
    } else if (issue.kind === 'guest_therapist') {
      const guest = guests[issue.guestIndex];
      flushSync(() => setActiveGuestIndex(issue.guestIndex));
      targetId = `therapist-field-${guest.id}`;
    } else if (issue.kind === 'date_required' || issue.kind === 'past_time') {
      targetId = 'booking-date';
    } else if (issue.kind === 'time_required' || issue.kind === 'minimum_notice') {
      targetId = 'booking-time-field';
    } else if (issue.kind === 'contact_name') {
      targetId = 'contact-name';
    } else {
      targetId = 'contact-phone';
    }

    requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusTarget = target?.matches('input, select, button')
        ? target
        : target?.querySelector('input, select, button:not(:disabled)');
      if (focusTarget instanceof HTMLElement) focusTarget.focus({ preventScroll: true });
    });
  }

  function handleReview(event: FormEvent) {
    event.preventDefault();
    setValidationAttempted(true);
    if (validationIssues.length > 0) {
      requestAnimationFrame(() => {
        validationSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        validationSummaryRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setSendStatus('idle');
    setShowReview(true);
  }

  async function confirmDemoBooking() {
    if (isReserving || savedBooking) return;
    setIsReserving(true);
    setBookingConflict(null);
    setSubmitError('');
    try {
      const result = await reserveDemoBooking({
        guests,
        groupTiming,
        date,
        time,
        contactName,
        contactPhone,
        notes,
        idempotencyKey: idempotencyKey.current,
      });
      if (result.ok) {
        setSavedBooking(result.booking);
        setReference(result.booking.reference);
        setSendStatus('idle');
        void refreshAvailability();
        return;
      }

      setBookingConflict(result.alternatives);
      idempotencyKey.current = '';
      void refreshAvailability();
      setTime('');
      setReference('');
      setShowReview(false);
      requestAnimationFrame(() => {
        const alert = document.getElementById('booking-conflict');
        alert?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        alert?.focus({ preventScroll: true });
      });
    } catch {
      setSubmitError(text.bookingUnavailable);
    } finally {
      setIsReserving(false);
    }
  }

  function openWhatsApp() {
    const url = buildWhatsAppUrl(orderMessage);
    if (!url) {
      setSendStatus('missing');
      return;
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) setSendStatus('blocked');
  }

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(orderMessage);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = orderMessage;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setSendStatus('copied');
  }

  return (
    <main>
      <nav className="site-nav" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label={`${business.name} home`}>
          <span className="brand-mark">S</span>
          <span>Serene</span>
        </a>
        <div className="nav-links">
          <a href="#menu">{text.navMenu}</a>
          <a href="#booking">{text.navBook}</a>
        </div>
        <div className="locale-switch" aria-label={text.language}>
          <button type="button" aria-pressed={locale === 'en'} className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button>
          <button type="button" aria-pressed={locale === 'zh'} className={locale === 'zh' ? 'active' : ''} onClick={() => setLocale('zh')}>中文</button>
        </div>
      </nav>
      <div className="local-demo-banner">
        <span>{text.demoBanner}</span>
        <a href="/staff" target="_blank" rel="noreferrer">{text.demoStaffLink} ↗</a>
      </div>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.heroTitle}<br /><em>{text.heroAccent}</em></h1>
          <p className="hero-description">{text.heroBody}</p>
          <a className="primary-cta" href="#menu">
            {text.chooseTreatment}
            <span aria-hidden="true">↘</span>
          </a>
          <div className="trust-row" aria-label="Booking information">
            <span><i aria-hidden="true">✓</i>{text.payShop}</span>
            <span><i aria-hidden="true">✓</i>{text.groupBooking}</span>
            <span><i aria-hidden="true">✓</i>{text.staffConfirmation}</span>
          </div>
        </div>

        <div className="hero-art" role="img" aria-label="A calm, sunlit spa-inspired scene">
          <div className="sun-orb" />
          <div className="arch arch-one" />
          <div className="arch arch-two" />
          <div className="pebble pebble-one" />
          <div className="pebble pebble-two" />
          <div className="leaf leaf-one" />
          <div className="leaf leaf-two" />
          <div className="leaf leaf-three" />
          <div className="hero-note">
            <span>01</span>
            <p>{text.footerLine}</p>
          </div>
        </div>
      </section>

      <section className="menu-section" id="menu">
        <header className="section-heading">
          <div>
            <p className="eyebrow">{text.treatmentsEyebrow}</p>
            <h2>{text.treatmentsTitle}</h2>
          </div>
          <p>{menuCategory.intro[locale]}</p>
        </header>

        <p className="menu-booking-target">
          {text.addingTo} <strong>{activeGuest.name.trim() || `${text.guest} ${activeGuestIndex + 1}`}</strong>
        </p>

        <div className="category-tabs" role="group" aria-label={text.treatmentType}>
          {catalog.map((category) => (
            <button
              type="button"
              aria-pressed={menuCategoryId === category.id}
              className={menuCategoryId === category.id ? 'active' : ''}
              onClick={() => setMenuCategoryId(category.id)}
              key={category.id}
            >
              <span>{category.number}</span>
              {category.name[locale]}
            </button>
          ))}
        </div>

        <div className="menu-layout">
          <div className="menu-main">
            <div className="menu-block">
              <div className="menu-label"><span>{text.regularSessions}</span><i /></div>
              <div className="session-grid">
                {menuCategory.treatments.map((item) => (
                  <button
                    type="button"
                    className={`session-card${activeGuest.categoryId === menuCategory.id && activeGuest.itemId === item.id ? ' selected' : ''}`}
                    aria-pressed={activeGuest.categoryId === menuCategory.id && activeGuest.itemId === item.id}
                    onClick={() => chooseMenuItem(menuCategory.id, item.id)}
                    key={item.id}
                  >
                    <span className="selection-dot" aria-hidden="true" />
                    <span className="session-name">{item.name[locale]}</span>
                    <strong>{formatRinggit(item.price)}</strong>
                    <span className="card-action">{activeGuest.categoryId === menuCategory.id && activeGuest.itemId === item.id ? `✓ ${text.selected}` : `${text.addToBooking} →`}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="menu-block package-block">
              <div className="menu-label"><span>{text.packages}</span><i /></div>
              <div className="package-list">
                {menuCategory.packages.map((item, index) => (
                  <button
                    type="button"
                    className={`package-row${activeGuest.categoryId === menuCategory.id && activeGuest.itemId === item.id ? ' selected' : ''}`}
                    aria-pressed={activeGuest.categoryId === menuCategory.id && activeGuest.itemId === item.id}
                    onClick={() => chooseMenuItem(menuCategory.id, item.id)}
                    key={item.id}
                  >
                    <span className="package-number">{String(index + 1).padStart(2, '0')}</span>
                    <span>{item.name[locale]}</span>
                    <strong>{formatRinggit(item.price)}</strong>
                    <span aria-hidden="true">{activeGuest.categoryId === menuCategory.id && activeGuest.itemId === item.id ? '✓' : '↗'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <aside className="addons-menu">
            <div className="menu-label"><span>{text.addOns}</span><i /></div>
            <ul>
              {menuCategory.addOns.map((extra) => (
                <li key={extra.id}>
                  <span>{extra.name[locale]}</span>
                  <strong>+ {formatRinggit(extra.price)}</strong>
                </li>
              ))}
            </ul>
            <p>{locale === 'en' ? 'Add-ons can be selected for each guest during booking.' : '您可在预约时为每位客人选择附加项目。'}</p>
          </aside>
        </div>
      </section>

      <section className="booking-section" id="booking">
        <header className="booking-heading">
          <p className="eyebrow">{text.bookingEyebrow}</p>
          <h2>{text.bookingTitle}</h2>
          <p>{text.bookingIntro}</p>
        </header>

        <form className="booking-layout" onSubmit={handleReview} noValidate>
          <div className="booking-form">
            {validationAttempted && validationIssues.length > 0 && (
              <section className="validation-summary" ref={validationSummaryRef} tabIndex={-1} aria-labelledby="validation-title">
                <div className="validation-count" aria-hidden="true">{String(validationIssues.length).padStart(2, '0')}</div>
                <div>
                  <h3 id="validation-title">{validationIssues.length} {text.validationRemaining}</h3>
                  <p>{text.validationIntro}</p>
                  <ul>
                    {validationIssues.map((issue) => (
                      <li key={'guestIndex' in issue ? `${issue.kind}-${issue.guestIndex}` : issue.kind}>
                        <button type="button" onClick={() => goToValidationIssue(issue)}>
                          <span>{validationIssueLabel(issue)}</span>
                          <span aria-hidden="true">→</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            <section className="form-card guest-card">
              <div className="form-card-heading">
                <div>
                  <span className="step-number">01</span>
                  <h3>{text.guests}</h3>
                </div>
                <span className="guest-count">{guests.length} / 6</span>
              </div>

              <div className="guest-tabs" role="group" aria-label={text.guests}>
                {guests.map((guest, index) => (
                  <button
                    type="button"
                    aria-pressed={activeGuestIndex === index}
                    className={activeGuestIndex === index ? 'active' : ''}
                    onClick={() => setActiveGuestIndex(index)}
                    key={guest.id}
                  >
                    <span>{index + 1}</span>
                    {guest.name.trim() || `${text.guest} ${index + 1}`}
                    {guest.itemId && <i aria-label="Treatment selected">✓</i>}
                  </button>
                ))}
                {guests.length < 6 && (
                  <button type="button" className="add-guest-tab" onClick={addGuest}>+ {text.addGuest}</button>
                )}
              </div>

              <div className="guest-editor" key={activeGuest.id}>
                <div className="field full-field">
                  <label htmlFor={`guest-name-${activeGuest.id}`}>{text.guestName}</label>
                  <input
                    id={`guest-name-${activeGuest.id}`}
                    value={activeGuest.name}
                    onChange={(event) => updateGuest(activeGuest.id, { name: event.target.value })}
                    placeholder={`${text.guest} ${activeGuestIndex + 1}`}
                  />
                </div>

                <fieldset className="full-field choice-fieldset">
                  <legend>{text.treatmentType}</legend>
                  <div className="category-choice-grid">
                    {catalog.map((category) => (
                      <button
                        type="button"
                        className={activeGuest.categoryId === category.id ? 'active' : ''}
                        aria-pressed={activeGuest.categoryId === category.id}
                        onClick={() => chooseCategory(category.id)}
                        key={category.id}
                      >
                        <span>{category.number}</span>
                        {category.name[locale]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="field full-field" id={`service-field-${activeGuest.id}`}>
                  <label htmlFor={`service-${activeGuest.id}`}>{selectedItem ? text.selectedService : text.selectTreatment} *</label>
                  <div className="select-wrap">
                    <select
                      id={`service-${activeGuest.id}`}
                      value={activeGuest.itemId}
                      aria-invalid={hasValidationIssue('guest_service', activeGuestIndex)}
                      onChange={(event) => updateGuest(activeGuest.id, { itemId: event.target.value, addOnIds: [] })}
                      required
                    >
                      <option value="">— {text.selectTreatment} —</option>
                      <optgroup label={text.regularSessions}>
                        {activeCategory.treatments.map((item) => <option value={item.id} key={item.id}>{item.name[locale]} · {formatRinggit(item.price)}</option>)}
                      </optgroup>
                      <optgroup label={text.packages}>
                        {activeCategory.packages.map((item) => <option value={item.id} key={item.id}>{item.name[locale]} · {formatRinggit(item.price)}</option>)}
                      </optgroup>
                    </select>
                    <span aria-hidden="true">⌄</span>
                  </div>
                </div>

                <fieldset className="full-field choice-fieldset">
                  <legend>{text.extras}</legend>
                  <div className="addon-choice-grid">
                    {activeCategory.addOns.map((extra) => {
                      const checked = activeGuest.addOnIds.includes(extra.id);
                      const included = getIncludedAddonIds(activeGuest).includes(extra.id);
                      return (
                        <label className={included ? 'included' : checked ? 'checked' : ''} key={extra.id}>
                          <input type="checkbox" disabled={included} checked={checked || included} onChange={() => toggleAddOn(extra.id)} />
                          <span className="check-box" aria-hidden="true">{checked || included ? '✓' : '+'}</span>
                          <span>{extra.name[locale]}</span>
                          <strong>{included ? text.includedInPackage : formatRinggit(extra.price)}</strong>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset
                  className={`full-field choice-fieldset therapist-preference-fieldset${hasValidationIssue('guest_therapist', activeGuestIndex) ? ' invalid' : ''}`}
                  id={`therapist-field-${activeGuest.id}`}
                >
                  <legend>{text.therapistQuestion}</legend>
                  <div className="preference-yes-no">
                    <label className={activeTherapistChoice.mode === 'none' ? 'selected' : ''}>
                      <input
                        type="radio"
                        name={`therapist-wanted-${activeGuest.id}`}
                        checked={activeTherapistChoice.mode === 'none'}
                        onChange={() => updateGuest(activeGuest.id, { therapistChoice: emptyTherapistChoice() })}
                      />
                      <span aria-hidden="true" />
                      <strong>{text.noPreference}</strong>
                      <small>{text.noPreferenceHint}</small>
                    </label>
                    <label className={activeTherapistChoice.mode !== 'none' ? 'selected' : ''}>
                      <input
                        type="radio"
                        name={`therapist-wanted-${activeGuest.id}`}
                        checked={activeTherapistChoice.mode !== 'none'}
                        onChange={() => updateGuest(activeGuest.id, {
                          therapistChoice: { mode: 'specific', requirement: 'preferred', gender: '', therapistId: '' },
                        })}
                      />
                      <span aria-hidden="true" />
                      <strong>{text.yesPreference}</strong>
                      <small>{text.yesPreferenceHint}</small>
                    </label>
                  </div>

                  {activeTherapistChoice.mode !== 'none' && (
                    <div className="therapist-preference-panel">
                      <div className="preference-type" role="group" aria-label={text.preferenceType}>
                        <button
                          type="button"
                          className={activeTherapistChoice.mode === 'specific' ? 'active' : ''}
                          aria-pressed={activeTherapistChoice.mode === 'specific'}
                          onClick={() => updateGuest(activeGuest.id, {
                            therapistChoice: { ...activeTherapistChoice, mode: 'specific', gender: '', therapistId: '' },
                          })}
                        >
                          {text.specificPerson}
                        </button>
                        <button
                          type="button"
                          className={activeTherapistChoice.mode === 'gender' && activeTherapistChoice.gender === 'female' ? 'active' : ''}
                          aria-pressed={activeTherapistChoice.mode === 'gender' && activeTherapistChoice.gender === 'female'}
                          onClick={() => updateGuest(activeGuest.id, {
                            therapistChoice: { ...activeTherapistChoice, mode: 'gender', gender: 'female', therapistId: '' },
                          })}
                        >
                          {text.femaleTherapist}
                        </button>
                        <button
                          type="button"
                          className={activeTherapistChoice.mode === 'gender' && activeTherapistChoice.gender === 'male' ? 'active' : ''}
                          aria-pressed={activeTherapistChoice.mode === 'gender' && activeTherapistChoice.gender === 'male'}
                          onClick={() => updateGuest(activeGuest.id, {
                            therapistChoice: { ...activeTherapistChoice, mode: 'gender', gender: 'male', therapistId: '' },
                          })}
                        >
                          {text.maleTherapist}
                        </button>
                      </div>

                      {activeTherapistChoice.mode === 'specific' && (
                        <div className="therapist-card-grid" role="radiogroup" aria-label={text.chooseTherapist}>
                          {activeTherapists.map((therapist) => {
                            const compatible = Boolean(selectedItem) && isTherapistCompatible(therapist, activeGuest);
                            const selected = activeTherapistChoice.therapistId === therapist.id;
                            return (
                              <label className={`${selected ? 'selected ' : ''}${compatible ? '' : 'incompatible'}`.trim()} key={therapist.id}>
                                <input
                                  type="radio"
                                  name={`specific-therapist-${activeGuest.id}`}
                                  value={therapist.id}
                                  disabled={!compatible}
                                  checked={selected}
                                  onChange={() => updateGuest(activeGuest.id, {
                                    therapistChoice: { ...activeTherapistChoice, therapistId: therapist.id },
                                  })}
                                />
                                <Image src={therapist.imageUrl} alt="" width={160} height={160} />
                                <span className="therapist-card-copy">
                                  <small>{text.sampleStaff} · {therapist.staffNumber}</small>
                                  <strong>{therapist.name[locale]}</strong>
                                  <em>{therapist.gender === 'female' ? text.female : text.male}</em>
                                  <b>{therapist.specialties[locale]}</b>
                                  <span>{therapist.description[locale]}</span>
                                  {!compatible && <i>{selectedItem ? text.incompatibleTherapist : text.chooseServiceFirst}</i>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      <fieldset className="preference-strength">
                        <legend>{text.preferenceStrength}</legend>
                        <label className={activeTherapistChoice.requirement === 'preferred' ? 'selected' : ''}>
                          <input
                            type="radio"
                            name={`preference-strength-${activeGuest.id}`}
                            checked={activeTherapistChoice.requirement === 'preferred'}
                            onChange={() => updateGuest(activeGuest.id, {
                              therapistChoice: { ...activeTherapistChoice, requirement: 'preferred' },
                            })}
                          />
                          <strong>{text.preferredChoice}</strong>
                          <small>{text.preferredChoiceHint}</small>
                        </label>
                        <label className={activeTherapistChoice.requirement === 'required' ? 'selected' : ''}>
                          <input
                            type="radio"
                            name={`preference-strength-${activeGuest.id}`}
                            checked={activeTherapistChoice.requirement === 'required'}
                            onChange={() => updateGuest(activeGuest.id, {
                              therapistChoice: { ...activeTherapistChoice, requirement: 'required' },
                            })}
                          />
                          <strong>{text.requiredChoice}</strong>
                          <small>{text.requiredChoiceHint}</small>
                        </label>
                      </fieldset>
                    </div>
                  )}
                </fieldset>

                {guests.length > 1 && (
                  <button type="button" className="remove-guest" onClick={() => removeGuest(activeGuestIndex)}>× {text.removeGuest}</button>
                )}
              </div>
            </section>

            <section className="form-card appointment-card">
              <div className="form-card-heading">
                <div>
                  <span className="step-number">02</span>
                  <h3>{text.appointment}</h3>
                </div>
              </div>
              <div className="field-grid">
                {guests.length > 1 && (
                  <fieldset className="full-field choice-fieldset group-timing-fieldset">
                    <legend>{text.groupTiming}</legend>
                    <div>
                      <label className={groupTiming === 'together' ? 'selected' : ''}>
                        <input type="radio" name="group-timing" checked={groupTiming === 'together'} onChange={() => { setGroupTiming('together'); setTime(''); clearBookingOutcome(); }} />
                        <span aria-hidden="true" />
                        {text.startTogether}
                      </label>
                      <label className={groupTiming === 'flexible' ? 'selected' : ''}>
                        <input type="radio" name="group-timing" checked={groupTiming === 'flexible'} onChange={() => { setGroupTiming('flexible'); setTime(''); clearBookingOutcome(); }} />
                        <span aria-hidden="true" />
                        {text.flexibleStart}
                      </label>
                    </div>
                  </fieldset>
                )}
                <div className="field">
                  <label htmlFor="booking-date">{text.preferredDate} *</label>
                  <input id="booking-date" type="date" min={minimumDate} value={date} onChange={(event) => { setDate(event.target.value); setTime(''); clearBookingOutcome(); }} aria-invalid={hasValidationIssue('date_required') || hasValidationIssue('past_time')} required />
                </div>
                <div className="field demo-availability full-field" id="booking-time-field">
                  <div className="availability-heading">
                    <div>
                      <label id="booking-time-label">{text.preferredTime} *</label>
                      <strong>{text.demoAvailability}</strong>
                    </div>
                    {estimatedVisitMinutes > 0 && (
                      <p><span>{text.estimatedVisit}</span>{durationLabel(estimatedVisitMinutes, locale)}</p>
                    )}
                  </div>
                  <p className="demo-note">{text.demoAvailabilityNote}</p>

                  {bookingConflict !== null && (
                    <div className="booking-conflict" id="booking-conflict" tabIndex={-1} role="alert" aria-live="assertive">
                      <strong>{text.timeJustTaken}</strong>
                      <p>{text.chooseAgain}</p>
                      <div>
                        {bookingConflict.map((alternative) => (
                          <button
                            type="button"
                            key={alternative}
                            onClick={() => { setTime(alternative); setBookingConflict(null); }}
                          >
                            {alternative}
                          </button>
                        ))}
                        {bookingConflict.length === 0 && <span>{text.noNearbyTimes}</span>}
                      </div>
                    </div>
                  )}

                  {!date && <p className="availability-prompt">{text.selectDateFirst}</p>}
                  {date && !allGuestsConfigured && <p className="availability-prompt">{text.selectServicesFirst}</p>}
                  {apiError && <div className="booking-conflict" role="status"><p>{text.bookingUnavailable}</p><button type="button" onClick={() => { void refreshAvailability(); }}>{text.retry}</button></div>}
                  {!apiError && !availabilityReady && <p className="availability-prompt" role="status">{text.loadingAvailability}</p>}
                  {date && allGuestsConfigured && availabilityReady && !apiError && (
                    <div className={`time-slot-groups${hasValidationIssue('time_required') || hasValidationIssue('past_time') || hasValidationIssue('minimum_notice') ? ' invalid' : ''}`} role="group" aria-labelledby="booking-time-label" aria-describedby="booking-time-help">
                      {groupedTimeSlots.map((group) => (
                        <div className="time-slot-group" key={group.label}>
                          <p>{group.label}</p>
                          <div className="time-slot-grid">
                            {group.slots.map((slot) => (
                              <button
                                type="button"
                                className={time === slot.time ? 'selected' : ''}
                                disabled={!slot.available}
                                aria-pressed={time === slot.time}
                                onClick={() => { setTime(slot.time); clearBookingOutcome(); }}
                                key={slot.time}
                              >
                                {slot.time}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                      {!demoTimeSlots.some((slot) => slot.available) && <p className="availability-prompt">{text.noDemoTimes}</p>}
                    </div>
                  )}

                  <div className="availability-legend" aria-hidden="true">
                    <span><i />{text.availableLegend}</span>
                    <span><i className="unavailable" />{text.unavailableLegend}</span>
                  </div>
                  <p className="field-help" id="booking-time-help">{text.timeRequestNote}</p>
                </div>
                <div className="booking-policy full-field">
                  <strong>{text.bookingPolicy}</strong>
                  <p>{text.minimumNotice} {text.policySummary}</p>
                </div>
                <div className="field">
                  <label htmlFor="contact-name">{text.contactName} *</label>
                  <input id="contact-name" autoComplete="name" value={contactName} onChange={(event) => { setContactName(event.target.value); clearBookingOutcome(); }} aria-invalid={hasValidationIssue('contact_name')} required />
                </div>
                <div className="field">
                  <label htmlFor="contact-phone">{text.whatsappPhone} *</label>
                  <input id="contact-phone" type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(event) => { setContactPhone(event.target.value); clearBookingOutcome(); }} aria-invalid={hasValidationIssue('contact_phone')} placeholder="01X-XXX XXXX" required />
                </div>
                <div className="field full-field">
                  <label htmlFor="booking-notes">{text.notes}</label>
                  <textarea id="booking-notes" rows={4} value={notes} onChange={(event) => { setNotes(event.target.value); clearBookingOutcome(); }} placeholder={text.notesHint} />
                </div>
              </div>
            </section>
          </div>

          <aside className="order-summary">
            <div className="summary-topline"><span>{text.summary}</span><span>{String(guests.length).padStart(2, '0')}</span></div>
            <div className="summary-guests">
              {guests.map((guest, index) => {
                const item = getMenuItem(guest.categoryId, guest.itemId);
                const category = getCategory(guest.categoryId)!;
                return (
                  <div className="summary-guest" key={guest.id}>
                    <div className="summary-guest-title">
                      <span>{index + 1}</span>
                      <div>
                        <strong>{guest.name.trim() || `${text.guest} ${index + 1}`}</strong>
                        <p>{item ? item.name[locale] : text.notSelected}</p>
                      </div>
                      <b>{item ? formatRinggit(guestTotal(guest)) : '—'}</b>
                    </div>
                    {guest.addOnIds.length > 0 && (
                      <ul>
                        {guest.addOnIds.map((id) => {
                          const extra = category.addOns.find((entry) => entry.id === id);
                          return extra ? <li key={id}>+ {extra.name[locale]}</li> : null;
                        })}
                      </ul>
                    )}
                    {guest.therapistChoice?.mode !== 'none' && (
                      <p className="summary-therapist">{text.therapist}: {therapistChoiceLabel(guest.therapistChoice, locale, demoState.therapists)}</p>
                    )}
                  </div>
                );
              })}
            </div>
            {(date || time) && <p className="summary-time"><span>◷</span>{date || '—'} · {time || '—'}</p>}
            {guests.length > 1 && <p className="summary-group-timing">{groupTiming === 'flexible' ? text.flexibleStart : text.startTogether}</p>}
            <div className="summary-total">
              <span>{text.total}</span>
              <strong>{formatRinggit(total)}</strong>
            </div>
            {validationAttempted && validationIssues.length > 0 && <p className="form-error" role="alert">{validationIssues.length} {text.validationRemaining}</p>}
            <button ref={reviewButtonRef} className="review-button" type="submit">{text.review}<span aria-hidden="true">→</span></button>
            {savedBooking && <p className="pay-note">{text.requestSaved}</p>}
            <p className="pay-note">{text.payNote}</p>
          </aside>
        </form>
      </section>

      <section className="care-note">
        <span aria-hidden="true">✦</span>
        <p>{text.medicalNote}</p>
      </section>

      <footer>
        <div className="footer-brand">
          <span className="brand-mark">S</span>
          <div><strong>{business.name}</strong><p>{text.footerLine}</p></div>
        </div>
        <div>
          <span>{business.hours[locale]}</span>
          <span>{business.address[locale]}</span>
        </div>
        <p>{text.addressPending}</p>
      </footer>

      {showReview && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowReview(false); reviewButtonRef.current?.focus(); } }}>
          <section ref={dialogRef} className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <button ref={closeButtonRef} type="button" className="dialog-close" aria-label={text.close} onClick={() => { setShowReview(false); reviewButtonRef.current?.focus(); }}>×</button>
            <p className="eyebrow">{reference ? `${text.reference} · ${reference}` : text.demoReviewWarning}</p>
            <h2 id="review-title">{text.reviewTitle}</h2>

            <div className="dialog-appointment">
              <div><span>{text.preferredDate}</span><strong>{date}</strong></div>
              <div><span>{text.preferredTime}</span><strong>{time}</strong></div>
              <div><span>{text.contactName}</span><strong>{contactName}</strong></div>
            </div>
            {guests.length > 1 && <p className="dialog-group-timing"><strong>{text.groupTiming}:</strong> {groupTiming === 'flexible' ? text.flexibleStart : text.startTogether}</p>}

            <div className="dialog-guests">
              {guests.map((guest, index) => {
                const item = getMenuItem(guest.categoryId, guest.itemId)!;
                const category = getCategory(guest.categoryId)!;
                const assigned = savedBooking?.assignments.find((entry) => entry.guestId === guest.id);
                const assignedPerson = assigned && demoState.therapists.find((entry) => entry.id === assigned.therapistId);
                const assignedSnapshot = savedBooking?.therapistSnapshots?.find((entry) => entry.guestId === guest.id);
                const usedPreferenceFallback = Boolean(assigned && guest.therapistChoice?.requirement === 'preferred' && guest.therapistChoice.mode !== 'none' && (guest.therapistChoice.mode === 'specific' ? assigned.therapistId !== guest.therapistChoice.therapistId : assignedPerson?.gender !== guest.therapistChoice.gender));
                return (
                  <div key={guest.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{guest.name.trim() || `${text.guest} ${index + 1}`}</strong>
                      <p>{item.name[locale]}</p>
                      {guest.addOnIds.length > 0 && <small>+ {guest.addOnIds.map((id) => category.addOns.find((extra) => extra.id === id)?.name[locale]).filter(Boolean).join(', ')}</small>}
                      {guest.therapistChoice?.mode !== 'none' && <small>{text.therapist}: {therapistChoiceLabel(guest.therapistChoice, locale, demoState.therapists)}</small>}
                      {assigned && (assignedSnapshot || assignedPerson) && <small className="assigned-detail">{text.assignedTherapist}: {assignedSnapshot?.staffNumber ?? assignedPerson?.staffNumber} · {assignedSnapshot?.name[locale] ?? assignedPerson?.name[locale]}<br />{assigned.start}–{assigned.end}{usedPreferenceFallback && <><br />{text.preferenceFallback}</>}</small>}
                    </div>
                    <b>{formatRinggit(guestTotal(guest))}</b>
                  </div>
                );
              })}
            </div>

            <div className="dialog-total"><span>{text.total}</span><strong>{formatRinggit(total)}</strong></div>

            {!savedBooking ? (
              <>
                <p className="demo-review-warning">{text.demoReviewWarning}</p>
                {submitError && <p role="alert" className="booking-conflict">{submitError}</p>}
                <button type="button" className="confirm-demo-button" onClick={confirmDemoBooking} disabled={isReserving || !availabilityReady || apiError}>
                  {isReserving ? text.checkingCapacity : text.confirmDemoBooking}
                  <span aria-hidden="true">→</span>
                </button>
                <p className="send-hint">{text.finalCapacityCheck}</p>
              </>
            ) : (
              <>
                <div className={`demo-booking-success ${savedBooking.status}`} role="status" aria-live="polite">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>{text.demoStatuses[savedBooking.status]}</strong>
                    <p>{savedBooking.status === 'pending' ? text.demoPendingHint : ['cancelled', 'expired', 'no_show'].includes(savedBooking.status) ? text.demoReleasedHint : text.demoConfirmedHint}</p>
                    <small>{savedBooking.reference}</small>
                  </div>
                </div>
                {(sendStatus === 'missing' || sendStatus === 'blocked') && (
                  <p className="configure-notice" role="status">{sendStatus === 'missing' ? text.configureNotice : text.sendHint}</p>
                )}
                <a className="staff-demo-link" href="/staff" target="_blank" rel="noreferrer">{text.openStaffDashboard}<span aria-hidden="true">↗</span></a>
                <button type="button" className="whatsapp-button" onClick={openWhatsApp}>{text.sendWhatsApp}<span aria-hidden="true">↗</span></button>
                <button type="button" className="copy-button" onClick={copyRequest}>{sendStatus === 'copied' ? `✓ ${text.copied}` : text.copySummary}</button>
                <p className="send-hint">{text.sendHint}</p>
                <button type="button" className="copy-button" onClick={() => { setShowReview(false); setGuests([emptyGuest('guest-1')]); setActiveGuestIndex(0); setTime(''); setValidationAttempted(false); clearBookingOutcome(); }}>{text.newBooking}</button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
