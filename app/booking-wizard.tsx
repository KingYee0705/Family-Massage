'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { business, catalog, type GuestSelection, type Locale, type TherapistChoice } from './catalog';
import { buildOrderMessage, buildWhatsAppUrl, estimatedGuestDuration, formatRinggit, getBookingValidationIssues, getCategory, getMenuItem, guestTotal, orderTotal } from './order';
import { calculateDemoAvailability, emptyTherapistChoice, findDemoSchedule, getIncludedAddonIds, loadDemoState, malaysiaDateValue, readDemoBooking, reserveDemoBooking, sampleTherapists, subscribeDemoState, therapistChoiceLabel, type DemoBooking, type DemoPublicState } from './demo-booking';
import { calendarDays, changeTherapistChoice, isGuestReady, matchingTherapists, shiftDate } from './booking-flow';
import styles from './booking.module.css';

const newGuest = (id: string): GuestSelection => ({ id, name: '', categoryId: 'full-body', itemId: '', addOnIds: [], therapistPreference: '', therapistChoice: emptyTherapistChoice() });
const initialState: DemoPublicState = { version: 3, seedDate: '', therapists: sampleTherapists, bookings: [] };

export default function BookingWizard() {
  const [locale, setLocale] = useState<Locale>('en');
  const t = (en: string, zh: string) => locale === 'zh' ? zh : en;
  const [step, setStep] = useState(0);
  const [guests, setGuests] = useState<GuestSelection[]>([newGuest('guest-1')]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [date, setDate] = useState(malaysiaDateValue);
  const [weekStart, setWeekStart] = useState(malaysiaDateValue);
  const [time, setTime] = useState('');
  const [groupTiming, setGroupTiming] = useState<'together' | 'flexible'>('together');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [state, setState] = useState(initialState);
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [contactErrors, setContactErrors] = useState(false);
  const [alternatives, setAlternatives] = useState<string[] | null>(null);
  const [receipt, setReceipt] = useState<DemoBooking | null>(null);
  const [copied, setCopied] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const requestKey = useRef('');
  const submitLock = useRef(false);
  const guest = guests[activeIndex];
  const category = getCategory(guest.categoryId)!;
  const choice = guest.therapistChoice ?? emptyTherapistChoice();
  const therapist = choice.mode === 'specific' ? state.therapists.find((person) => person.id === choice.therapistId) : undefined;
  const today = malaysiaDateValue(clock);
  const total = orderTotal(guests);
  const allReady = guests.every((person) => isGuestReady(person, state.therapists));
  const slots = useMemo(() => allReady && date ? calculateDemoAvailability({ date, guests, groupTiming, therapists: state.therapists, bookings: state.bookings, now: clock }) : [], [allReady, date, guests, groupTiming, state, clock]);
  const selectedAvailable = ready && slots.some((slot) => slot.time === time && slot.available);
  const draft = { guests, date, time, groupTiming, contactName, contactPhone, notes };
  const issues = getBookingValidationIssues(draft, clock);
  const steps = [t('Therapist', '按摩师'), t('Treatment', '疗程'), t('Date & time', '日期与时间'), t('Your booking', '确认预约')];
  const dateLabel = (value: string, compact = false) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur', month: 'short', day: 'numeric', ...(compact ? {} : { weekday: 'short' as const }) }).format(new Date(value + 'T12:00:00+08:00'));
  const guestLabel = (index: number) => guests[index].name || t('Guest', '顾客') + ' ' + (index + 1);
  const refresh = useCallback(async () => {
    try { setState(await loadDemoState()); setReady(true); } catch { setReady(false); }
    setClock(new Date());
  }, []);
  useEffect(() => { const task = window.setTimeout(() => { void refresh(); }, 0); const unsubscribe = subscribeDemoState(() => { void refresh(); }); return () => { window.clearTimeout(task); unsubscribe(); }; }, [refresh]);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en'; }, [locale]);
  useEffect(() => { viewport.current?.scrollTo({ top: 0, behavior: 'instant' }); heading.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    if (!receipt?.receiptToken) return;
    let active = true;
    const update = () => { void readDemoBooking(receipt.id, receipt.receiptToken!).then((next) => { if (active) setReceipt(next); }).catch(() => {}); };
    const timer = window.setInterval(update, 15_000); window.addEventListener('focus', update);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [receipt?.id, receipt?.receiptToken]);

  function changed(clearTime = true) { if (clearTime) setTime(''); setError(''); setNotice(''); setAlternatives(null); requestKey.current = ''; }
  function patchGuest(patch: Partial<GuestSelection>) { setGuests((current) => current.map((person, index) => index === activeIndex ? { ...person, ...patch } : person)); changed(); }
  function chooseTherapist(nextChoice: TherapistChoice) {
    const next = changeTherapistChoice(guest, nextChoice, state.therapists);
    setGuests((current) => current.map((person, index) => index === activeIndex ? next : person)); changed();
    if (guest.itemId && !next.itemId) setNotice(t('Please choose a treatment this therapist can provide.', '请重新选择这位按摩师可提供的疗程。'));
  }
  function addGuest() { if (guests.length >= 6) return; setGuests([...guests, newGuest(crypto.randomUUID())]); setActiveIndex(guests.length); setStep(0); changed(); }
  function removeGuest() { if (guests.length <= 1) return; setGuests(guests.filter((_, index) => index !== activeIndex)); setActiveIndex(Math.max(0, activeIndex - 1)); changed(); }
  function next() {
    setError('');
    if (step === 1) { const incomplete = guests.findIndex((person) => !isGuestReady(person, state.therapists)); if (incomplete >= 0) { setActiveIndex(incomplete); setStep(incomplete === activeIndex ? 1 : 0); return; } }
    if (step === 2 && !selectedAvailable) { setError(t('Choose an available time to continue.', '请选择可预约的时间。')); return; }
    setStep(Math.min(3, step + 1));
  }
  async function confirm() {
    if (submitLock.current || receipt) return;
    setContactErrors(true); setError('');
    if (!allReady) { setActiveIndex(Math.max(0, guests.findIndex((person) => !isGuestReady(person, state.therapists)))); setStep(1); return; }
    if (!selectedAvailable || issues.some((issue) => ['date_required', 'time_required', 'past_time', 'minimum_notice'].includes(issue.kind))) { setStep(2); setError(t('Please choose an available time again. Your details are kept.', '请重新选择可预约时间，您的资料已保留。')); return; }
    if (issues.length) { document.getElementById(issues.some((issue) => issue.kind === 'contact_name') ? 'contact-name' : 'contact-phone')?.focus({ preventScroll: true }); return; }
    submitLock.current = true; setBusy(true);
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    try {
      const result = await reserveDemoBooking({ ...draft, idempotencyKey: requestKey.current });
      if (result.ok) { setReceipt(result.booking); viewport.current?.scrollTo({ top: 0, behavior: 'instant' }); }
      else { setAlternatives(result.alternatives); setTime(''); requestKey.current = ''; setStep(2); await refresh(); }
    } catch { setError(t('We could not confirm the booking. Your details are kept—please try again.', '暂时无法确认预约，您的资料已保留，请重试。')); }
    finally { submitLock.current = false; setBusy(false); }
  }
  const receiptMessage = receipt ? buildOrderMessage({ ...receipt, guests: receipt.guests.map((person) => ({ ...person, therapistPreference: therapistChoiceLabel(person.therapistChoice, locale, state.therapists) })) }, receipt.reference, locale, receipt.status, receipt.assignments.map((assignment) => ({ guestId: assignment.guestId, therapist: receipt.therapistSnapshots?.find((snapshot) => snapshot.guestId === assignment.guestId)?.name[locale] ?? assignment.therapistId, start: assignment.start, end: assignment.end }))) : '';
  const whatsapp = buildWhatsAppUrl(receiptMessage);
  const missingName = contactErrors && issues.some((issue) => issue.kind === 'contact_name');
  const missingPhone = contactErrors && issues.some((issue) => issue.kind === 'contact_phone');
  const selectedSchedule = selectedAvailable ? findDemoSchedule({ ...draft, therapists: state.therapists, bookings: state.bookings, now: clock }) : null;

  return <main className={styles.app}>
    <header className={styles.header}><a href="/" className={styles.brand}>Serene<span>{t('Family Massage', '家庭按摩')}</span></a><div className={styles.language} aria-label="Language"><button onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>EN</button><button onClick={() => setLocale('zh')} aria-pressed={locale === 'zh'}>中文</button></div></header>
    <div className={styles.demo}>{t('DEMO · Sample therapists & test bookings', '演示 · 示例按摩师与测试预约')}</div>
    {!receipt && <nav className={styles.progress} aria-label={t('Booking progress', '预约进度')}>{steps.map((label, index) => <span key={index} className={index === step ? styles.currentStep : index < step ? styles.doneStep : ''} aria-current={index === step ? 'step' : undefined}><b>{index < step ? '✓' : index + 1}</b>{label}</span>)}</nav>}
    <div className={styles.viewport} ref={viewport}><div className={styles.content}>
    {receipt ? <section className={styles.receipt} aria-live="polite">
      <span className={styles.successMark} aria-hidden="true">✓</span><h1>{receipt.status === 'confirmed' ? t('You’re booked.', '预约已确认。') : t('Your booking', '您的预约')}</h1><p>{t('Demo only · No payment taken', '仅供演示 · 未收取任何费用')}</p><strong className={styles.reference}>{receipt.reference}</strong><h2>{dateLabel(receipt.date)} · {receipt.time}</h2><p>{t('Status', '状态')}: {({ confirmed: t('Confirmed', '已确认'), pending: t('Pending', '待确认'), checked_in: t('Checked in', '已到店'), in_service: t('In service', '服务中'), completed: t('Completed', '已完成'), cancelled: t('Cancelled', '已取消'), expired: t('Expired', '已过期'), no_show: t('No-show', '未到店') })[receipt.status]}</p>
      {receipt.guests.map((person, index) => { const assignment = receipt.assignments.find((entry) => entry.guestId === person.id); const snapshot = receipt.therapistSnapshots?.find((entry) => entry.guestId === person.id); return <article className={styles.reviewGuest} key={person.id}><strong>{person.name || t('Guest', '顾客') + ' ' + (index + 1)}</strong><span>{getCategory(person.categoryId)?.name[locale]} · {getMenuItem(person.categoryId, person.itemId)?.name[locale]}</span><span>{snapshot?.staffNumber} · {snapshot?.name[locale]} · {assignment?.start}–{assignment?.end}</span></article>; })}
      <div className={styles.reviewTotal}><span>{t('Total', '合计')}</span><strong>{formatRinggit(receipt.total)}</strong></div><div className={styles.receiptActions}>{whatsapp && <a className={styles.primary} href={whatsapp} target="_blank" rel="noopener noreferrer">{t('Share on WhatsApp', '分享到 WhatsApp')}</a>}<button className={styles.secondary} onClick={async () => { try { await navigator.clipboard.writeText(receiptMessage); setCopied(true); } catch { setError(t('Please select and copy the summary below.', '请选中并复制下方摘要。')); } }}>{copied ? t('Copied', '已复制') : t('Copy summary', '复制预约摘要')}</button></div><p>{t('Shop WhatsApp', '店铺 WhatsApp')}: +{business.whatsappNumber}</p><details className={styles.disclosure}><summary>{t('Booking summary', '预约摘要')}</summary><textarea readOnly rows={10} value={receiptMessage} aria-label={t('Copyable booking summary', '可复制的预约摘要')} /></details>{error && <p role="alert" className={styles.error}>{error}</p>}<button className={styles.textButton} onClick={() => { setReceipt(null); setGuests([newGuest(crypto.randomUUID())]); setActiveIndex(0); setStep(0); setTime(''); setContactName(''); setContactPhone(''); setNotes(''); setContactErrors(false); setCopied(false); changed(); void refresh(); }}>{t('Start another demo booking', '开始新的测试预约')}</button>
    </section> : <>
      <div className={styles.heading}><p>{t('STEP', '步骤')} {step + 1} / 4</p><h1 ref={heading} tabIndex={-1}>{[t('Who would you like?', '想预约哪位按摩师？'), t('Choose your treatment', '选择您的疗程'), t('Find your time', '选择预约时间'), t('One last check', '最后确认一下')][step]}</h1></div>
      {!ready && <div className={styles.connection} role="status">{t('Connecting to availability… You can browse while we reconnect.', '正在连接预约系统…您可以先浏览疗程。')} <button onClick={() => void refresh()}>{t('Retry', '重试')}</button></div>}
      {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
      {step < 2 && <div className={styles.guestBar}><div className={styles.guestTabs}>{guests.map((person, index) => <button key={person.id} aria-pressed={index === activeIndex} onClick={() => { setActiveIndex(index); setNotice(''); }}>{guestLabel(index)}{isGuestReady(person, state.therapists) && ' ✓'}</button>)}{guests.length < 6 && <button onClick={addGuest}>+ {t('Guest', '同行顾客')}</button>}</div>{guests.length > 1 && <button className={styles.textButton} onClick={removeGuest}>{t('Remove', '移除')}</button>}</div>}
      <fieldset className={styles.fieldset} disabled={busy}>
      {step === 0 && <>
        <div className={styles.preferenceGrid}>{(['none', 'female', 'male'] as const).map((option) => <button key={option} className={styles.preference} aria-pressed={option === 'none' ? choice.mode === 'none' : choice.mode === 'gender' && choice.gender === option} onClick={() => chooseTherapist(option === 'none' ? emptyTherapistChoice() : { mode: 'gender', requirement: 'required', gender: option, therapistId: '' })}><span aria-hidden="true">{option === 'none' ? '↔' : option === 'female' ? '♀' : '♂'}</span><strong>{option === 'none' ? t('No preference', '无偏好') : option === 'female' ? t('Female', '女按摩师') : t('Male', '男按摩师')}</strong></button>)}</div>
        <div className={styles.sectionLabel}>{t('Or choose your therapist', '或选择熟悉的按摩师')}<span>{t('Sample portraits', '示例头像')}</span></div>
        <div className={styles.therapistGrid}>{state.therapists.filter((person) => person.active).map((person) => <button key={person.id} className={styles.therapist} aria-pressed={choice.mode === 'specific' && choice.therapistId === person.id} onClick={() => chooseTherapist({ mode: 'specific', requirement: 'required', gender: '', therapistId: person.id })}><div className={styles.portrait}><Image src={person.imageUrl} alt="" width={180} height={180} /><span className={styles.check} aria-hidden="true">✓</span></div><strong>{person.name[locale]} <span aria-label={person.gender === 'female' ? t('Female', '女') : t('Male', '男')}>{person.gender === 'female' ? '♀' : '♂'}</span></strong><span>{person.staffNumber}</span><small>{person.specialties[locale]}</small></button>)}</div>
        {therapist && <details className={styles.disclosure} key={therapist.id}><summary>{t('About', '关于')} {therapist.name[locale]}</summary><p>{therapist.description[locale]}</p><p>{t('Usual hours', '通常上班时间')}: {therapist.shiftStart}–{therapist.shiftEnd}</p><p>{t('Choose a treatment next to see times that fit its full duration.', '下一步选择疗程，即可查看足够完成整个疗程的空档。')}</p></details>}
        {choice.mode !== 'none' && <label className={styles.checkbox}><input type="checkbox" checked={choice.requirement === 'preferred'} onChange={(event) => chooseTherapist({ ...choice, requirement: event.target.checked ? 'preferred' : 'required' })} />{t('Another therapist is okay if unavailable', '若无空档，可以安排其他按摩师')}</label>}
      </>}
      {step === 1 && <>
        <div className={styles.selectionChip}><span>{therapistChoiceLabel(choice, locale, state.therapists)}</span><button className={styles.textButton} onClick={() => setStep(0)}>{t('Change', '更改')}</button></div>
        <div className={styles.categories}>{catalog.map((entry) => { const compatible = [...entry.treatments, ...entry.packages].some((item) => matchingTherapists({ ...guest, categoryId: entry.id, itemId: item.id, addOnIds: [] }, state.therapists).length); return <button key={entry.id} aria-pressed={category.id === entry.id} disabled={!compatible} onClick={() => patchGuest({ categoryId: entry.id, itemId: '', addOnIds: [] })}>{entry.name[locale]}</button>; })}</div>
        <div className={styles.serviceList}>{category.treatments.map((item) => <button key={item.id} className={styles.service} disabled={!matchingTherapists({ ...guest, itemId: item.id, addOnIds: [] }, state.therapists).length} aria-pressed={guest.itemId === item.id} onClick={() => patchGuest({ itemId: item.id, addOnIds: [] })}><span><strong>{item.name[locale]}</strong><small>{item.detail[locale]}</small></span><b>{formatRinggit(item.price)}</b></button>)}</div>
        <details className={styles.disclosure}><summary>{t('Packages', '优惠套餐')} <span>{category.packages.length}</span></summary><div className={styles.serviceList}>{category.packages.map((item) => <button key={item.id} className={styles.service} disabled={!matchingTherapists({ ...guest, itemId: item.id, addOnIds: [] }, state.therapists).length} aria-pressed={guest.itemId === item.id} onClick={() => patchGuest({ itemId: item.id, addOnIds: [] })}><span><strong>{item.name[locale]}</strong><small>{item.detail[locale]}</small></span><b>{formatRinggit(item.price)}</b></button>)}</div></details>
        {guest.itemId && <><div className={styles.selectedTreatment}><strong>{getMenuItem(guest.categoryId, guest.itemId)?.name[locale]}</strong><span>{estimatedGuestDuration(guest)} {t('min total', '分钟合计')} · {formatRinggit(guestTotal(guest))}</span></div><details className={styles.disclosure}><summary>{t('Add something extra', '添加附加项目')} <span>{guest.addOnIds.length || t('Optional', '可选')}</span></summary><div className={styles.extras}>{category.addOns.map((extra) => { const included = getIncludedAddonIds(guest).includes(extra.id); const selected = guest.addOnIds.includes(extra.id); const compatible = selected || matchingTherapists({ ...guest, addOnIds: [...guest.addOnIds, extra.id] }, state.therapists).length > 0; return <label key={extra.id}><input type="checkbox" checked={selected || included} disabled={included || !compatible} onChange={() => patchGuest({ addOnIds: selected ? guest.addOnIds.filter((id) => id !== extra.id) : [...guest.addOnIds, extra.id] })} /><span>{extra.name[locale]}{!compatible && <small>{t('Not available with this therapist', '该按摩师不提供此项目')}</small>}</span><strong>{included ? t('Included', '已包含') : '+ ' + formatRinggit(extra.price)}</strong></label>; })}</div></details></>}
      </>}
      {step === 2 && <>
        <div className={styles.calendarHeader}><button aria-label={t('Previous week', '上一周')} disabled={weekStart <= today} onClick={() => setWeekStart(shiftDate(weekStart, -7) < today ? today : shiftDate(weekStart, -7))}>‹</button><label><span>{t('Choose date', '选择日期')}</span><input type="date" min={today} value={date} onChange={(event) => { if (event.target.value && event.target.value >= today) { setDate(event.target.value); setWeekStart(event.target.value); changed(); } }} /></label><button aria-label={t('Next week', '下一周')} onClick={() => setWeekStart(shiftDate(weekStart, 7))}>›</button></div>
        <div className={styles.dateStrip}>{calendarDays(weekStart).map((day) => <button key={day} disabled={day < today} aria-pressed={day === date} onClick={() => { setDate(day); changed(); }}><span>{new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))}</span><strong>{Number(day.slice(-2))}</strong><small>{new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))}</small></button>)}</div>
        {guests.length > 1 && <label className={styles.checkbox}><input type="checkbox" checked={groupTiming === 'flexible'} onChange={(event) => { setGroupTiming(event.target.checked ? 'flexible' : 'together'); changed(); }} />{t('Different start times are okay, finishing together', '可以错开开始时间，一起结束')}</label>}
        {alternatives && <div className={styles.error} role="alert"><strong>{t('That time was just taken.', '刚才的空档已被预约。')}</strong><p>{t('Your details are saved. Please choose another time and confirm again.', '资料已保留，请选择其他时间并再次确认。')}</p>{alternatives.length > 0 && <span>{t('Nearby times', '附近可选时间')}: {alternatives.join(' · ')}</span>}</div>}
        {!allReady ? <button className={styles.secondary} onClick={() => setStep(1)}>{t('Choose a treatment for every guest first', '请先为每位顾客选择疗程')}</button> : <><p className={styles.smallNote}>{t('Malaysia time · Full treatment + cleaning checked', '马来西亚时间 · 已考虑完整疗程与清洁时间')}</p>{time && ready && !selectedAvailable && <p role="status" className={styles.notice}>{t('Your selected time is no longer available. Please choose another time; your details are kept.', '所选时间已不可预约，请重新选择。您的资料已保留。')}</p>}{ready && !slots.some((slot) => slot.available) && <div className={styles.notice}>{t('No times fit this booking on this date. Try another date, treatment or therapist.', '当日没有符合此预约的空档，请更换日期、疗程或按摩师。')}</div>}{[{ name: t('Morning', '上午'), from: 0, to: 12 }, { name: t('Afternoon', '下午'), from: 12, to: 17 }, { name: t('Evening', '晚上'), from: 17, to: 24 }].map((group) => <section className={styles.timeGroup} key={group.from}><h2>{group.name}</h2><div className={styles.times}>{slots.filter((slot) => Number(slot.time.slice(0, 2)) >= group.from && Number(slot.time.slice(0, 2)) < group.to).map((slot) => <button key={slot.time} disabled={!ready || !slot.available} aria-pressed={time === slot.time} aria-label={slot.time + (!slot.available ? ' ' + t('unavailable', '不可预约') : '')} onClick={() => { setTime(slot.time); changed(false); }}>{slot.time}</button>)}</div></section>)}{selectedSchedule && <p className={styles.notice}>{t('Your visit', '您的疗程')}: {selectedSchedule.assignments.map((assignment, index) => (guests.length > 1 ? guestLabel(index) + ' ' : '') + assignment.start + '–' + assignment.end).join(' · ')}</p>}</>}
      </>}
      {step === 3 && <>
        <div className={styles.appointmentSummary}><div><strong>{dateLabel(date)}</strong><span>{time} · {guests.length} {t('guest(s)', '位顾客')}</span></div><button className={styles.textButton} onClick={() => setStep(2)}>{t('Edit time', '更改时间')}</button></div>
        <div className={styles.contactGrid}><label htmlFor="contact-name">{t('Contact name', '联系人姓名')}<input id="contact-name" autoComplete="name" maxLength={100} value={contactName} aria-invalid={missingName} aria-describedby={missingName ? 'name-error' : undefined} onChange={(event) => { setContactName(event.target.value); changed(false); }} />{missingName && <small id="name-error" className={styles.fieldError}>{t('Enter a name with at least 2 characters.', '请填写至少两个字的姓名。')}</small>}</label><label htmlFor="contact-phone">{t('WhatsApp number', 'WhatsApp 电话')}<input id="contact-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={25} placeholder="+60 / +65" value={contactPhone} aria-invalid={missingPhone} aria-describedby={missingPhone ? 'phone-error' : undefined} onChange={(event) => { setContactPhone(event.target.value); changed(false); }} />{missingPhone && <small id="phone-error" className={styles.fieldError}>{t('Enter a valid phone number.', '请填写有效电话号码。')}</small>}</label></div>
        {guests.map((person, index) => <article key={person.id} className={styles.reviewGuest}><div><strong>{guestLabel(index)}</strong><button className={styles.textButton} onClick={() => { setActiveIndex(index); setStep(1); }}>{t('Edit', '更改')}</button></div><span>{getCategory(person.categoryId)?.name[locale]} · {getMenuItem(person.categoryId, person.itemId)?.name[locale]}</span><span>{therapistChoiceLabel(person.therapistChoice, locale, state.therapists)}</span>{person.addOnIds.length > 0 && <small>{person.addOnIds.map((id) => getCategory(person.categoryId)?.addOns.find((extra) => extra.id === id)?.name[locale]).join(' · ')}</small>}<strong>{formatRinggit(guestTotal(person))}</strong></article>)}
        <details className={styles.disclosure}><summary>{t('Guest names & requests', '同行姓名与备注')} <span>{t('Optional', '可选')}</span></summary>{guests.map((person, index) => <label className={styles.optionalLabel} key={person.id}>{t('Guest', '顾客')} {index + 1}<input maxLength={100} value={person.name} onChange={(event) => { setGuests(guests.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry)); changed(false); }} /></label>)}<label className={styles.optionalLabel}>{t('Requests', '备注')}<textarea rows={2} maxLength={1500} value={notes} onChange={(event) => { setNotes(event.target.value); changed(false); }} /></label></details>
        <div className={styles.reviewTotal}><span>{t('Pay at the shop', '到店付款')}</span><strong>{formatRinggit(total)}</strong></div><p className={styles.smallNote}>{t('Test booking only. Your place is reserved when confirmation succeeds.', '仅供测试。系统确认成功后才会保留预约。')}</p><details className={styles.disclosure}><summary>{t('Booking policy', '预约须知')}</summary><p>{t('Book at least one hour ahead. Please call if you will be late; a delay of 15 minutes may cancel the appointment unless you notify the shop in advance. Contact the shop early to cancel.', '请至少提前一小时预约。如会迟到请提前致电；迟到十五分钟且未事先通知，预约可能被取消。如需取消，请尽早联系店铺。')}</p></details>
      </>}
      </fieldset>
    </>}
    </div></div>
    {!receipt && <footer className={styles.footer}><div className={styles.footerSummary}><span>{step < 2 ? guestLabel(activeIndex) : guests.length + ' ' + t('guest(s)', '位顾客')}{step >= 2 && date ? ' · ' + dateLabel(date, true) : ''}{time ? ' · ' + time : ''}</span><strong>{formatRinggit(total)}</strong></div><div className={styles.footerActions}>{step > 0 && <button className={styles.secondary} disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}>{t('Back', '返回')}</button>}<button className={styles.primary} disabled={busy || (step === 1 && !isGuestReady(guest, state.therapists)) || (step === 2 && !selectedAvailable) || (step === 3 && !ready)} onClick={() => step === 3 ? void confirm() : next()}>{busy ? t('Confirming…', '确认中…') : step === 3 ? t('Confirm demo booking', '确认测试预约') : step === 1 && guests.some((person, index) => index !== activeIndex && !isGuestReady(person, state.therapists)) ? t('Next guest', '下一位顾客') : t('Next', '下一步')} {!busy && step < 3 && <span aria-hidden="true">→</span>}</button></div></footer>}
  </main>;
}
