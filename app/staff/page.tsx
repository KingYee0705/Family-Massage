'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- vinext's Next Link shim currently loads a duplicate React copy in this local demo. */

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { bookingSettings, business, catalog, type GuestSelection, type Locale } from '../catalog';
import {
  DemoApiError, addDemoBookingAddOns, emptyTherapistChoice, getDemoSession, isTherapistCompatible, loadStaffDemoState,
  loadTodayDemoEarnings, loginDemoStaff, logoutDemoStaff, malaysiaDateValue, reassignDemoBooking,
  reserveStaffDemoBooking, resetDemoState, rescheduleDemoBooking, therapistChoiceLabel,
  therapistMatchesPreference, updateDemoBookingStatus, updateDemoTherapist,
  type DemoBooking, type DemoBookingSource, type DemoBookingStatus, type DemoDailyEarnings,
  type DemoReservationInput, type DemoReservationResult, type DemoStaffUser,
  type DemoState, type TherapistProfile,
} from '../demo-booking';
import { createTimeSlots, estimatedGuestDuration, formatRinggit, getCategory, getMenuItem, guestTotal, orderTotal } from '../order';
import styles from './staff.module.css';
import { RoomBoard } from '../room-board';

type Translate = (en: string, zh: string) => string;
type Modal = { type: 'booking'; id: string } | { type: 'create' } | { type: 'therapist'; id: string } | null;
const blocking = new Set<DemoBookingStatus>(['pending', 'confirmed', 'checked_in', 'in_service']);
const terminal = new Set<DemoBookingStatus>(['completed', 'cancelled', 'no_show', 'expired']);
const statusLabels: Record<DemoBookingStatus, [string, string]> = {
  pending: ['Pending', '待确认'], confirmed: ['Confirmed', '已确认'], checked_in: ['Checked in', '已到店'],
  in_service: ['In service', '服务中'], completed: ['Completed', '已完成'], cancelled: ['Cancelled', '已取消'],
  no_show: ['No-show', '未到店'], expired: ['Expired', '已过期'],
};
const sourceLabels: Record<DemoBookingSource, [string, string]> = {
  online: ['Website', '网站'], phone: ['Phone', '电话'], whatsapp: ['WhatsApp', 'WhatsApp'], walk_in: ['Walk-in', '到店'],
};
const statusActions: Partial<Record<DemoBookingStatus, DemoBookingStatus[]>> = {
  pending: ['confirmed', 'cancelled'], confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_service', 'cancelled', 'no_show'], in_service: ['completed'],
};
const actionLabels: Partial<Record<DemoBookingStatus, [string, string]>> = {
  confirmed: ['Confirm booking', '确认预约'], checked_in: ['Check in', '登记到店'], in_service: ['Start treatment', '开始疗程'],
  completed: ['Complete', '完成'], cancelled: ['Cancel booking', '取消预约'], no_show: ['Mark no-show', '标记未到店'],
};
const allAddOns = Array.from(new Map(catalog.flatMap((category) => category.addOns).map((addon) => [addon.id, addon])).values());
const addOnMinutes: Readonly<Record<string, number>> = bookingSettings.estimatedAddOnDurationMinutes;
const includedAddOn: Record<string, string> = {
  'aroma-pkg-ear': 'ear-candling', 'thai-pkg-ear': 'ear-candling', 'body-pkg-ear': 'ear-candling',
  'aroma-pkg-cupping': 'cupping', 'thai-pkg-cupping': 'cupping', 'body-pkg-cupping': 'cupping', 'foot-pkg-cupping': 'cupping',
  'aroma-pkg-guasha': 'gua-sha', 'thai-pkg-guasha': 'gua-sha', 'body-pkg-guasha': 'gua-sha',
  'thai-pkg-scrub': 'body-scrubbing', 'body-pkg-scrub': 'body-scrubbing', 'foot-pkg-scrub': 'foot-scrubbing',
  'foot-pkg-shoulder': 'shoulder-30',
};
const timeOptions = createTimeSlots('11:00', '23:55', 5);
const minuteValue = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const currentShopTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const money = (value: number, locale: Locale) => new Intl.NumberFormat(locale === 'zh' ? 'zh-MY' : 'en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2 }).format(value);
const newGuest = (): GuestSelection => ({ id: crypto.randomUUID(), name: '', categoryId: 'full-body', itemId: 'body-60', addOnIds: [], therapistPreference: '', therapistChoice: emptyTherapistChoice() });
function dateLabel(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(`${date}T12:00:00+08:00`));
}
function resourceLabel(id: string, t: Translate) { return id.replace('bed-', `${t('Bed', '床')} `).replace('chair-', `${t('Chair', '椅')} `); }
function extraSourceLabel(source: 'counter' | 'during_service', t: Translate) { return source === 'counter' ? t('At the counter', '柜台加购') : t('During treatment', '疗程中加购'); }
function bookingMessage(booking: DemoBooking, therapists: TherapistProfile[], locale: Locale, kind: 'status' | 'reminder' | 'alternative', proposedDate: string, proposedTime: string) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const heading = kind === 'alternative' ? t('ALTERNATIVE TIME PROPOSAL', '建议更改预约时间')
    : kind === 'reminder' ? t('APPOINTMENT REMINDER', '预约提醒')
      : t(...statusLabels[booking.status]).toUpperCase();
  const lines = [`*${heading}*`, business.name, `${t('Ref', '编号')}: ${booking.reference}`, '',
    `${t('Date', '日期')}: ${booking.date}`, `${t('Time', '时间')}: ${booking.time} (MYT / UTC+8)`,
    `${t('Guests', '人数')}: ${booking.guests.length}`, `${t('Status', '状态')}: ${t(...statusLabels[booking.status])}`, ''];
  booking.guests.forEach((guest, index) => {
    const category = getCategory(guest.categoryId);
    const item = getMenuItem(guest.categoryId, guest.itemId);
    const priceSnapshot = booking.priceSnapshots?.find((entry) => entry.guestId === guest.id);
    const assignment = booking.assignments.find((entry) => entry.guestId === guest.id);
    const therapist = therapists.find((entry) => entry.id === assignment?.therapistId);
    const therapistSnapshot = booking.therapistSnapshots?.find((entry) => entry.guestId === guest.id);
    lines.push(`*${t('GUEST', '顾客')} ${index + 1}${guest.name ? ` · ${guest.name}` : ''}*`,
      `${priceSnapshot?.category[locale] ?? category?.name[locale] ?? guest.categoryId}`,
      `${priceSnapshot?.item[locale] ?? item?.name[locale] ?? guest.itemId} — ${formatRinggit(priceSnapshot?.itemPrice ?? item?.price ?? 0)}`);
    (priceSnapshot?.addOns ?? guest.addOnIds.map((id) => category?.addOns.find((entry) => entry.id === id)).filter((entry) => entry !== undefined)).forEach((extra) => {
      const sale = booking.addOnSales?.find((entry) => entry.guestId === guest.id && entry.addOnId === extra.id);
      lines.push(`+ ${extra.name[locale]} — ${formatRinggit(extra.price)}${sale ? ` (${extraSourceLabel(sale.source, t)})` : ''}`);
    });
    lines.push(`${t('Preference', '偏好')}: ${therapistChoiceLabel(guest.therapistChoice, locale, therapists)}`);
    if (assignment) lines.push(`${t('Time', '时间')}: ${assignment.start}–${assignment.end}`);
    if (therapistSnapshot || therapist) lines.push(`${t('Therapist', '按摩师')}: ${therapistSnapshot?.staffNumber ?? therapist?.staffNumber} · ${therapistSnapshot?.name[locale] ?? therapist?.name[locale]}`);
    lines.push(`${t('Subtotal', '小计')}: ${formatRinggit(priceSnapshot?.total ?? guestTotal(guest))}`, '');
  });
  lines.push(`${t('Contact', '联系人')}: ${booking.contactName}`, `${t('Phone', '电话')}: ${booking.contactPhone}`);
  if (booking.notes) lines.push(`${t('Notes', '备注')}: ${booking.notes}`);
  lines.push('', `*${t('TOTAL', '总计')}: ${formatRinggit(booking.total)}*`, '');
  if (kind === 'alternative') lines.push(`${t('Proposed date/time', '建议日期／时间')}: ${proposedDate} ${proposedTime} (MYT)`, t('Please reply if this works for you. This proposal does not change or reserve your appointment.', '请回复是否方便。此建议尚未更改或保留您的预约时间。'));
  else if (booking.status === 'pending') lines.push(t('Your request is awaiting staff confirmation.', '您的预约申请正在等待员工确认。'));
  else if (booking.status === 'cancelled' || booking.status === 'expired' || booking.status === 'no_show') lines.push(t('This appointment is no longer reserved. Please contact us if you would like another time.', '此预约已不再保留。如需另约时间，请联系我们。'));
  else if (kind === 'reminder' || booking.status === 'confirmed') lines.push(t('We look forward to seeing you. Please contact us in advance if you will be late or need to cancel.', '期待您的光临。如需迟到或取消，请提前联系我们。'));
  return lines.join('\n');
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="staff-dialog-title" onCancel={close} onClick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
    <div className={styles.dialogHeading}><h2 id="staff-dialog-title">{title}</h2><button type="button" aria-label="Close / 关闭" onClick={close} className={styles.closeButton}>×</button></div>
    {children}
  </dialog>;
}

