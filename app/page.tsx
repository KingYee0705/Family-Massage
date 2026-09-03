'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  bookingSettings,
  business,
  catalog,
  ui,
  type GuestSelection,
  type Locale,
} from './catalog';
import {
  buildOrderMessage,
  buildWhatsAppUrl,
  createTimeSlots,
  createReference,
  formatRinggit,
  getCategory,
  getMenuItem,
  guestTotal,
  isFutureAppointment,
  orderTotal,
  type BookingDraft,
} from './order';

const timeSlots = createTimeSlots(
  bookingSettings.firstTime,
  bookingSettings.lastTime,
  bookingSettings.intervalMinutes,
);

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
  const [formError, setFormError] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [reference, setReference] = useState('');
  const [sendStatus, setSendStatus] = useState<'idle' | 'missing' | 'blocked' | 'copied'>('idle');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const text = ui[locale];
  const menuCategory = getCategory(menuCategoryId)!;
  const activeGuest = guests[activeGuestIndex];
  const activeCategory = getCategory(activeGuest.categoryId)!;
  const selectedItem = getMenuItem(activeGuest.categoryId, activeGuest.itemId);
  const total = orderTotal(guests);

  const draft: BookingDraft = useMemo(() => ({
    guests,
    date,
    time,
    contactName,
    contactPhone,
    notes,
  }), [guests, date, time, contactName, contactPhone, notes]);

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
    setFormError('');
  }

  function chooseCategory(categoryId: string) {
    updateGuest(activeGuest.id, { categoryId, itemId: '', addOnIds: [] });
  }

  function chooseMenuItem(categoryId: string, itemId: string) {
    updateGuest(activeGuest.id, { categoryId, itemId, addOnIds: [] });
    requestAnimationFrame(() => document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' }));
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
    setFormError('');
  }

  function removeGuest(index: number) {
    if (guests.length === 1) return;
    const next = guests.filter((_, guestIndex) => guestIndex !== index);
    setGuests(next);
    setActiveGuestIndex(Math.min(index, next.length - 1));
    setFormError('');
  }

  function isFormComplete() {
    const guestsComplete = guests.every((guest) => Boolean(getMenuItem(guest.categoryId, guest.itemId)));
    const phoneIsValid = /^\+?[0-9\s-]{8,18}$/.test(contactPhone.trim());
    return guestsComplete && contactName.trim().length >= 2 && phoneIsValid && isFutureAppointment(date, time);
  }

  function handleReview(event: FormEvent) {
    event.preventDefault();
    if (!isFormComplete()) {
      setFormError(date && time && !isFutureAppointment(date, time) ? text.pastTime : text.invalidForm);
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
                  <button type="button" className="session-card" onClick={() => chooseMenuItem(menuCategory.id, item.id)} key={item.id}>
                    <span className="selection-dot" aria-hidden="true" />
                    <span className="session-name">{item.name[locale]}</span>
                    <strong>{formatRinggit(item.price)}</strong>
                    <span className="card-action">{text.addToBooking} →</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="menu-block package-block">
              <div className="menu-label"><span>{text.packages}</span><i /></div>
              <div className="package-list">
                {menuCategory.packages.map((item, index) => (
                  <button type="button" className="package-row" onClick={() => chooseMenuItem(menuCategory.id, item.id)} key={item.id}>
                    <span className="package-number">{String(index + 1).padStart(2, '0')}</span>
                    <span>{item.name[locale]}</span>
                    <strong>{formatRinggit(item.price)}</strong>
                    <span aria-hidden="true">↗</span>
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

                <div className="field full-field">
                  <label htmlFor={`service-${activeGuest.id}`}>{text.selectTreatment} *</label>
                  <div className="select-wrap">
                    <select
                      id={`service-${activeGuest.id}`}
                      value={activeGuest.itemId}
                      aria-invalid={Boolean(formError && !selectedItem)}
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
                  <input id="booking-date" type="date" min={minimumDate} value={date} onChange={(event) => { setDate(event.target.value); setFormError(''); }} aria-invalid={Boolean(formError && !date)} required />
                </div>
                <div className="field">
                  <label htmlFor="booking-time">{text.preferredTime} *</label>
                  <div className="select-wrap">
                    <select id="booking-time" value={time} onChange={(event) => { setTime(event.target.value); setFormError(''); }} aria-invalid={Boolean(formError && !time)} required>
                      <option value="">— {text.chooseTime} —</option>
                      {timeSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                    </select>
                    <span aria-hidden="true">⌄</span>
                  </div>
                  <p className="field-help">{text.timeRequestNote}</p>
                </div>
                <div className="field">
                  <label htmlFor="contact-name">{text.contactName} *</label>
                  <input id="contact-name" autoComplete="name" value={contactName} onChange={(event) => { setContactName(event.target.value); setFormError(''); }} aria-invalid={Boolean(formError && contactName.trim().length < 2)} required />
                </div>
                <div className="field">
                  <label htmlFor="contact-phone">{text.whatsappPhone} *</label>
                  <input id="contact-phone" type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(event) => { setContactPhone(event.target.value); setFormError(''); }} aria-invalid={Boolean(formError && !/^\+?[0-9\s-]{8,18}$/.test(contactPhone.trim()))} placeholder="01X-XXX XXXX" required />
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
            {formError && <p className="form-error" role="alert">{formError}</p>}
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
