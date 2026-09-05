'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
  createReference,
  estimateTimeSlotAvailability,
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

const emptyGuest = (id: string): GuestSelection => ({
  id,
  name: '',
  categoryId: catalog[0].id,
  itemId: '',
  addOnIds: [],
  therapistPreference: '',
});

function localDateValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

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
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [minimumDate] = useState(() => localDateValue(new Date()));
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reference, setReference] = useState('');
  const [sendStatus, setSendStatus] = useState<'idle' | 'missing' | 'blocked' | 'copied'>('idle');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const validationSummaryRef = useRef<HTMLElement>(null);

  const text = ui[locale];
  const menuCategory = getCategory(menuCategoryId)!;
  const activeGuest = guests[activeGuestIndex];
  const activeCategory = getCategory(activeGuest.categoryId)!;
  const selectedItem = getMenuItem(activeGuest.categoryId, activeGuest.itemId);
  const total = orderTotal(guests);
  const allGuestsConfigured = guests.every((guest) => Boolean(getMenuItem(guest.categoryId, guest.itemId)));
  const estimatedVisitMinutes = Math.max(0, ...guests.map((guest) => estimatedGuestDuration(guest)));
  const demoTimeSlots = useMemo(
    () => estimateTimeSlotAvailability(guests, date),
    [guests, date],
  );
  const groupedTimeSlots = [
    { label: text.morning, slots: demoTimeSlots.filter((slot) => Number(slot.time.slice(0, 2)) < 12) },
    { label: text.afternoon, slots: demoTimeSlots.filter((slot) => Number(slot.time.slice(0, 2)) >= 12 && Number(slot.time.slice(0, 2)) < 17) },
    { label: text.evening, slots: demoTimeSlots.filter((slot) => Number(slot.time.slice(0, 2)) >= 17) },
  ];

  const draft: BookingDraft = useMemo(() => ({
    guests,
    date,
    time,
    contactName,
    contactPhone,
    notes,
  }), [guests, date, time, contactName, contactPhone, notes]);
  const validationIssues = getBookingValidationIssues(draft);

  const orderMessage = useMemo(
    () => reference && date && time ? buildOrderMessage(draft, reference, locale) : '',
    [draft, reference, locale, date, time],
  );

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-Hans';
  }, [locale]);

  useEffect(() => {
    if (!showReview) return;
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowReview(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showReview]);

  function updateGuest(id: string, patch: Partial<GuestSelection>) {
    setGuests((current) => current.map((guest) => guest.id === id ? { ...guest, ...patch } : guest));
    if ('categoryId' in patch || 'itemId' in patch || 'addOnIds' in patch) setTime('');
  }

  function chooseCategory(categoryId: string) {
    updateGuest(activeGuest.id, { categoryId, itemId: '', addOnIds: [] });
  }

  function chooseMenuItem(categoryId: string, itemId: string) {
    const guestId = activeGuest.id;
    flushSync(() => {
      setGuests((current) => current.map((guest) => guest.id === guestId
        ? { ...guest, categoryId, itemId, addOnIds: [] }
        : guest));
      setTime('');
    });
    requestAnimationFrame(() => document.getElementById(`service-field-${guestId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    }));
  }

  function toggleAddOn(addOnId: string) {
    const exists = activeGuest.addOnIds.includes(addOnId);
    updateGuest(activeGuest.id, {
      addOnIds: exists
        ? activeGuest.addOnIds.filter((id) => id !== addOnId)
        : [...activeGuest.addOnIds, addOnId],
    });
  }

  function addGuest() {
    if (guests.length >= 6) return;
    const next = [...guests, emptyGuest(`guest-${Date.now()}`)];
    setGuests(next);
    setActiveGuestIndex(next.length - 1);
    setTime('');
  }

  function removeGuest(index: number) {
    if (guests.length === 1) return;
    const next = guests.filter((_, guestIndex) => guestIndex !== index);
    setGuests(next);
    setActiveGuestIndex(Math.min(index, next.length - 1));
    setTime('');
  }

  function hasValidationIssue(kind: BookingValidationIssue['kind'], guestIndex?: number) {
    return validationAttempted && validationIssues.some((issue) => issue.kind === kind
      && (issue.kind !== 'guest_service' || issue.guestIndex === guestIndex));
  }

  function validationIssueLabel(issue: BookingValidationIssue) {
    if (issue.kind === 'guest_service') {
      const guest = guests[issue.guestIndex];
      return `${guest.name.trim() || `${text.guest} ${issue.guestIndex + 1}`}: ${text.missingGuestService}`;
    }
    if (issue.kind === 'date_required') return text.missingDate;
    if (issue.kind === 'time_required') return text.missingTime;
    if (issue.kind === 'past_time') return text.pastTime;
    if (issue.kind === 'contact_name') return text.invalidContactName;
    return text.invalidPhone;
  }

  function goToValidationIssue(issue: BookingValidationIssue) {
    let targetId = '';
    if (issue.kind === 'guest_service') {
      const guest = guests[issue.guestIndex];
      flushSync(() => setActiveGuestIndex(issue.guestIndex));
      targetId = `service-field-${guest.id}`;
    } else if (issue.kind === 'date_required' || issue.kind === 'past_time') {
      targetId = 'booking-date';
    } else if (issue.kind === 'time_required') {
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
    setReference(createReference());
    setSendStatus('idle');
    setShowReview(true);
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

        <div className="category-tabs" role="tablist" aria-label={text.treatmentType}>
          {catalog.map((category) => (
            <button
              type="button"
              role="tab"
              aria-selected={menuCategoryId === category.id}
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
                      <li key={issue.kind === 'guest_service' ? `${issue.kind}-${issue.guestIndex}` : issue.kind}>
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

              <div className="guest-tabs" role="tablist" aria-label={text.guests}>
                {guests.map((guest, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeGuestIndex === index}
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
                      return (
                        <label className={checked ? 'checked' : ''} key={extra.id}>
                          <input type="checkbox" checked={checked} onChange={() => toggleAddOn(extra.id)} />
                          <span className="check-box" aria-hidden="true">{checked ? '✓' : '+'}</span>
                          <span>{extra.name[locale]}</span>
                          <strong>{formatRinggit(extra.price)}</strong>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="field full-field">
                  <label htmlFor={`therapist-${activeGuest.id}`}>{text.therapist}</label>
                  <input
                    id={`therapist-${activeGuest.id}`}
                    value={activeGuest.therapistPreference}
                    onChange={(event) => updateGuest(activeGuest.id, { therapistPreference: event.target.value })}
                    placeholder={text.therapistHint}
                  />
                </div>

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
                <div className="field">
                  <label htmlFor="booking-date">{text.preferredDate} *</label>
                  <input id="booking-date" type="date" min={minimumDate} value={date} onChange={(event) => { setDate(event.target.value); setTime(''); }} aria-invalid={hasValidationIssue('date_required') || hasValidationIssue('past_time')} required />
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

                  {!date && <p className="availability-prompt">{text.selectDateFirst}</p>}
                  {date && !allGuestsConfigured && <p className="availability-prompt">{text.selectServicesFirst}</p>}
                  {date && allGuestsConfigured && (
                    <div className={`time-slot-groups${hasValidationIssue('time_required') || hasValidationIssue('past_time') ? ' invalid' : ''}`} role="group" aria-labelledby="booking-time-label" aria-describedby="booking-time-help">
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
                                onClick={() => setTime(slot.time)}
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
                <div className="field">
                  <label htmlFor="contact-name">{text.contactName} *</label>
                  <input id="contact-name" autoComplete="name" value={contactName} onChange={(event) => setContactName(event.target.value)} aria-invalid={hasValidationIssue('contact_name')} required />
                </div>
                <div className="field">
                  <label htmlFor="contact-phone">{text.whatsappPhone} *</label>
                  <input id="contact-phone" type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} aria-invalid={hasValidationIssue('contact_phone')} placeholder="01X-XXX XXXX" required />
                </div>
                <div className="field full-field">
                  <label htmlFor="booking-notes">{text.notes}</label>
                  <textarea id="booking-notes" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={text.notesHint} />
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
                  </div>
                );
              })}
            </div>
            {(date || time) && <p className="summary-time"><span>◷</span>{date || '—'} · {time || '—'}</p>}
            <div className="summary-total">
              <span>{text.total}</span>
              <strong>{formatRinggit(total)}</strong>
            </div>
            {validationAttempted && validationIssues.length > 0 && <p className="form-error" role="alert">{validationIssues.length} {text.validationRemaining}</p>}
            <button className="review-button" type="submit">{text.review}<span aria-hidden="true">→</span></button>
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
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowReview(false); }}>
          <section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <button ref={closeButtonRef} type="button" className="dialog-close" aria-label={text.close} onClick={() => setShowReview(false)}>×</button>
            <p className="eyebrow">{text.reference} · {reference}</p>
            <h2 id="review-title">{text.reviewTitle}</h2>

            <div className="dialog-appointment">
              <div><span>{text.preferredDate}</span><strong>{date}</strong></div>
              <div><span>{text.preferredTime}</span><strong>{time}</strong></div>
              <div><span>{text.contactName}</span><strong>{contactName}</strong></div>
            </div>

            <div className="dialog-guests">
              {guests.map((guest, index) => {
                const item = getMenuItem(guest.categoryId, guest.itemId)!;
                const category = getCategory(guest.categoryId)!;
                return (
                  <div key={guest.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{guest.name.trim() || `${text.guest} ${index + 1}`}</strong>
                      <p>{item.name[locale]}</p>
                      {guest.addOnIds.length > 0 && <small>+ {guest.addOnIds.map((id) => category.addOns.find((extra) => extra.id === id)?.name[locale]).filter(Boolean).join(', ')}</small>}
                      {guest.therapistPreference.trim() && <small>{text.therapist}: {guest.therapistPreference}</small>}
                    </div>
                    <b>{formatRinggit(guestTotal(guest))}</b>
                  </div>
                );
              })}
            </div>

            <div className="dialog-total"><span>{text.total}</span><strong>{formatRinggit(total)}</strong></div>

            {(sendStatus === 'missing' || sendStatus === 'blocked') && (
              <p className="configure-notice" role="status">{sendStatus === 'missing' ? text.configureNotice : text.sendHint}</p>
            )}
            <button type="button" className="whatsapp-button" onClick={openWhatsApp}>{text.sendWhatsApp}<span aria-hidden="true">↗</span></button>
            <button type="button" className="copy-button" onClick={copyRequest}>{sendStatus === 'copied' ? `✓ ${text.copied}` : text.copySummary}</button>
            <p className="send-hint">{text.sendHint}</p>
          </section>
        </div>
      )}
    </main>
  );
}