function Status({ status, t }: { status: DemoBookingStatus; t: Translate }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{t(...statusLabels[status])}</span>;
}

function TodayEarnings({ summary, locale, canOpenBookings, onOpenBooking }: { summary: DemoDailyEarnings; locale: Locale; canOpenBookings: boolean; onOpenBooking: (id: string) => void }) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  return <>
    <div className={styles.todayOnlyNotice}>
      <span aria-hidden="true">●</span>
      <div><strong>{t('Today only', '仅显示今天')} · {dateLabel(summary.date, locale)}</strong><small>{t('This view resets at midnight, Malaysia time. Past earnings are not available here.', '此页面会在马来西亚时间午夜重置，无法在这里查看过去的收入。')}</small></div>
    </div>
    <div className={styles.earningsSummary}>
      <article className={styles.earningsTotal}><span>{t('Today’s total', '今日总额')}</span><strong>{money(summary.gross, locale)}</strong><small>{t('Combined value of completed treatments', '已完成疗程的合计金额')}</small></article>
      <article><span>{t('Completed treatments', '已完成疗程')}</span><strong>{summary.completedTreatments}</strong><small>{t('Completed work only', '仅计算已完成服务')}</small></article>
    </div>
    <div className={styles.earningsHeading}><div><h2>{t('Therapist breakdown', '按摩师业绩明细')}</h2><p>{t('Completed treatments and their combined service amounts for today.', '显示每位按摩师今天已完成的疗程及合计金额。')}</p></div></div>
    <div className={styles.therapistEarningsList}>
      {summary.therapists.map((therapist) => <details className={styles.therapistEarningsCard} key={therapist.therapistId} open={therapist.lines.length > 0}>
        <summary><Image src={therapist.imageUrl} alt="" width={52} height={52} /><div><strong>{therapist.staffNumber} · {therapist.name[locale]}</strong><span>{therapist.completedTreatments} {t('completed treatment(s)', '项已完成疗程')}</span></div><div className={styles.therapistEarningAmount}><strong>{money(therapist.gross, locale)}</strong><span>{t('today’s total', '今日合计')}</span></div></summary>
        {!therapist.lines.length ? <p className={styles.noEarnings}>{t('No completed treatments yet today.', '今天尚未有已完成的疗程。')}</p> : <div className={styles.earningLines}>{therapist.lines.map((line) => {
          const content = <><div className={styles.earningTime}><strong>{line.start}–{line.end}</strong><small>{line.reference}</small></div><div className={styles.earningService}><strong>{line.service[locale]}</strong><span>{line.guestName || line.customerName}{line.addOns.length ? ` · ${line.addOns.map((entry) => entry[locale]).join(', ')}` : ''}</span></div><div><span>{t('Treatment total', '疗程金额')}</span><strong>{money(line.gross, locale)}</strong></div></>;
          return canOpenBookings ? <button type="button" className={styles.earningLine} key={`${line.bookingId}-${line.guestId}`} onClick={() => onOpenBooking(line.bookingId)}>{content}</button> : <div className={styles.earningLine} key={`${line.bookingId}-${line.guestId}`}>{content}</div>;
        })}</div>}
      </details>)}
    </div>
    <div className={styles.reconciliation}><span>{t('Sum of all therapist totals today', '所有按摩师今日金额合计')}</span><strong>{money(summary.gross, locale)}</strong></div>
  </>;
}

export default function StaffPage() {
  const [locale, setLocale] = useState<Locale>('en');
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const [user, setUser] = useState<DemoStaffUser | null>(null);
  const [state, setState] = useState<DemoState | null>(null);
  const [earnings, setEarnings] = useState<DemoDailyEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [date, setDate] = useState(malaysiaDateValue);
  const [clockTime, setClockTime] = useState(currentShopTime);
  const [asOf, setAsOf] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [tab, setTab] = useState<'overview' | 'earnings' | 'bookings' | 'team' | 'rooms'>('overview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [modal, setModal] = useState<Modal>(null);
  const [email, setEmail] = useState('owner@serene.demo');
  const [password, setPassword] = useState('');
  const roleRef = useRef<DemoStaffUser['role']>('owner');

  const refresh = useCallback(async (role = roleRef.current) => {
    try {
      roleRef.current = role;
      if (role === 'therapist') {
        setState(null);
        setEarnings(await loadTodayDemoEarnings());
      } else {
        const [nextState, nextEarnings] = await Promise.all([loadStaffDemoState(), loadTodayDemoEarnings()]);
        setState(nextState);
        setEarnings(nextEarnings);
      }
      setClockTime(currentShopTime());
      setLastUpdated(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()));
    } catch (cause) {
      if (cause instanceof DemoApiError && cause.status === 401) {
        setUser(null);
        setState(null);
        setEarnings(null);
        setModal(null);
      }
      throw cause;
    }
  }, []);
  useEffect(() => {
    let active = true;
    getDemoSession().then(async (session) => {
      if (!active) return;
      setUser(session);
      if (session) {
        roleRef.current = session.role;
        if (session.role === 'therapist') { setTab('earnings'); setDate(malaysiaDateValue()); }
        await refresh(session.role);
      }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to connect. Please retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => { refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to refresh.')); }, 15_000);
    return () => window.clearInterval(timer);
  }, [user, refresh]);

  async function run(action: () => Promise<unknown>, success = '') {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (success) setNotice(success); }
    catch (cause) {
      if (cause instanceof DemoApiError && cause.status === 401) {
        setUser(null); setState(null); setModal(null);
      }
      setError(cause instanceof Error ? cause.message : t('Something went wrong. Please try again.', '操作失败，请重试。'));
      if (user) { try { await refresh(); } catch { /* The original error is more useful. */ } }
    }
    finally { setBusy(false); }
  }
  function open(next: Modal) { setError(''); setNotice(''); setModal(next); }
  async function login(event: FormEvent) {
    event.preventDefault();
    await run(async () => { const next = await loginDemoStaff(email, password); roleRef.current = next.role; if (next.role === 'therapist') { setTab('earnings'); setDate(malaysiaDateValue()); } setUser(next); setPassword(''); await refresh(next.role); });
  }
  const selectedTime = asOf || (date === malaysiaDateValue() ? clockTime : '14:00');
  const bookings = (state?.bookings ?? []).filter((booking) => booking.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const activeBookings = bookings.filter((booking) => blocking.has(booking.status) || booking.status === 'completed');
  const occupancy = bookings.filter((booking) => blocking.has(booking.status)).flatMap((booking) => booking.assignments).filter((assignment) => assignment.start <= selectedTime && assignment.cleanupEnd > selectedTime);
  const busyIds = new Set(occupancy.map((assignment) => assignment.therapistId));
  const workingTherapists = (state?.therapists ?? []).filter((therapist) => therapist.active && !therapist.leaveDates.includes(date) && therapist.shiftStart <= selectedTime && therapist.shiftEnd > selectedTime);
  const resources = new Set(occupancy.flatMap((assignment) => assignment.resourceIds));
  const visibleBookings = bookings.filter((booking) => (statusFilter === 'all' || booking.status === statusFilter) && (sourceFilter === 'all' || booking.source === sourceFilter) && `${booking.reference} ${booking.contactName} ${booking.contactPhone} ${booking.guests.map((guest) => guest.name).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const chosenBooking = modal?.type === 'booking' ? state?.bookings.find((booking) => booking.id === modal.id) : undefined;
  const chosenTherapist = modal?.type === 'therapist' ? state?.therapists.find((therapist) => therapist.id === modal.id) : undefined;
  const feedback = <>{error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}</>;

  return <main className={styles.app} lang={locale === 'zh' ? 'zh-Hans' : 'en'}>
    <div className={styles.demoBanner}><span>{t('LOCAL DEMO', '本地演示')}</span>{t('Sample staff and test appointments. No real bookings.', '示例员工与测试预约，不接收真实预约。')}</div>
    <header className={styles.header}>
      <a href="/" className={styles.brand}><span>S</span><div>Serene<small>{t('Staff workspace', '员工工作台')}</small></div></a>
      <div className={styles.headerActions}><a href="/">{t('Customer website', '顾客网站')} ↗</a>{user?.role === 'owner' && <a href="/boss">{t('Boss dashboard', '老板后台')} ↗</a>}<div className={styles.language}><button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button><button type="button" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button></div>{user && <button type="button" className={styles.textButton} disabled={busy} onClick={() => run(async () => { await logoutDemoStaff(); roleRef.current = 'owner'; setUser(null); setState(null); setEarnings(null); setModal(null); })}>{t('Sign out', '退出')}</button>}</div>
    </header>
    {loading ? <div className={styles.loading} role="status">{t('Opening staff workspace…', '正在打开员工工作台…')}</div> : !user ?
      <section className={styles.loginLayout}>
        <div><p className={styles.eyebrow}>{t('A calmer day, together', '让每一天更从容')}</p><h1>{t('Every appointment.\nOne clear view.', '所有预约，\n一目了然。')}</h1><p className={styles.intro}>{t('See who is coming, who is available, and what your team needs next.', '查看顾客预约、员工空档，轻松安排接下来的服务。')}</p><div className={styles.loginFeature}><span>01</span>{t('Live therapist schedules', '实时按摩师排班')}</div><div className={styles.loginFeature}><span>02</span>{t('Website, calls and walk-ins in one place', '网站、电话及到店预约统一管理')}</div><div className={styles.loginFeature}><span>03</span>{t('Clear handovers for your team', '让员工交接更清晰')}</div></div>
        <div className={styles.loginCard}><p className={styles.eyebrow}>{t('Staff access', '员工入口')}</p><h2>{t('Welcome back', '欢迎回来')}</h2>{feedback}<form onSubmit={login} className={styles.form}>
          <label>{t('Email', '电子邮箱')}<input autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{t('Password', '密码')}<input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className={styles.primaryButton} disabled={busy}>{busy ? t('Signing in…', '登录中…') : t('Open dashboard →', '进入工作台 →')}</button>
        </form><div className={styles.demoCredentials}><strong>{t('Try the local demo', '体验本地演示')}</strong><p>{t('Password for every demo account', '所有演示账户的密码')}: <code>SereneDemo!</code></p><button type="button" onClick={() => { setEmail('owner@serene.demo'); setPassword('SereneDemo!'); }}>{t('Use owner account', '使用店主账户')}<small>owner@serene.demo</small></button><button type="button" onClick={() => { setEmail('receptionist@serene.demo'); setPassword('SereneDemo!'); }}>{t('Use front-desk account', '使用前台账户')}<small>receptionist@serene.demo</small></button><button type="button" onClick={() => { setEmail('s01@serene.demo'); setPassword('SereneDemo!'); }}>{t('Use sample therapist S01', '使用示例按摩师 S01')}<small>s01@serene.demo</small></button></div></div>
      </section> : <div className={styles.workspace}>
        <aside className={styles.sidebar}><p className={styles.eyebrow}>{t('Workspace', '工作台')}</p><nav aria-label={t('Staff sections', '员工功能')}>
          {user.role !== 'therapist' && <button type="button" aria-pressed={tab === 'overview'} className={tab === 'overview' ? styles.navActive : ''} onClick={() => setTab('overview')}><span aria-hidden="true">◷</span>{t('Today’s overview', '当日概览')}</button>}
          <button type="button" aria-pressed={tab === 'earnings'} className={tab === 'earnings' ? styles.navActive : ''} onClick={() => { setDate(malaysiaDateValue()); setTab('earnings'); }}><span aria-hidden="true">RM</span>{t('Today’s earnings', '今日收入')}</button>
          {user.role !== 'therapist' && <button type="button" aria-pressed={tab === 'bookings'} className={tab === 'bookings' ? styles.navActive : ''} onClick={() => setTab('bookings')}><span aria-hidden="true">▤</span>{t('Bookings', '预约管理')}<small>{bookings.length}</small></button>}
          {user.role !== 'therapist' && <button type="button" aria-pressed={tab === 'rooms'} className={tab === 'rooms' ? styles.navActive : ''} onClick={() => setTab('rooms')}><span aria-hidden="true">▦</span>{t('Rooms & occupancy', '房间与预约')}</button>}
          {user.role !== 'therapist' && <button type="button" aria-pressed={tab === 'team'} className={tab === 'team' ? styles.navActive : ''} onClick={() => setTab('team')}><span aria-hidden="true">♧</span>{t('Team & schedules', '员工与排班')}</button>}
        </nav><div className={styles.sidebarFooter}><span className={styles.avatar}>{user.name.slice(0, 1)}</span><strong>{user.name}</strong><small>{user.role === 'owner' ? t('Owner · Demo access', '店主 · 演示权限') : user.role === 'receptionist' ? t('Front desk · Bookings & today', '前台 · 预约与今日数据') : t('Therapist · Own work today', '按摩师 · 仅查看本人今日记录')}</small></div></aside>
        <section className={styles.content}>
          <div className={styles.pageHeading}><div><p className={styles.eyebrow}>{t('Serene Family Massage', 'Serene 家庭按摩')}</p><h1>{tab === 'earnings' ? t('Today’s earnings', '今日收入') : tab === 'rooms' ? t('Rooms & occupancy', '房间与预约') : tab === 'team' ? t('Your team', '员工团队') : tab === 'bookings' ? t('Bookings', '预约管理') : t('A clear view of the day', '当日安排，一目了然')}</h1><p>{dateLabel(tab === 'earnings' ? (earnings?.date ?? malaysiaDateValue()) : date, locale)} <span>· MYT (UTC+8)</span></p></div>{user.role !== 'therapist' && <button type="button" className={styles.primaryButton} onClick={() => open({ type: 'create' })}>+ {t('Add booking', '新增预约')}</button>}</div>
          {feedback}
          {tab !== 'earnings' && <div className={styles.toolbar}><label>{t('View date', '查看日期')}<input type="date" value={date} required onChange={(event) => { if (event.target.value) { setDate(event.target.value); setAsOf(''); } }} /></label><button type="button" className={styles.secondaryButton} onClick={() => { setDate(malaysiaDateValue()); setAsOf(''); }}>{t('Today', '今天')}</button>{user.role === 'owner' && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { if (window.confirm(t('Reset all local test bookings and restore the original sample data?', '要清除所有本地测试预约，并恢复原始示例数据吗？'))) void run(async () => { await resetDemoState(); await refresh(); }, t('Sample demo data restored.', '示例演示数据已恢复。')); }}>{t('Reset demo', '重置演示')}</button>}<div className={styles.sync}><span className={styles.syncDot} />{t('Refreshes every 15s', '每 15 秒更新')} {lastUpdated && <small>{lastUpdated}</small>}</div><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => run(refresh)}>{t('Refresh', '刷新')} ↻</button></div>}
          {tab === 'earnings' ? earnings ? <TodayEarnings summary={earnings} locale={locale} canOpenBookings={user.role !== 'therapist'} onOpenBooking={(id) => open({ type: 'booking', id })} /> : <p role="status">{t('Loading today’s earnings…', '正在加载今日收入…')}</p> : !state ? <p role="status">{t('Loading bookings…', '正在加载预约…')}</p> : tab === 'rooms' ? <><div className={styles.capacityBar}><div><strong>{t('View at', '查看时间')}</strong><input type="time" value={selectedTime} aria-label={t('Room snapshot time', '房间查看时间')} onChange={(event) => setAsOf(event.target.value)} /><button type="button" className={styles.textButton} onClick={() => { setDate(malaysiaDateValue()); setAsOf(''); setClockTime(currentShopTime()); }}>{t('Now', '现在')}</button></div></div><RoomBoard state={state} date={date} time={selectedTime} locale={locale} onOpenBooking={(id) => open({ type: 'booking', id })} /></> : tab === 'team' ? <>
            <div className={styles.sectionHeading}><div><h2>{t('People behind the care', '用心服务的团队')}</h2><p>{user.role === 'owner' ? t('Manage profiles, treatment skills, hours and leave.', '管理员工资料、疗程技能、上班时间及休假。') : t('View profiles and update working hours or leave.', '查看员工资料并更新上班时间或休假。')}</p></div><span className={styles.pill}>{state.therapists.filter((profile) => profile.active).length} {t('active therapists', '位在职按摩师')}</span></div>
            <div className={styles.teamGrid}>{state.therapists.map((profile) => <article key={profile.id} className={styles.teamCard}><div className={styles.teamTop}><Image src={profile.imageUrl} alt={`${profile.name[locale]} — ${t('sample portrait', '示例头像')}`} width={72} height={72} /><div><span className={styles.eyebrow}>{profile.staffNumber}</span><h3>{profile.name[locale]}</h3><span className={styles.small}>{profile.gender === 'female' ? t('Female', '女') : t('Male', '男')} · {profile.active ? t('Active', '在职') : t('Inactive', '停用')}</span></div><span className={`${styles.dot} ${profile.active ? styles.activeDot : ''}`} /></div><strong className={styles.specialties}>{profile.specialties[locale]}</strong><p>{profile.description[locale]}</p><div className={styles.skills}>{profile.categoryIds.map((id) => <span key={id}>{getCategory(id)?.name[locale] ?? id}</span>)}</div><div className={styles.teamShift}><span>{t('Hours', '工作时间')}</span><strong>{profile.shiftStart}–{profile.shiftEnd}</strong></div><div className={styles.teamShift}><span>{t('Selected date', '所选日期')}</span><strong>{profile.leaveDates.includes(date) ? t('On leave', '休假') : profile.active ? t('Scheduled', '已排班') : t('Inactive', '停用')}</strong></div><button type="button" className={styles.secondaryButton} onClick={() => open({ type: 'therapist', id: profile.id })}>{user.role === 'owner' ? t('Edit profile & schedule', '编辑资料与排班') : t('Edit schedule', '编辑排班')} →</button></article>)}</div>
          </> : <>
            {tab === 'overview' && <>
              <div className={styles.kpiGrid}>
                <div className={styles.kpi}><span>{t('Appointments', '预约数')}</span><strong>{activeBookings.length.toString().padStart(2, '0')}</strong><small>{t('Active + completed bookings', '有效及已完成预约')}</small></div>
                <div className={styles.kpi}><span>{t('Massage sessions', '按摩人次')}</span><strong>{activeBookings.reduce((sum, booking) => sum + booking.guests.length, 0).toString().padStart(2, '0')}</strong><small>{t('One session per guest', '每位顾客计一次')}</small></div>
                <div className={styles.kpi}><span>{t('In treatment', '服务中')}</span><strong>{bookings.filter((booking) => booking.status === 'in_service').length.toString().padStart(2, '0')}</strong><small>{t('Appointments currently in progress', '目前正在进行的预约')}</small></div>
                <div className={styles.kpi}><span>{t('Scheduled value', '已安排金额')}</span><strong><small>RM</small> {activeBookings.filter((booking) => booking.status !== 'pending').reduce((sum, booking) => sum + booking.total, 0)}</strong><small>{t('Planned services · not earned income', '已安排疗程 · 并非实际收入')}</small></div>
              </div>
              <div className={styles.capacityBar}><div><strong>{t('Capacity at', '此时接待能力')}</strong><input type="time" value={selectedTime} aria-label={t('Capacity snapshot time', '接待能力查看时间')} onChange={(event) => setAsOf(event.target.value)} /><button type="button" className={styles.textButton} onClick={() => { setAsOf(''); setClockTime(currentShopTime()); }}>{date === malaysiaDateValue() ? t('Now', '现在') : t('Reset', '重置')}</button></div><span><b>{workingTherapists.length}</b> {t('on duty', '上班')}</span><span><b>{busyIds.size}</b> {t('busy / cleaning', '服务／清洁')}</span><span className={styles.freeCount}><b>{workingTherapists.filter((profile) => !busyIds.has(profile.id)).length}</b> {t('free', '空闲')}</span><span><b>{[...resources].filter((id) => id.startsWith('bed-')).length}/{bookingSettings.massageBeds}</b> {t('beds occupied', '张床使用中')}</span><span><b>{[...resources].filter((id) => id.startsWith('chair-')).length}/{bookingSettings.footMassageChairs}</b> {t('chairs occupied', '张足椅使用中')}</span></div>
              <div className={styles.teamStatusGrid} aria-label={t('Therapist status and massage counts', '按摩师状态及按摩人次')}>
                {state.therapists.map((therapist) => {
                  const onLeave = therapist.leaveDates.includes(date);
                  const onDuty = workingTherapists.some((entry) => entry.id === therapist.id);
                  const isBusy = busyIds.has(therapist.id);
                  const sessions = activeBookings.flatMap((booking) => booking.assignments).filter((assignment) => assignment.therapistId === therapist.id).length;
                  return <article key={therapist.id}><Image src={therapist.imageUrl} alt="" width={38} height={38} /><div><strong>{therapist.staffNumber} · {therapist.name[locale]}</strong><span>{onLeave ? t('On leave', '休假') : !onDuty ? t('Off duty', '未上班') : isBusy ? t('Busy / cleaning', '服务／清洁中') : t('Available', '空闲')}</span></div><b className={isBusy ? styles.busyState : onDuty ? styles.availableState : ''}>{sessions} {t('session(s)', '人次')}</b></article>;
                })}
              </div>
              <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>{t('Therapist timeline', '按摩师时间表')}</h2><p>{t('Tap a treatment to view or manage the booking.', '点击疗程，查看或管理预约。')}</p></div><div className={styles.legend}><span><i />{t('Treatment', '疗程')}</span><span><i className={styles.cleanupLegend} />{t('5 min clean', '清洁 5 分钟')}</span>{bookings.some((booking) => booking.status === 'pending') && <span><i className={styles.pendingLegend} />{t('Legacy pending hold', '旧版待确认预约')}</span>}</div></div>
                <div className={styles.timelineScroll}><div className={styles.timeline}><div className={styles.timelineHeader}><span>{t('Therapist', '按摩师')}</span><div>{Array.from({ length: 13 }, (_, index) => <span key={index} style={{ left: `${index / 13 * 100}%` }}>{index + 11}:00</span>)}</div></div>{state.therapists.map((therapist) => <div key={therapist.id} className={styles.timelineRow}><div className={styles.laneName}><Image src={therapist.imageUrl} alt="" width={34} height={34} /><span><strong>{therapist.name[locale]}</strong><small>{therapist.staffNumber}{therapist.leaveDates.includes(date) ? ` · ${t('Leave', '休假')}` : !therapist.active ? ` · ${t('Inactive', '停用')}` : ''}</small></span></div><div className={`${styles.lane} ${(!therapist.active || therapist.leaveDates.includes(date)) ? styles.offLane : ''}`}>
                  {!therapist.leaveDates.includes(date) && therapist.active && <div className={styles.shiftBand} style={{ left: `${Math.max(0, minuteValue(therapist.shiftStart) - 660) / 780 * 100}%`, width: `${Math.max(0, Math.min(1440, minuteValue(therapist.shiftEnd)) - Math.max(660, minuteValue(therapist.shiftStart))) / 780 * 100}%` }} />}
                  {bookings.filter((booking) => blocking.has(booking.status) || booking.status === 'completed').flatMap((booking) => booking.assignments.filter((assignment) => assignment.therapistId === therapist.id).map((assignment) => {
                    const guest = booking.guests.find((entry) => entry.id === assignment.guestId);
                    return <div key={`${booking.id}-${assignment.guestId}`}><button type="button" className={`${styles.treatmentBlock} ${booking.status === 'pending' ? styles.pendingBlock : ''} ${booking.status === 'completed' ? styles.completedBlock : ''}`} style={{ left: `${(minuteValue(assignment.start) - 660) / 780 * 100}%`, width: `${(minuteValue(assignment.end) - minuteValue(assignment.start)) / 780 * 100}%` }} onClick={() => open({ type: 'booking', id: booking.id })} title={`${assignment.start}–${assignment.end} · ${booking.contactName} · ${guest ? getCategory(guest.categoryId)?.name[locale] : ''} · ${t(...statusLabels[booking.status])}`}><b>{assignment.start} · {guest?.name || booking.contactName}</b><span>{guest ? getCategory(guest.categoryId)?.name[locale] : ''}</span></button><div className={styles.cleanupBlock} title={`${t('Cleaning', '清洁')} ${assignment.end}–${assignment.cleanupEnd}`} style={{ left: `${(minuteValue(assignment.end) - 660) / 780 * 100}%`, width: `${(minuteValue(assignment.cleanupEnd) - minuteValue(assignment.end)) / 780 * 100}%` }} /></div>;
                  }))}
                  {selectedTime >= '11:00' && selectedTime <= '23:59' && <div className={styles.timeLine} style={{ left: `${(minuteValue(selectedTime) - 660) / 780 * 100}%` }} />}
                </div></div>)}</div></div>
              </section>
            </>}
            <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>{t('Appointment book', '预约记录')}</h2><p>{t('All booking channels, together.', '统一查看所有渠道的预约。')}</p></div><span className={styles.pill}>{visibleBookings.length} {t('bookings', '笔预约')}</span></div><div className={styles.filters}><label>{t('Search', '搜索')}<input type="search" placeholder={t('Name, phone or reference', '姓名、电话或预约编号')} value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>{t('Status', '状态')}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{t('All statuses', '全部状态')}</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{t(...label)}</option>)}</select></label><label>{t('Source', '来源')}<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">{t('All sources', '全部来源')}</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{t(...label)}</option>)}</select></label></div>
              {!visibleBookings.length ? <div className={styles.empty}><span>◷</span><h3>{t('No bookings to show', '暂无预约')}</h3><p>{t('Choose another date, adjust the filters, or add a booking.', '请选择其他日期、调整筛选条件，或新增预约。')}</p></div> : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>{t('Time', '时间')}</th><th>{t('Customer', '顾客')}</th><th>{t('Treatment / team', '疗程／员工')}</th><th>{t('Source', '来源')}</th><th>{t('Status', '状态')}</th><th>{t('Total', '总计')}</th><th><span className={styles.srOnly}>{t('Manage', '管理')}</span></th></tr></thead><tbody>{visibleBookings.map((booking) => <tr key={booking.id} className={booking.status === 'pending' ? styles.pendingRow : ''}><td><strong>{booking.time}</strong><small>{booking.guests.length} {t('guest(s)', '位顾客')}</small></td><td><strong>{booking.contactName}</strong><small>{booking.reference}</small></td><td><span>{booking.guests.map((guest) => getCategory(guest.categoryId)?.name[locale]).join(' · ')}</span><small>{booking.assignments.map((assignment) => state.therapists.find((profile) => profile.id === assignment.therapistId)?.staffNumber).join(' · ')}</small></td><td>{t(...sourceLabels[booking.source])}</td><td><Status status={booking.status} t={t} /></td><td><strong className={styles.noWrap}>{formatRinggit(booking.total)}</strong></td><td><button type="button" className={styles.secondaryButton} aria-label={`${t('Manage booking', '管理预约')} ${booking.reference}`} onClick={() => open({ type: 'booking', id: booking.id })}>{t('View', '查看')} →</button></td></tr>)}</tbody></table></div>}
            </section>
          </>}
          <footer className={styles.footer}>{t('Sample data · Local demo', '示例数据 · 本地演示')}<span>{t('Daily hours 11:00–23:59 · Cleaning buffer 5 min', '每天营业 11:00–23:59 · 清洁间隔 5 分钟')}</span></footer>
        </section>
      </div>}
    {modal?.type === 'create' && state && <Dialog title={t('Add a booking', '新增预约')} close={() => { if (!busy) setModal(null); }}><CreateBooking date={date} therapists={state.therapists} locale={locale} busy={busy} feedback={feedback} onSubmit={(draft) => run(async () => { const result = await reserveStaffDemoBooking(draft); if (!result.ok) throw new Error(`${t('That time cannot fit this booking. Choose another time.', '此时段无法安排此预约，请重新选择。')}${result.alternatives.length ? ` ${t('Try', '可选择')}: ${result.alternatives.join(', ')}` : ''}`); await refresh(); setDate(result.booking.date); setModal({ type: 'booking', id: result.booking.id }); setNotice(t('Booking added. Availability is updated.', '预约已添加，可预约时段已更新。')); })} /></Dialog>}
    {chosenBooking && state && <Dialog title={chosenBooking.reference} close={() => { if (!busy) setModal(null); }}><BookingDetail key={chosenBooking.id} booking={chosenBooking} therapists={state.therapists} locale={locale} busy={busy} feedback={feedback} onStatus={(status) => run(async () => { await updateDemoBookingStatus(chosenBooking.id, status); await refresh(); }, t('Booking updated.', '预约已更新。'))} onReschedule={(nextDate, time, timing) => run(async () => { handleReservation(await rescheduleDemoBooking(chosenBooking.id, nextDate, time, timing), t); await refresh(); setDate(nextDate); }, t('Booking rescheduled.', '预约时间已更改。'))} onReassign={(guestId, therapistId) => run(async () => { handleReservation(await reassignDemoBooking(chosenBooking.id, guestId, therapistId), t); await refresh(); }, t('Therapist assignment updated.', '按摩师安排已更新。'))} onAddOns={async (guestId, addOnIds, source) => {
      let saved = false;
      await run(async () => {
        handleReservation(await addDemoBookingAddOns(chosenBooking.id, guestId, addOnIds, source), t);
        saved = true;
        await refresh();
      }, t('Extras saved. The booking total and schedule are updated.', '附加项目已保存，预约金额和时间表已更新。'));
      return saved;
    }} /></Dialog>}
    {chosenTherapist && user && <Dialog title={user.role === 'owner' ? t('Therapist profile & schedule', '按摩师资料与排班') : t('Therapist schedule', '按摩师排班')} close={() => { if (!busy) setModal(null); }}><ProfileForm key={chosenTherapist.id} therapist={chosenTherapist} owner={user.role === 'owner'} locale={locale} busy={busy} feedback={feedback} onSubmit={(profile) => run(async () => { await updateDemoTherapist(profile); await refresh(); setModal(null); }, t('Therapist saved. Availability is updated.', '员工资料已保存，可预约时段已更新。'))} /></Dialog>}
  </main>;
}

function handleReservation(result: DemoReservationResult, t: Translate) {
  if (!result.ok) throw new Error(`${t('No compatible therapist or resource is available for that change. The booking was not changed.', '此更改没有适合的按摩师或设施，预约未作更改。')}${result.alternatives.length ? ` ${t('Nearby times', '附近可选时段')}: ${result.alternatives.join(', ')}` : ''}`);
}

function CreateBooking({ date, therapists, locale, busy, feedback, onSubmit }: { date: string; therapists: TherapistProfile[]; locale: Locale; busy: boolean; feedback: ReactNode; onSubmit: (draft: DemoReservationInput) => Promise<void> }) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const [draft, setDraft] = useState<DemoReservationInput>(() => ({ date, time: '14:00', source: 'phone', groupTiming: 'together', contactName: '', contactPhone: '', notes: '', guests: [newGuest()] }));
  const [localError, setLocalError] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());
  const updateGuest = (index: number, change: Partial<GuestSelection>) => setDraft((previous) => ({
    ...previous,
    guests: previous.guests.map((guest, i) => {
      if (i !== index) return guest;
      const next = { ...guest, ...change };
      if (!('therapistChoice' in change) && next.therapistChoice?.mode === 'specific') {
        const profile = therapists.find((entry) => entry.id === next.therapistChoice?.therapistId);
        if (!profile || !isTherapistCompatible(profile, next)) next.therapistChoice = { ...next.therapistChoice, therapistId: '' };
      }
      return next;
    }),
  }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setLocalError('');
    if (draft.contactName.trim().length < 2) { setLocalError(t('Enter a contact name of at least two characters.', '联系人姓名至少需要两个字符。')); return; }
    if (draft.guests.some((guest) => guest.therapistChoice?.mode === 'specific' && !guest.therapistChoice.therapistId)) { setLocalError(t('Select a therapist for every specific-therapist request.', '请为每位指定按摩师的顾客选择按摩师。')); return; }
    await onSubmit({ ...draft, idempotencyKey: idempotencyKey.current });
  }
  return <form className={styles.form} onSubmit={submit}>{feedback}{localError && <p className={styles.error} role="alert">{localError}</p>}<p className={styles.hint}>{t('Add phone, WhatsApp or walk-in appointments here so they also reserve online capacity.', '在此添加电话、WhatsApp 或到店预约，系统会同步保留可预约名额。')}</p>
    <div className={styles.formGrid}><label>{t('Booking source', '预约来源')}<select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as DemoBookingSource })}>{(['phone', 'whatsapp', 'walk_in'] as const).map((source) => <option value={source} key={source}>{t(...sourceLabels[source])}</option>)}</select></label><label>{t('Group timing', '同行时间')}<select value={draft.groupTiming} onChange={(event) => setDraft({ ...draft, groupTiming: event.target.value as 'together' | 'flexible' })}><option value="together">{t('Start together', '同时开始')}</option><option value="flexible">{t('Flexible · up to 30 min apart', '可分批 · 相差最多 30 分钟')}</option></select></label><label>{t('Date', '日期')}<input type="date" required min={malaysiaDateValue()} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><label>{t('Start time · MYT', '开始时间 · 马来西亚时间')}<select required value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></label><label>{t('Contact name', '联系人姓名')}<input required minLength={2} maxLength={100} autoComplete="name" value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} /></label><label>{t('Contact phone', '联系电话')}<input required type="tel" maxLength={24} placeholder="+60… / +65…" autoComplete="tel" value={draft.contactPhone} onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })} /><small>{t('Include country code for WhatsApp replies.', '请包含国际区号，以便回复 WhatsApp。')}</small></label></div>
    {draft.guests.map((guest, index) => {
      const category = getCategory(guest.categoryId)!;
      const choice = guest.therapistChoice ?? emptyTherapistChoice();
      return <fieldset key={guest.id} className={styles.guestFieldset}><legend>{t('Guest', '顾客')} {index + 1}</legend><div className={styles.guestTop}><strong>{formatRinggit(guestTotal(guest))} · {estimatedGuestDuration(guest)} {t('min + 5 min clean', '分钟 + 清洁 5 分钟')}</strong>{draft.guests.length > 1 && <button type="button" className={styles.textButton} onClick={() => setDraft({ ...draft, guests: draft.guests.filter((entry) => entry.id !== guest.id) })}>{t('Remove guest', '移除此顾客')}</button>}</div><div className={styles.formGrid}><label>{t('Guest name (optional)', '顾客姓名（可选）')}<input maxLength={100} value={guest.name} onChange={(event) => updateGuest(index, { name: event.target.value })} /></label><label>{t('Treatment category', '疗程类别')}<select value={guest.categoryId} onChange={(event) => { const next = getCategory(event.target.value)!; updateGuest(index, { categoryId: next.id, itemId: next.treatments[0].id, addOnIds: [], therapistChoice: emptyTherapistChoice() }); }}>{catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name[locale]}</option>)}</select></label><label className={styles.fullWidth}>{t('Service or package', '疗程或配套')}<select value={guest.itemId} onChange={(event) => updateGuest(index, { itemId: event.target.value, addOnIds: guest.addOnIds.filter((id) => id !== includedAddOn[event.target.value]), therapistChoice: emptyTherapistChoice() })}>{category.treatments.concat(category.packages).map((item) => <option key={item.id} value={item.id}>{item.name[locale]} — {formatRinggit(item.price)}</option>)}</select></label></div>
        <div className={styles.checkGrid}>{category.addOns.map((addon) => <label className={styles.checkLabel} key={addon.id}><input type="checkbox" disabled={includedAddOn[guest.itemId] === addon.id} checked={guest.addOnIds.includes(addon.id) || includedAddOn[guest.itemId] === addon.id} onChange={(event) => updateGuest(index, { addOnIds: event.target.checked ? [...guest.addOnIds, addon.id] : guest.addOnIds.filter((id) => id !== addon.id) })} /><span>{addon.name[locale]} <small>{includedAddOn[guest.itemId] === addon.id ? t('Included', '已包含') : `+ ${formatRinggit(addon.price)}`}</small></span></label>)}</div>
        <div className={styles.formGrid}><label>{t('Therapist preference', '按摩师偏好')}<select value={choice.mode === 'gender' ? choice.gender : choice.mode} onChange={(event) => { const mode = event.target.value; updateGuest(index, { therapistChoice: mode === 'none' ? emptyTherapistChoice() : { mode: mode === 'specific' ? 'specific' : 'gender', gender: mode === 'female' || mode === 'male' ? mode : '', therapistId: '', requirement: choice.requirement } }); }}><option value="none">{t('No preference', '无偏好')}</option><option value="specific">{t('Specific therapist', '指定按摩师')}</option><option value="female">{t('Female therapist', '女按摩师')}</option><option value="male">{t('Male therapist', '男按摩师')}</option></select></label>{choice.mode !== 'none' && <label>{t('Preference strength', '偏好要求')}<select value={choice.requirement} onChange={(event) => updateGuest(index, { therapistChoice: { ...choice, requirement: event.target.value as 'preferred' | 'required' } })}><option value="preferred">{t('Preferred · another therapist is okay', '尽量安排 · 可接受其他按摩师')}</option><option value="required">{t('Required · must match', '必须安排 · 不接受更换')}</option></select></label>}{choice.mode === 'specific' && <label className={styles.fullWidth}>{t('Choose therapist', '选择按摩师')}<select required value={choice.therapistId} onChange={(event) => updateGuest(index, { therapistChoice: { ...choice, therapistId: event.target.value } })}><option value="">{t('Select a therapist', '请选择按摩师')}</option>{therapists.filter((profile) => profile.active).map((profile) => <option key={profile.id} value={profile.id} disabled={!isTherapistCompatible(profile, guest)}>{profile.staffNumber} · {profile.name[locale]}{isTherapistCompatible(profile, guest) ? '' : ` — ${t('Not compatible', '不适用此疗程')}`}</option>)}</select></label>}</div>
      </fieldset>;
    })}
    {draft.guests.length < 6 && <button type="button" className={styles.secondaryButton} onClick={() => setDraft({ ...draft, guests: [...draft.guests, newGuest()] })}>+ {t('Add another guest', '添加同行顾客')}</button>}
    <label>{t('Booking notes (optional)', '预约备注（可选）')}<textarea maxLength={1000} rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label><div className={styles.formFooter}><strong>{t('Total', '总计')}: {formatRinggit(orderTotal(draft.guests))}</strong><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? t('Checking capacity…', '正在检查接待能力…') : t('Save demo booking', '保存演示预约')}</button></div>
  </form>;
}

type SaveGuestAddOns = (guestId: string, addOnIds: string[], source: 'counter' | 'during_service') => Promise<boolean>;

function GuestExtrasForm({ guest, booking, therapist, locale, busy, onSave }: { guest: GuestSelection; booking: DemoBooking; therapist: TherapistProfile | undefined; locale: Locale; busy: boolean; onSave: SaveGuestAddOns }) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState<'counter' | 'during_service'>(booking.status === 'in_service' ? 'during_service' : 'counter');
  const [saveError, setSaveError] = useState('');
  const category = getCategory(guest.categoryId);
  const options = (category?.addOns ?? []).filter((addon) => !guest.addOnIds.includes(addon.id) && includedAddOn[guest.itemId] !== addon.id);
  const compatible = (id: string) => Boolean(therapist && isTherapistCompatible(therapist, { ...guest, addOnIds: [...guest.addOnIds, id] }));
  const additions = options.filter((addon) => selected.includes(addon.id) && compatible(addon.id));
  const extraPrice = additions.reduce((sum, addon) => sum + addon.price, 0);
  const extraMinutes = additions.reduce((sum, addon) => sum + (addOnMinutes[addon.id] ?? 0), 0);
  const currentTotal = booking.priceSnapshots?.find((entry) => entry.guestId === guest.id)?.total ?? guestTotal(guest);
  const formId = `extras-${guest.id}`;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!additions.length || busy) return;
    setSaveError('');
    if (await onSave(guest.id, additions.map((addon) => addon.id), source)) {
      setSelected([]); setExpanded(false);
    } else {
      setSaveError(t('Extras were not saved. Your selections are kept; review the booking message above.', '附加项目未保存。已保留您的选择，请查看上方预约提示。'));
    }
  }
  return <div className={styles.extrasEditor}>
    <button type="button" className={styles.secondaryButton} aria-expanded={expanded} aria-controls={formId} disabled={busy} onClick={() => { setExpanded(!expanded); setSaveError(''); if (!expanded) setSource(booking.status === 'in_service' ? 'during_service' : 'counter'); }}>{expanded ? t('Close extras', '收起附加项目') : t('+ Add extras', '+ 添加附加项目')}</button>
    {expanded && <form id={formId} className={styles.extrasForm} onSubmit={submit}>
      <fieldset disabled={busy} className={styles.extrasFieldset}>
        <legend>{t('Extras for this guest', '此顾客的附加项目')}</legend>
        <p className={styles.extrasHint}>{t('Record items bought at the counter or during treatment. Saving also checks that any extra treatment time fits.', '记录顾客在柜台或疗程中加购的项目。保存时会同时检查是否能安排所需的额外时间。')}</p>
        {!options.length ? <p className={styles.extrasHint}>{t('All extras for this treatment are already included.', '此疗程的所有附加项目已包含在预约内。')}</p> : <div className={styles.extrasOptions}>{options.map((addon) => {
          const allowed = compatible(addon.id);
          const minutes = addOnMinutes[addon.id] ?? 0;
          return <label key={addon.id} className={`${styles.extrasOption} ${!allowed ? styles.extrasUnavailable : ''}`}>
            <input type="checkbox" checked={selected.includes(addon.id)} disabled={!allowed} onChange={(event) => { setSaveError(''); setSelected(event.target.checked ? [...selected, addon.id] : selected.filter((id) => id !== addon.id)); }} />
            <span><strong>{addon.name[locale]}</strong><small>{minutes ? `+ ${minutes} ${t('min', '分钟')}` : t('No extra time', '不增加时间')}{!allowed && ` · ${t('Unavailable with assigned therapist', '当前按摩师无法提供')}`}</small></span>
            <b>+ {formatRinggit(addon.price)}</b>
          </label>;
        })}</div>}
        {options.length > 0 && <>
          <label>{t('Added where?', '加购地点')}<select value={source} onChange={(event) => setSource(event.target.value as 'counter' | 'during_service')}><option value="counter">{t('At the counter', '柜台加购')}</option><option value="during_service">{t('During treatment', '疗程中加购')}</option></select></label>
          <div className={styles.extrasTotals} aria-live="polite"><div><span>{t('Extra amount', '加购金额')}</span><strong>+ {formatRinggit(extraPrice)}</strong></div><div><span>{t('Extra treatment time', '额外疗程时间')}</span><strong>+ {extraMinutes} {t('min', '分钟')}</strong></div><div className={styles.extrasUpdatedTotal}><span>{t('Updated guest total', '更新后此顾客总额')}</span><strong>{formatRinggit(currentTotal + extraPrice)}</strong></div></div>
          <button type="submit" className={styles.primaryButton} disabled={!additions.length || busy}>{busy ? t('Checking & saving…', '正在检查并保存…') : t('Save extras', '保存附加项目')}</button>
        </>}
      </fieldset>
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
    </form>}
  </div>;
}

function BookingDetail({ booking, therapists, locale, busy, feedback, onStatus, onReschedule, onReassign, onAddOns }: { booking: DemoBooking; therapists: TherapistProfile[]; locale: Locale; busy: boolean; feedback: ReactNode; onStatus: (status: DemoBookingStatus) => Promise<void>; onReschedule: (date: string, time: string, timing: 'together' | 'flexible') => Promise<void>; onReassign: (guestId: string, therapistId: string) => Promise<void>; onAddOns: SaveGuestAddOns }) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(booking.time);
  const [timing, setTiming] = useState(booking.groupTiming);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<DemoBookingStatus | null>(null);
  const [kind, setKind] = useState<'status' | 'reminder' | 'alternative'>('status');
  const [copyStatus, setCopyStatus] = useState('');
  const effectiveKind = kind === 'reminder' && booking.status !== 'confirmed' ? 'status' : kind;
  const message = bookingMessage(booking, therapists, locale, effectiveKind, date, time);
  const internationalPhone = booking.contactPhone.replace(/[\s()-]/g, '');
  const validPhone = /^\+[1-9][0-9]{7,14}$/.test(internationalPhone);
  const phone = validPhone ? internationalPhone.slice(1) : '';
  const actionable = !terminal.has(booking.status);
  return <div className={styles.detail}>{feedback}<div className={styles.detailTop}><div><h3>{booking.contactName}</h3><a href={`tel:${booking.contactPhone}`}>{booking.contactPhone}</a></div><Status status={booking.status} t={t} /></div><div className={styles.detailFacts}><div><span>{t('Appointment', '预约时间')}</span><strong>{booking.date} · {booking.time}</strong></div><div><span>{t('Source', '来源')}</span><strong>{t(...sourceLabels[booking.source])}</strong></div><div><span>{t('Group timing', '同行时间')}</span><strong>{booking.groupTiming === 'flexible' ? t('Flexible starts', '可分批开始') : t('Start together', '同时开始')}</strong></div><div><span>{t('Total', '总计')}</span><strong>{formatRinggit(booking.total)}</strong></div></div>
    {booking.status === 'pending' && booking.holdExpiresAt && <p className={styles.holdNotice}>{t('Capacity held until', '名额保留至')} {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(booking.holdExpiresAt))} MYT. {t('Confirm before it expires.', '请在过期前确认。')}</p>}
    {booking.guests.map((guest, index) => {
      const assignment = booking.assignments.find((entry) => entry.guestId === guest.id);
      const therapist = therapists.find((entry) => entry.id === assignment?.therapistId);
      const category = getCategory(guest.categoryId);
      const priceSnapshot = booking.priceSnapshots?.find((entry) => entry.guestId === guest.id);
      const therapistSnapshot = booking.therapistSnapshots?.find((entry) => entry.guestId === guest.id);
      const displayedAddOns = priceSnapshot?.addOns ?? guest.addOnIds.map((id) => category?.addOns.find((entry) => entry.id === id)).filter((entry) => entry !== undefined);
      const usedFallback = Boolean(therapist && guest.therapistChoice?.mode !== 'none' && guest.therapistChoice?.requirement === 'preferred' && !therapistMatchesPreference(therapist, guest.therapistChoice));
      return <section className={styles.detailGuest} key={guest.id}>
        <div className={styles.guestTop}><h3>{t('Guest', '顾客')} {index + 1}{guest.name && ` · ${guest.name}`}</h3><strong>{formatRinggit(priceSnapshot?.total ?? guestTotal(guest))}</strong></div>
        <p><strong>{priceSnapshot?.category[locale] ?? category?.name[locale]}</strong><br />{priceSnapshot?.item[locale] ?? getMenuItem(guest.categoryId, guest.itemId)?.name[locale]}</p>
        {displayedAddOns.length > 0 && <ul className={styles.addonList}>{displayedAddOns.map((addon) => {
          const sale = booking.addOnSales?.find((entry) => entry.guestId === guest.id && entry.addOnId === addon.id);
          return <li key={addon.id}><div>{addon.name[locale]}<small className={styles.extraSource}>{sale ? <>{extraSourceLabel(sale.source, t)} · <time dateTime={sale.addedAt}>{new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sale.addedAt))}</time> MYT{sale.addedMinutes > 0 && ` · +${sale.addedMinutes} ${t('min', '分钟')}`}</> : t('Selected at booking', '预约时已选择')}</small></div><span>+ {formatRinggit(addon.price)}</span></li>;
        })}</ul>}
        <p className={styles.preference}><span>{t('Customer preference', '顾客偏好')}</span>{therapistChoiceLabel(guest.therapistChoice, locale, therapists)}{usedFallback && <small>{t(' · Alternative qualified therapist assigned', ' · 已安排其他合资格按摩师')}</small>}</p>
        {assignment && <div className={styles.assignment}><span><b>{t('Assigned', '已安排')}</b>{therapistSnapshot?.staffNumber ?? therapist?.staffNumber} · {therapistSnapshot?.name[locale] ?? therapist?.name[locale]}</span><span><b>{t('Treatment', '疗程时间')}</b>{assignment.start}–{assignment.end}</span><span><b>{t('Cleaning until', '清洁结束')}</b>{assignment.cleanupEnd}</span><span><b>{t('Resources', '设施')}</b>{assignment.resourceIds.map((id) => resourceLabel(id, t)).join(', ')}</span></div>}
        {(['confirmed', 'checked_in', 'in_service'] as DemoBookingStatus[]).includes(booking.status) && <GuestExtrasForm guest={guest} booking={booking} therapist={therapist} locale={locale} busy={busy} onSave={onAddOns} />}
        {actionable && booking.status !== 'in_service' && <form className={styles.inlineForm} onSubmit={(event) => { event.preventDefault(); void onReassign(guest.id, assigned[guest.id] ?? assignment?.therapistId ?? ''); }}><label>{t('Assign / reassign therapist', '安排／更换按摩师')}<select value={assigned[guest.id] ?? assignment?.therapistId ?? ''} onChange={(event) => setAssigned({ ...assigned, [guest.id]: event.target.value })} required><option value="">{t('Select therapist', '选择按摩师')}</option>{therapists.filter((profile) => profile.active).map((profile) => <option key={profile.id} value={profile.id} disabled={!isTherapistCompatible(profile, guest)}>{profile.staffNumber} · {profile.name[locale]}{!isTherapistCompatible(profile, guest) ? ` (${t('Not compatible', '不适用')})` : ''}</option>)}</select></label><button className={styles.secondaryButton} disabled={busy || (assigned[guest.id] ?? assignment?.therapistId) === assignment?.therapistId}>{t('Assign', '安排')}</button></form>}
      </section>;
    })}
    {booking.notes && <div className={styles.notes}><strong>{t('Booking notes', '预约备注')}</strong><p>{booking.notes}</p></div>}
    {actionable && <section className={styles.actions}><h3>{t('Update booking', '更新预约')}</h3><div className={styles.buttonRow}>{(statusActions[booking.status] ?? []).map((status) => <button type="button" key={status} disabled={busy} className={status === 'cancelled' || status === 'no_show' ? styles.dangerButton : styles.primaryButton} onClick={() => { if (status === 'cancelled' || status === 'no_show') setConfirmation(status); else void onStatus(status); }}>{t(...actionLabels[status]!)}</button>)}</div>{confirmation && <div className={styles.confirmation} role="alert"><p>{confirmation === 'cancelled' ? t('Cancel this appointment and release its capacity?', '取消此预约并释放名额？') : t('Mark this customer as a no-show and release the reservation?', '将顾客标记为未到店并释放名额？')}</p><div className={styles.buttonRow}><button type="button" className={styles.dangerButton} disabled={busy} onClick={async () => { await onStatus(confirmation); setConfirmation(null); }}>{t('Yes, update booking', '确认更新')}</button><button type="button" className={styles.secondaryButton} onClick={() => setConfirmation(null)}>{t('Keep booking', '保留预约')}</button></div></div>}</section>}
    {actionable && booking.status !== 'in_service' && <details className={styles.disclosure}><summary>{t('Reschedule appointment', '更改预约时间')}</summary><form className={styles.form} onSubmit={(event) => { event.preventDefault(); void onReschedule(date, time, timing); }}><p className={styles.hint}>{t('The existing reservation stays in place if the new time is unavailable. Required therapist preferences are preserved.', '如新时间无法安排，将保留原预约。必须安排的按摩师偏好保持不变。')}</p><div className={styles.formGrid}><label>{t('New date', '新日期')}<input required type="date" min={malaysiaDateValue()} value={date} onChange={(event) => setDate(event.target.value)} /></label><label>{t('New time', '新时间')}<select required value={time} onChange={(event) => setTime(event.target.value)}>{timeOptions.map((value) => <option key={value}>{value}</option>)}</select></label><label className={styles.fullWidth}>{t('Group timing', '同行时间')}<select value={timing} onChange={(event) => setTiming(event.target.value as 'together' | 'flexible')}><option value="together">{t('Start together', '同时开始')}</option><option value="flexible">{t('Flexible · up to 30 minutes apart', '分批开始 · 相差最多 30 分钟')}</option></select></label></div><button className={styles.secondaryButton} disabled={busy}>{t('Check capacity & save new time', '检查名额并保存新时间')}</button></form></details>}
    <details className={styles.disclosure}><summary>{t('Prepare WhatsApp reply', '准备 WhatsApp 回复')}</summary><div className={styles.form}><label>{t('Message type', '消息类型')}<select value={effectiveKind} onChange={(event) => { setKind(event.target.value as 'status' | 'reminder' | 'alternative'); setCopyStatus(''); }}><option value="status">{t('Current booking status', '当前预约状态')}</option>{booking.status === 'confirmed' && <option value="reminder">{t('Appointment reminder', '预约提醒')}</option>}<option value="alternative">{t('Suggest an alternative time', '建议其他时间')}</option></select></label>{effectiveKind === 'alternative' && <><div className={styles.formGrid}><label>{t('Proposed date', '建议日期')}<input required type="date" min={malaysiaDateValue()} value={date} onChange={(event) => setDate(event.target.value)} /></label><label>{t('Proposed time', '建议时间')}<select value={time} onChange={(event) => setTime(event.target.value)}>{timeOptions.map((value) => <option key={value}>{value}</option>)}</select></label></div><p className={styles.hint}>{t('A message proposes a time only. Save a reschedule after the customer agrees.', '消息仅用于建议时间。顾客同意后，请另行保存更改的预约时间。')}</p></>}<label>{t('Message preview', '消息预览')}<textarea className={styles.message} readOnly rows={12} value={message} /></label><div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={async () => { try { await navigator.clipboard.writeText(message); setCopyStatus(t('Copied.', '已复制。')); } catch { setCopyStatus(t('Copy is unavailable. Select and copy the message above.', '无法自动复制，请选择上方消息手动复制。')); } }}>{t('Copy message', '复制消息')}</button>{validPhone ? <a className={styles.primaryButton} href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">{t('Open WhatsApp', '打开 WhatsApp')} ↗</a> : <span className={styles.hint}>{t('Use a number with its +country code to open WhatsApp, or copy the message.', '请输入带有 +国际区号的号码以打开 WhatsApp，或复制消息。')}</span>}</div><p className={styles.hint}>{t('Opening WhatsApp prepares the message. You still choose whether to send it.', '打开 WhatsApp 后会填入消息，仍由您决定是否发送。')}</p>{copyStatus && <p role="status">{copyStatus}</p>}</div></details>
  </div>;
}

function ProfileForm({ therapist, owner, locale, busy, feedback, onSubmit }: { therapist: TherapistProfile; owner: boolean; locale: Locale; busy: boolean; feedback: ReactNode; onSubmit: (profile: TherapistProfile) => Promise<void> }) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const [profile, setProfile] = useState(() => structuredClone(therapist));
  const [leaveDate, setLeaveDate] = useState('');
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void onSubmit(profile); }}>{feedback}<div className={styles.profileIntro}><Image src={profile.imageUrl} alt={t('Sample portrait', '示例头像')} width={90} height={90} /><div><h3>{profile.staffNumber} · {profile.name[locale]}</h3><p>{t('Sample therapist profile', '示例按摩师资料')}</p></div></div>
    {owner && <><fieldset className={styles.guestFieldset}><legend>{t('Public profile', '公开资料')}</legend><div className={styles.formGrid}><label>{t('Staff number', '员工编号')}<input required maxLength={20} value={profile.staffNumber} onChange={(event) => setProfile({ ...profile, staffNumber: event.target.value })} /></label><label>{t('Gender', '性别')}<select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as 'female' | 'male' })}><option value="female">{t('Female', '女')}</option><option value="male">{t('Male', '男')}</option></select></label><label>{t('Name · English', '姓名 · 英文')}<input required maxLength={80} value={profile.name.en} onChange={(event) => setProfile({ ...profile, name: { ...profile.name, en: event.target.value } })} /></label><label>{t('Name · Chinese', '姓名 · 中文')}<input required maxLength={80} value={profile.name.zh} onChange={(event) => setProfile({ ...profile, name: { ...profile.name, zh: event.target.value } })} /></label><label>{t('Specialties · English', '专长 · 英文')}<input required maxLength={200} value={profile.specialties.en} onChange={(event) => setProfile({ ...profile, specialties: { ...profile.specialties, en: event.target.value } })} /></label><label>{t('Specialties · Chinese', '专长 · 中文')}<input required maxLength={200} value={profile.specialties.zh} onChange={(event) => setProfile({ ...profile, specialties: { ...profile.specialties, zh: event.target.value } })} /></label><label>{t('Description · English', '简介 · 英文')}<textarea required maxLength={500} rows={3} value={profile.description.en} onChange={(event) => setProfile({ ...profile, description: { ...profile.description, en: event.target.value } })} /></label><label>{t('Description · Chinese', '简介 · 中文')}<textarea required maxLength={500} rows={3} value={profile.description.zh} onChange={(event) => setProfile({ ...profile, description: { ...profile.description, zh: event.target.value } })} /></label></div><label className={styles.checkLabel}><input type="checkbox" checked={profile.active} onChange={(event) => setProfile({ ...profile, active: event.target.checked })} /><span>{t('Active · show to customers and allow assignments', '在职 · 向顾客显示并可安排预约')}</span></label><fieldset className={styles.portraits}><legend>{t('Sample portrait', '示例头像')}</legend>{Array.from({ length: 6 }, (_, index) => `/therapists/therapist-0${index + 1}.png`).map((path, index) => <label key={path} className={profile.imageUrl === path ? styles.selectedPortrait : ''}><input type="radio" name="portrait" checked={profile.imageUrl === path} onChange={() => setProfile({ ...profile, imageUrl: path })} /><Image src={path} alt={`${t('Portrait', '头像')} ${index + 1}`} width={60} height={60} /></label>)}</fieldset></fieldset>
      <fieldset className={styles.guestFieldset}><legend>{t('Treatment capabilities', '可提供的疗程')}</legend><p className={styles.hint}>{t('A therapist must support the service and every included or selected add-on to be assigned.', '按摩师必须具备主疗程以及套餐内或额外所选项目的技能，才能安排服务。')}</p><div className={styles.checkGrid}>{catalog.map((category) => <label key={category.id} className={styles.checkLabel}><input type="checkbox" checked={profile.categoryIds.includes(category.id)} onChange={(event) => setProfile({ ...profile, categoryIds: event.target.checked ? [...profile.categoryIds, category.id] : profile.categoryIds.filter((id) => id !== category.id) })} /><span>{category.name[locale]}</span></label>)}</div><h4>{t('Add-on skills', '附加项目技能')}</h4><div className={styles.checkGrid}>{allAddOns.map((addon) => <label key={addon.id} className={styles.checkLabel}><input type="checkbox" checked={profile.addOnIds.includes(addon.id)} onChange={(event) => setProfile({ ...profile, addOnIds: event.target.checked ? [...profile.addOnIds, addon.id] : profile.addOnIds.filter((id) => id !== addon.id) })} /><span>{addon.name[locale]}</span></label>)}</div></fieldset></>}
    <fieldset className={styles.guestFieldset}><legend>{t('Working hours & leave', '上班时间与休假')}</legend><p className={styles.hint}>{t('Hours repeat daily, except the leave dates below. Changes that conflict with existing reservations are rejected.', '以下为每天的工作时间，休假日期除外。若更改与现有预约冲突，系统将拒绝保存。')}</p><div className={styles.formGrid}><label>{t('Shift starts', '上班时间')}<input type="time" required min={bookingSettings.firstTime} max={bookingSettings.closingTime} value={profile.shiftStart} onChange={(event) => setProfile({ ...profile, shiftStart: event.target.value })} /></label><label>{t('Shift ends', '下班时间')}<input type="time" required min={profile.shiftStart} max={bookingSettings.closingTime} value={profile.shiftEnd} onChange={(event) => setProfile({ ...profile, shiftEnd: event.target.value })} /></label></div><div className={styles.inlineForm}><label>{t('Add a leave date', '添加休假日期')}<input type="date" min={malaysiaDateValue()} value={leaveDate} onChange={(event) => setLeaveDate(event.target.value)} /></label><button type="button" className={styles.secondaryButton} disabled={!leaveDate || profile.leaveDates.includes(leaveDate)} onClick={() => { setProfile({ ...profile, leaveDates: [...profile.leaveDates, leaveDate].sort() }); setLeaveDate(''); }}>{t('Add leave', '添加休假')}</button></div><div className={styles.leaveList}>{profile.leaveDates.length ? profile.leaveDates.map((value) => <span key={value}>{value}<button type="button" aria-label={`${t('Remove leave date', '移除休假日期')} ${value}`} onClick={() => setProfile({ ...profile, leaveDates: profile.leaveDates.filter((entry) => entry !== value) })}>×</button></span>) : <p className={styles.hint}>{t('No leave dates configured.', '尚未设置休假日期。')}</p>}</div></fieldset><button className={styles.primaryButton} disabled={busy}>{busy ? t('Saving…', '保存中…') : t('Save changes', '保存更改')}</button>
  </form>;
}
