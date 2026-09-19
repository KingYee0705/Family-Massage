'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Keep navigation compatible with the local demo runtime. */

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { business, type Locale } from '../catalog';
import { DemoApiError, getDemoSession, loginDemoStaff, logoutDemoStaff, malaysiaDateValue, type DemoStaffUser } from '../demo-booking';
import { loadBossMonth, reopenBossMonth, saveBossDeductions, saveBossStatement } from '../boss-api';
import type { BossDeductionInput, BossMonthReport, BossTherapistMonth, BossTotals } from '../boss-types';
import styles from './boss.module.css';
import { BossRooms } from '../room-board';

type Translate = (en: string, zh: string) => string;
type Selection = { month: string; statementId: string };
const selectionKey = (value: Selection) => `${value.month}/${value.statementId}`;
const currentMonth = () => malaysiaDateValue().slice(0, 7);
const currency = (cents: number, locale: Locale) => new Intl.NumberFormat(locale === 'zh' ? 'zh-MY' : 'en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2 }).format(cents / 100);
const monthLabel = (month: string, locale: Locale) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(`${month}-01T12:00:00+08:00`));
const dayLabel = (date: string, locale: Locale) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(`${date}T12:00:00+08:00`));
const timestampLabel = (date: string, locale: Locale) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));

function Portrait({ src, name, size }: { src: string; name: string; size: number }) {
  return src ? <Image src={src} alt="" width={size} height={size} /> : <span className={styles.portraitFallback} aria-hidden="true" style={{ width: size, height: size }}>{Array.from(name.trim())[0] || 'S'}</span>;
}

function Calculation({ totals, locale, compact = false }: { totals: BossTotals; locale: Locale; compact?: boolean }) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  return <div className={`${styles.calculation} ${compact ? styles.compact : ''}`}>
    <div><span>{t('Treatments & packages', '疗程与套餐')}</span><strong>{currency(totals.serviceCents, locale)}</strong></div>
    <div><span>{t('Add-ons selected when booking', '预约时选择的附加项目')}</span><strong>{currency(totals.bookedExtrasCents, locale)}</strong></div>
    <div><span>{t('Add-ons bought later', '柜台或疗程中加购')}</span><strong>{currency(totals.laterExtrasCents, locale)}</strong></div>
    <div className={styles.calculationSubtotal}><span>{t('Total sales', '销售总额')}</span><strong>{currency(totals.grossCents, locale)}</strong></div>
    <div><span>{t('Therapist commission · 50%', '按摩师佣金 · 50%')}</span><strong>{currency(totals.commissionCents, locale)}</strong></div>
    <div><span>{t('Room rental deduction', '房租扣除')}</span><strong>− {currency(totals.rentalCents, locale)}</strong></div>
    <div><span>{t('Electricity deduction', '电费扣除')}</span><strong>− {currency(totals.electricityCents, locale)}</strong></div>
    <div className={`${styles.calculationTotal} ${totals.netCents < 0 ? styles.negativeTotal : ''}`}><span>{t('Final balance', '最终结算金额')}</span><strong>{currency(totals.netCents, locale)}</strong></div>
    {totals.netCents < 0 && <p className={styles.negativeNote}>{t('Deductions exceed commission. This balance needs the owner’s review; no debt is carried forward automatically.', '扣除额超过佣金。此余额需由老板核对，系统不会自动结转为债务。')}</p>}
  </div>;
}

function DeductionsEditor({ therapist, revision, busy, save, locale }: { therapist: BossTherapistMonth; revision: string; busy: boolean; save: (input: BossDeductionInput) => Promise<BossMonthReport | null>; locale: Locale }) {
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const [rental, setRental] = useState((therapist.rentalCents / 100).toFixed(2));
  const [electricity, setElectricity] = useState((therapist.electricityCents / 100).toFixed(2));
  const [future, setFuture] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [formRevision, setFormRevision] = useState(revision);
  const stale = formRevision !== revision;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (stale) { setError(t('The account changed. Review the updated figures below before saving.', '账目已更新。保存前，请先核对下方最新金额。')); return; }
    const roomAmount = Number(rental);
    const electricityAmount = Number(electricity);
    if (!rental.trim() || !electricity.trim() || !Number.isFinite(roomAmount) || !Number.isFinite(electricityAmount) || roomAmount < 0 || electricityAmount < 0 || !/^\d+(\.\d{1,2})?$/.test(rental) || !/^\d+(\.\d{1,2})?$/.test(electricity)) {
      setError(t('Enter a non-negative RM amount with up to two decimal places.', '请输入非负的马币金额，最多两位小数。')); return;
    }
    setError('');
    const next = await save({ rental: roomAmount, electricity: electricityAmount, applyToFutureMonths: future, expectedRevision: formRevision });
    if (next) { setSaved(true); setFormRevision(next.revision); }
  }
  return <form className={styles.deductions} onSubmit={submit}>
    <h3>{t('Monthly deductions', '每月扣除额')}</h3>
    <p>{t('These amounts belong to this therapist. Save changes when the room or electricity charge changes.', '这些金额属于此按摩师。房间或电费调整时，可在这里更新。')}</p>
    <div className={styles.moneyFields}>
      <label>{t('Room rental · RM', '房租 · RM')}<input name="rental" type="number" inputMode="decimal" min="0" step="0.01" max="100000" required value={rental} onChange={(event) => { setRental(event.target.value); setSaved(false); }} disabled={busy} /></label>
      <label>{t('Electricity · RM', '电费 · RM')}<input name="electricity" type="number" inputMode="decimal" min="0" step="0.01" max="100000" required value={electricity} onChange={(event) => { setElectricity(event.target.value); setSaved(false); }} disabled={busy} /></label>
    </div>
    <label className={styles.checkbox}><input type="checkbox" checked={future} onChange={(event) => { setFuture(event.target.checked); setSaved(false); }} disabled={busy} /><span>{t('Use these amounts as defaults for future months', '将这些金额设为以后月份的默认值')}</span></label>
    {stale && <div className={styles.staleForm}><strong>{t('The account has been updated', '账目已更新')}</strong><p>{t('Your entries are kept. Currently saved:', '已保留您输入的金额。当前保存的金额：')} {t('Rental', '房租')} {currency(therapist.rentalCents, locale)} · {t('Electricity', '电费')} {currency(therapist.electricityCents, locale)}.</p><div className={styles.toolbarButtons}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { setFormRevision(revision); setError(''); setSaved(false); }}>{t('Keep my entries with updated totals', '保留输入并使用最新账目')}</button><button type="button" className={styles.quietButton} disabled={busy} onClick={() => { setRental((therapist.rentalCents / 100).toFixed(2)); setElectricity((therapist.electricityCents / 100).toFixed(2)); setFormRevision(revision); setError(''); setSaved(false); }}>{t('Load saved amounts', '载入已保存金额')}</button></div></div>}
    {error && <p role="alert" className={styles.inlineError}>{error}</p>}
    <div className={styles.saveRow}><button className={styles.primaryButton} disabled={busy || stale}>{busy ? t('Saving…', '保存中…') : t('Save deductions', '保存扣除额')}</button>{saved && !stale && <span role="status">{t('Saved', '已保存')} ✓</span>}</div>
  </form>;
}

export default function BossPage() {
  const [locale, setLocale] = useState<Locale>('en');
  const t: Translate = (en, zh) => locale === 'zh' ? zh : en;
  const [user, setUser] = useState<DemoStaffUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [selection, setSelection] = useState<Selection>({ month: currentMonth(), statementId: '' });
  const [report, setReport] = useState<BossMonthReport | null>(null);
  const [reportKey, setReportKey] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('owner@serene.demo');
  const [password, setPassword] = useState('');
  const [closeReview, setCloseReview] = useState(false);
  const [reopenReview, setReopenReview] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState<'accounts' | 'rooms'>('accounts');
  const [printMode, setPrintMode] = useState<'shop' | 'therapist'>('shop');
  const userRef = useRef<DemoStaffUser | null>(null);
  const selectionRef = useRef(selection);
  const epoch = useRef(0);
  const request = useRef(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);

  const clearPrivateData = useCallback(() => {
    epoch.current += 1; request.current += 1;
    setReport(null); setReportKey(''); setTherapistId(''); setCloseReview(false); setReopenReview(false); setReopenReason(''); setNotice('');
  }, []);

  const applySession = useCallback((session: DemoStaffUser | null) => {
    if (session?.id !== userRef.current?.id || session?.role !== userRef.current?.role) clearPrivateData();
    userRef.current = session;
    setUser(session);
  }, [clearPrivateData]);

  const refresh = useCallback(async (showLoading = false) => {
    if (busyRef.current || userRef.current?.role !== 'owner') return;
    const wanted = selectionRef.current;
    const wantedKey = selectionKey(wanted);
    const requestId = ++request.current;
    const authEpoch = epoch.current;
    const ownerId = userRef.current.id;
    if (showLoading) setLoading(true);
    try {
      const session = await getDemoSession();
      if (!mounted.current || authEpoch !== epoch.current || requestId !== request.current) return;
      if (session?.role !== 'owner' || session.id !== ownerId) { applySession(session); return; }
      const next = await loadBossMonth(wanted.month, wanted.statementId || undefined);
      const stillSignedIn = await getDemoSession();
      if (!mounted.current || authEpoch !== epoch.current || requestId !== request.current || selectionKey(selectionRef.current) !== wantedKey || userRef.current?.id !== ownerId || userRef.current.role !== 'owner') return;
      if (stillSignedIn?.role !== 'owner' || stillSignedIn.id !== ownerId) { applySession(stillSignedIn); return; }
      setReport(next); setReportKey(wantedKey); setError('');
    } catch (cause) {
      if (!mounted.current || authEpoch !== epoch.current || requestId !== request.current) return;
      if (cause instanceof DemoApiError && (cause.status === 401 || cause.status === 403)) applySession(null);
      setError(cause instanceof Error ? cause.message : 'Unable to load the month. / 无法载入月份。');
    } finally { if (mounted.current && requestId === request.current) setLoading(false); }
  }, [applySession]);

  useEffect(() => {
    mounted.current = true;
    const authEpoch = epoch.current;
    getDemoSession().then((session) => { if (mounted.current && authEpoch === epoch.current) applySession(session); })
      .catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to connect. / 无法连接。'); })
      .finally(() => { if (mounted.current) setChecking(false); });
    return () => { mounted.current = false; epoch.current += 1; request.current += 1; };
  }, [applySession]);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    const initial = window.setTimeout(() => { void refresh(true); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    const onFocus = () => { if (!busyRef.current) void refresh(true); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [user?.id, user?.role, selection.month, selection.statementId, refresh]);

  useEffect(() => {
    let previous: { element: HTMLDetailsElement; open: boolean }[] = [];
    const beforePrint = () => {
      previous = Array.from(document.querySelectorAll<HTMLDetailsElement>(`details.${styles.day}`)).map((element) => ({ element, open: element.open }));
      previous.forEach(({ element }) => { element.open = true; });
    };
    const afterPrint = () => { previous.forEach(({ element, open }) => { element.open = open; }); previous = []; };
    window.addEventListener('beforeprint', beforePrint); window.addEventListener('afterprint', afterPrint);
    return () => { window.removeEventListener('beforeprint', beforePrint); window.removeEventListener('afterprint', afterPrint); };
  }, []);

  function choose(next: Selection) {
    selectionRef.current = next; request.current += 1; setSelection(next); setReport(null); setReportKey(''); setError(''); setNotice(''); setCloseReview(false); setReopenReview(false); setReopenReason('');
  }

  function selectTherapist(id: string) {
    setTherapistId(id);
    window.requestAnimationFrame(() => document.getElementById('boss-therapist-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    clearPrivateData(); setError(''); setBusy(true); busyRef.current = true;
    const authEpoch = epoch.current;
    try {
      const session = await loginDemoStaff(email, password);
      if (!mounted.current || authEpoch !== epoch.current) return;
      applySession(session); setPassword('');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to sign in. / 无法登录。'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function signOut() {
    clearPrivateData(); userRef.current = null; setUser(null); setError(''); setBusy(true); busyRef.current = true;
    try { await logoutDemoStaff(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign out. / 无法退出。'); }
    finally { busyRef.current = false; setBusy(false); setLoading(false); }
  }

  async function mutate(action: () => Promise<BossMonthReport>, success: string): Promise<BossMonthReport | null> {
    if (busyRef.current || userRef.current?.role !== 'owner') return null;
    const key = selectionKey(selectionRef.current);
    const ownerId = userRef.current.id;
    const authEpoch = epoch.current;
    request.current += 1; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    let successful: BossMonthReport | null = null;
    try {
      const session = await getDemoSession();
      if (!mounted.current || authEpoch !== epoch.current) return null;
      if (session?.role !== 'owner' || session.id !== ownerId) { applySession(session); return null; }
      const next = await action();
      const stillSignedIn = await getDemoSession();
      if (!mounted.current || authEpoch !== epoch.current) return null;
      if (stillSignedIn?.role !== 'owner' || stillSignedIn.id !== ownerId) { applySession(stillSignedIn); return null; }
      if (selectionKey(selectionRef.current) !== key) return null;
      setReport(next); setReportKey(key); setNotice(success); setCloseReview(false); setReopenReview(false); setReopenReason(''); successful = next;
    } catch (cause) {
      if (mounted.current && authEpoch === epoch.current && selectionKey(selectionRef.current) === key) {
        if (cause instanceof DemoApiError && (cause.status === 401 || cause.status === 403)) applySession(null);
        setError(cause instanceof Error ? cause.message : 'Unable to save changes. / 无法保存更改。');
        if (cause instanceof DemoApiError && cause.status === 409) {
          try {
            const latest = await loadBossMonth(selectionRef.current.month, selectionRef.current.statementId || undefined);
            const latestSession = await getDemoSession();
            if (mounted.current && authEpoch === epoch.current && selectionKey(selectionRef.current) === key) {
              if (latestSession?.role !== 'owner' || latestSession.id !== ownerId) applySession(latestSession);
              else { setReport(latest); setReportKey(key); }
            }
          } catch { /* Keep the original conflict message visible. */ }
        }
      }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    return successful;
  }

  const visible = user?.role === 'owner' && reportKey === selectionKey(selection) ? report : null;
  const therapist = visible?.therapists.find((entry) => entry.therapistId === therapistId);
  const historical = Boolean(selection.statementId);
  const readOnly = historical || visible?.status === 'closed';
  const print = (mode: 'shop' | 'therapist') => { setPrintMode(mode); window.setTimeout(() => window.print(), 0); };
  const localeSwitch = <div className={styles.localeSwitch} aria-label="Language / 语言"><button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button><button type="button" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button></div>;

  const roomSessionExpired = useCallback(() => applySession(null), [applySession]);
  return <main className={`${styles.page} ${printMode === 'therapist' ? styles.printTherapist : styles.printShop}`}>
    <header className={styles.topbar}><a className={styles.brand} href="/"><span>S</span>{business.name}</a><div className={styles.topbarActions}>{localeSwitch}{user && <><a href="/staff">{t('Staff workspace', '员工工作台')}</a><button className={styles.quietButton} onClick={() => void signOut()} disabled={busy}>{t('Sign out', '退出')}</button></>}</div></header>
    <div className={styles.shell}>
      {checking ? <div className={styles.loading} role="status">{t('Opening your workspace…', '正在打开工作台…')}</div> : !user ? <section className={styles.loginCard}>
        <span className={styles.eyebrow}>{t('OWNER WORKSPACE', '老板工作台')}</span><h1>{t('The month, made clear.', '每月账目，一目了然。')}</h1><p>{t('See the work, review the commission, and settle each therapist’s month.', '查看业绩、核对佣金，并为每位按摩师完成月度结算。')}</p>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <form onSubmit={login}><label>{t('Email', '电子邮件')}<input name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} /></label><label>{t('Password', '密码')}<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /></label><button className={styles.primaryButton} disabled={busy}>{busy ? t('Signing in…', '登录中…') : t('Open owner workspace', '进入老板工作台')}</button></form>
        <div className={styles.demoCredentials}><strong>{t('Local demo login', '本地演示账号')}</strong><span>owner@serene.demo</span><code>SereneDemo!</code></div>
      </section> : user.role !== 'owner' ? <section className={styles.loginCard}><span className={styles.eyebrow}>{t('OWNER ACCESS', '老板专属')}</span><h1>{t('This space is for the owner.', '此页面仅供老板使用。')}</h1><p>{t('You are signed in as', '当前登录账号为')} {user.email}. {t('Monthly earnings and deductions are private to the owner account.', '每月收入与扣除额仅限老板账号查看。')}</p><button className={styles.primaryButton} onClick={() => void signOut()} disabled={busy}>{t('Sign out to use the owner account', '退出并使用老板账号登录')}</button><a className={styles.backLink} href="/staff">← {t('Back to staff workspace', '返回员工工作台')}</a>{error && <p className={styles.error} role="alert">{error}</p>}</section> : <>
        <div className={styles.demoBanner}><span>{t('LOCAL DEMO', '本地演示')}</span><p>{t('Sample therapists and starting deduction amounts. Review each therapist’s rental and electricity before using a statement.', '当前使用示例按摩师与初始扣除额。使用结算单前，请核对每位按摩师的房租与电费。')}</p></div>
        <nav className={styles.reportToolbar} aria-label={t('Owner workspace', '老板工作台')}><div className={styles.toolbarButtons}><button className={workspaceTab === 'accounts' ? styles.primaryButton : styles.secondaryButton} aria-pressed={workspaceTab === 'accounts'} onClick={() => setWorkspaceTab('accounts')}>{t('Monthly accounts', '月度结算')}</button><button className={workspaceTab === 'rooms' ? styles.primaryButton : styles.secondaryButton} aria-pressed={workspaceTab === 'rooms'} onClick={() => setWorkspaceTab('rooms')}>{t('Rooms & occupancy', '房间与预约')}</button></div></nav>
        {workspaceTab === 'rooms' && <BossRooms locale={locale} onUnauthorized={roomSessionExpired} />}
        <div hidden={workspaceTab !== 'accounts'}>
        <div className={styles.heading}><div><span className={styles.eyebrow}>{t('OWNER WORKSPACE', '老板工作台')}</span><h1>{t('Monthly accounts', '月度账目')}</h1><p>{t('Every treatment. Every extra. One clear balance.', '每项疗程、每笔加购，清楚计算每月结算额。')}</p></div><div className={styles.monthControl}><label htmlFor="boss-month">{t('View month', '查看月份')}</label><input id="boss-month" type="month" min="2000-01" value={selection.month} max={currentMonth()} disabled={busy} onChange={(event) => { const value = event.target.value; if (/^\d{4}-\d{2}$/.test(value) && value >= '2000-01' && value <= currentMonth()) choose({ month: value, statementId: '' }); }} /><small>{t('Malaysia time · MYT', '马来西亚时间 · MYT')}</small></div></div>
        {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
        {!visible ? <div className={styles.loading} role="status">{loading ? t('Loading monthly accounts…', '正在载入月度账目…') : t('The monthly accounts are not available yet.', '月度账目暂时无法显示。')}<button className={styles.secondaryButton} onClick={() => void refresh(true)} disabled={loading || busy}>{t('Try again', '重试')}</button></div> : <>
          <div className={styles.reportToolbar}><div><span className={`${styles.status} ${readOnly ? styles.savedStatus : ''}`}>{readOnly ? t('Saved statement', '已保存结算单') : t('Draft · updating with completed work', '草稿 · 随已完成服务更新')}</span><span className={styles.updated}>{visible.savedAt ? `${t('Saved', '保存于')} ${timestampLabel(visible.savedAt, locale)}` : `${t('Updated', '更新于')} ${timestampLabel(visible.generatedAt, locale)}`}</span></div><div className={styles.toolbarButtons}><button className={styles.quietButton} onClick={() => void refresh(true)} disabled={busy || loading}>{t('Refresh', '刷新')} ↻</button><button className={styles.secondaryButton} onClick={() => print('shop')} disabled={busy}>{t('Print monthly summary', '打印月度汇总')}</button></div></div>
          {visible.statementHistory.length > 0 && <div className={styles.historyControl}><label htmlFor="statement-history">{t('Statement version', '结算单版本')}</label><select id="statement-history" value={selection.statementId} disabled={busy} onChange={(event) => choose({ ...selection, statementId: event.target.value })}><option value="">{t('Current record for selected month', '所选月份的当前记录')}</option>{visible.statementHistory.map((entry, index) => <option key={entry.id} value={entry.id}>{t('Saved version', '已保存版本')} {visible.statementHistory.length - index} · {timestampLabel(entry.savedAt, locale)}</option>)}</select>{historical && <p>{t('You are viewing a preserved statement. Changes to the current record do not alter this version.', '正在查看保留的结算单。当前记录的修改不会改变此版本。')}</p>}</div>}
          <div className={styles.printHeading}><p>{business.name} · {t('Owner statement', '老板结算单')}</p><h1>{monthLabel(visible.month, locale)}</h1><p>{readOnly ? t('Saved statement', '已保存结算单') : t('Draft statement', '草稿结算单')} · {timestampLabel(visible.savedAt ?? visible.generatedAt, locale)} · MYT</p>{printMode === 'therapist' && therapist && <h2>{therapist.staffNumber} · {therapist.name[locale]}</h2>}</div>
          <section className={styles.overview} aria-label={t('Monthly totals', '每月汇总')}><article className={styles.heroMetric}><span>{t('Completed sales', '已完成服务销售额')}</span><strong>{currency(visible.totals.grossCents, locale)}</strong><p>{visible.totals.completedTreatments} {t('completed treatments, including all add-ons', '项已完成疗程，包含全部附加项目')}</p></article><article className={styles.balanceMetric}><span>{t('Therapist final balances', '按摩师最终结算总额')}</span><strong>{currency(visible.totals.netCents, locale)}</strong><p>{t('50% commission, less rental and electricity', '50% 佣金减去房租与电费')}</p></article><article className={styles.shopMetric}><span>{t('Shop’s 50% share', '店铺的 50% 分成')}</span><strong>{currency(visible.totals.shopShareCents, locale)}</strong><p>{t('Before shop expenses · not net profit', '未扣除店铺开支 · 非净利润')}</p></article></section>
          <div className={styles.formula}>{t('(Treatments + booked add-ons + later add-ons) × 50% − rental − electricity = therapist’s final balance', '（疗程 + 预约附加项目 + 后续加购）× 50% − 房租 − 电费 = 按摩师最终结算金额')}</div>
          <section className={styles.teamSection}><div className={styles.sectionHeading}><div><h2>{t('Your therapists', '按摩师月度明细')}</h2><p>{t('Select a therapist to see their daily record and monthly deductions.', '选择一位按摩师，查看每日记录与每月扣除额。')}</p></div><span>{visible.therapists.length} {t('therapists', '位按摩师')}</span></div><div className={styles.tableWrap}><table className={styles.teamTable}><thead><tr><th>{t('Therapist', '按摩师')}</th><th>{t('Sales', '销售额')}</th><th>{t('Commission · 50%', '佣金 · 50%')}</th><th>{t('Rental + electricity', '房租 + 电费')}</th><th>{t('Final balance', '最终结算')}</th><th><span className={styles.srOnly}>{t('Details', '详情')}</span></th></tr></thead><tbody>{visible.therapists.map((entry) => <tr key={entry.therapistId} className={therapistId === entry.therapistId ? styles.selectedRow : ''}><td><button className={styles.personButton} aria-expanded={therapistId === entry.therapistId} onClick={() => selectTherapist(entry.therapistId)}><Portrait src={entry.imageUrl} name={entry.name[locale]} size={42} /><span><strong>{entry.name[locale]}</strong><small>{entry.staffNumber} · {entry.completedTreatments} {t('treatments', '项疗程')}{!entry.active ? ` · ${t('Inactive', '已停用')}` : ''}</small></span></button></td><td data-label={t('Sales', '销售额')}>{currency(entry.grossCents, locale)}</td><td data-label={t('Commission · 50%', '佣金 · 50%')}>{currency(entry.commissionCents, locale)}</td><td data-label={t('Rental + electricity', '房租 + 电费')}>{currency(entry.rentalCents + entry.electricityCents, locale)}</td><td data-label={t('Final balance', '最终结算')} className={entry.netCents < 0 ? styles.negativeAmount : styles.finalAmount}>{currency(entry.netCents, locale)}</td><td><button className={styles.detailsButton} aria-label={`${t('View details for', '查看详情')} ${entry.name[locale]}`} onClick={() => selectTherapist(entry.therapistId)}>↗</button></td></tr>)}</tbody><tfoot><tr><th>{t('Monthly total', '每月合计')}</th><td data-label={t('Sales', '销售额')}>{currency(visible.totals.grossCents, locale)}</td><td data-label={t('Commission · 50%', '佣金 · 50%')}>{currency(visible.totals.commissionCents, locale)}</td><td data-label={t('Rental + electricity', '房租 + 电费')}>{currency(visible.totals.rentalCents + visible.totals.electricityCents, locale)}</td><td data-label={t('Final balance', '最终结算')}>{currency(visible.totals.netCents, locale)}</td><td /></tr></tfoot></table></div></section>
          {visible.therapists.some((entry) => entry.netCents < 0) && <p className={styles.negativeNote}>{t('Some therapists have deductions above their commission. Review their individual balances; the total includes these negative amounts.', '部分按摩师的扣除额超过佣金。请核对个人余额，汇总包含这些负数金额。')}</p>}
          {therapist && <section id="boss-therapist-detail" className={styles.therapistDetail} aria-label={t('Selected therapist details', '所选按摩师详情')}><div className={styles.detailHeading}><div className={styles.detailPerson}><Portrait src={therapist.imageUrl} name={therapist.name[locale]} size={64} /><div><span className={styles.eyebrow}>{therapist.staffNumber} · {monthLabel(visible.month, locale)}</span><h2>{therapist.name[locale]}</h2></div></div><div className={styles.toolbarButtons}><button className={styles.secondaryButton} onClick={() => print('therapist')} disabled={busy}>{t('Print therapist statement', '打印个人结算单')}</button><button className={styles.quietButton} aria-label={t('Close therapist details', '关闭按摩师详情')} onClick={() => setTherapistId('')}>×</button></div></div><div className={styles.detailGrid}><div><h3>{t('This month’s calculation', '本月计算明细')}</h3><Calculation totals={therapist} locale={locale} /></div><div className={styles.editColumn}>{readOnly ? <div className={styles.readOnlyNote}><span>✓</span><h3>{t('Deductions saved with this statement', '扣除额已随结算单保存')}</h3><p>{t('This statement keeps its original figures. To make a correction, return to the current record and reopen the month.', '此结算单保留原始金额。如需更正，请返回当前记录并重新开启月份。')}</p></div> : <DeductionsEditor key={`${visible.month}/${therapist.therapistId}`} therapist={therapist} revision={visible.revision} busy={busy} locale={locale} save={(input) => mutate(() => saveBossDeductions(visible.month, therapist.therapistId, input), t('Monthly deductions saved.', '每月扣除额已保存。'))} />}</div></div><div className={styles.dailyHeading}><h3>{t('Daily work record', '每日工作记录')}</h3><span>{therapist.completedTreatments} {t('completed treatments', '项已完成疗程')}</span></div>{therapist.days.length === 0 ? <p className={styles.emptyState}>{t('No completed work in this month yet. Completed bookings will appear here automatically.', '本月尚未有已完成的服务。完成预约后，记录会自动显示在这里。')}</p> : <div className={styles.dayList}>{therapist.days.map((day) => <details key={day.date} className={styles.day}><summary><strong>{dayLabel(day.date, locale)}</strong><span>{day.completedTreatments} {t('treatments', '项疗程')}</span><strong>{currency(day.grossCents, locale)}</strong><span aria-hidden="true">⌄</span></summary><div className={styles.dayLines}>{day.lines.map((line) => <article key={`${line.bookingId}/${line.guestId}`} className={styles.saleLine}><div><span className={styles.lineReference}>{line.start} · {line.reference}</span><h4>{line.service[locale]}</h4><p>{line.guestName || t('Guest', '顾客')}</p></div><div className={styles.saleAmounts}><div><span>{t('Treatment / package', '疗程／套餐')}</span><strong>{currency(line.serviceCents, locale)}</strong></div>{line.extras.map((extra, index) => <div key={`${extra.source}/${index}`}><span>{extra.name[locale]}<small>{extra.source === 'booking' ? t('Booked add-on', '预约附加项目') : extra.source === 'counter' ? t('Added at counter', '柜台加购') : t('Added during treatment', '疗程中加购')}</small></span><strong>{currency(extra.priceCents, locale)}</strong></div>)}<div className={styles.lineTotal}><span>{t('Sale total', '销售合计')}</span><strong>{currency(line.grossCents, locale)}</strong></div></div></article>)}</div></details>)}</div>}</section>}
          <section className={styles.monthEnd}><div><span className={styles.eyebrow}>{t('MONTH-END RECORD', '月末结算记录')}</span><h2>{readOnly ? t('A record you can return to.', '保存账目，随时查阅。') : t('Review. Save. Keep the record.', '核对、保存、留档。')}</h2><p>{historical ? t('This saved version remains available in the statement history.', '此已保存版本会继续保留在结算单历史中。') : visible.status === 'closed' ? t('This month is saved and read-only. Reopening it preserves the saved version and records the reason for your correction.', '本月已保存为只读。重新开启后，旧版本仍会保留，并记录更正原因。') : selection.month === currentMonth() ? t('This month is still in progress. You can edit deductions now and save the final statement once the month ends.', '本月仍在进行中。现在可编辑扣除额，月底结束后即可保存最终结算单。') : t('Review every therapist’s sales and deductions, then save a fixed statement of this month. Saving records the balance; it does not make a payment.', '请核对每位按摩师的销售额与扣除额，然后保存本月固定结算单。保存只会记录余额，不会进行付款。')}</p></div>{!historical && visible.status === 'open' && selection.month < currentMonth() && !closeReview && <button className={styles.primaryButton} onClick={() => setCloseReview(true)} disabled={busy}>{t('Review & save month', '核对并保存月份')}</button>}{!historical && visible.status === 'closed' && !reopenReview && <button className={styles.secondaryButton} onClick={() => setReopenReview(true)} disabled={busy}>{t('Reopen to correct', '重新开启以更正')}</button>}
            {closeReview && <div className={styles.confirmPanel}><h3>{t('Save this month’s statement?', '保存本月结算单？')}</h3><p>{monthLabel(visible.month, locale)} · {t('Sales', '销售额')} {currency(visible.totals.grossCents, locale)} · {t('Final balances', '最终结算总额')} {currency(visible.totals.netCents, locale)}</p><p>{t('This saves a fixed copy and makes the month read-only. You can reopen it later with a correction reason.', '此操作会保存固定副本，并将月份设为只读。之后如需更正，可填写原因重新开启。')}</p><div className={styles.toolbarButtons}><button className={styles.primaryButton} disabled={busy} onClick={() => void mutate(() => saveBossStatement(visible.month, visible.revision), t('Statement saved. This month is now read-only.', '结算单已保存，本月已设为只读。'))}>{busy ? t('Saving…', '保存中…') : t('Confirm & save statement', '确认保存结算单')}</button><button className={styles.quietButton} onClick={() => setCloseReview(false)} disabled={busy}>{t('Keep reviewing', '继续核对')}</button></div></div>}
            {reopenReview && <form className={styles.confirmPanel} onSubmit={(event) => { event.preventDefault(); if (reopenReason.trim()) void mutate(() => reopenBossMonth(visible.month, visible.revision, reopenReason.trim()), t('Month reopened. The earlier statement is preserved.', '月份已重新开启，原有结算单已保留。')); }}><label>{t('Reason for correction', '更正原因')}<textarea required minLength={3} maxLength={500} rows={2} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder={t('For example: correct the electricity deduction', '例如：更正电费扣除额')} disabled={busy} /></label><div className={styles.toolbarButtons}><button className={styles.primaryButton} disabled={busy || reopenReason.trim().length < 3}>{busy ? t('Reopening…', '正在开启…') : t('Reopen month', '重新开启月份')}</button><button type="button" className={styles.quietButton} onClick={() => setReopenReview(false)} disabled={busy}>{t('Cancel', '取消')}</button></div></form>}
          </section>
          {visible.audit.length > 0 && <details className={styles.audit}><summary>{t('Changes & saved records', '更改与保存记录')} <span>{visible.audit.length}</span></summary><ul>{visible.audit.map((entry) => <li key={entry.id}><time dateTime={entry.at}>{timestampLabel(entry.at, locale)}</time><span>{entry.action}</span><small>{entry.actor}</small></li>)}</ul></details>}
          <footer className={styles.reportFooter}><span>{business.name} · {monthLabel(visible.month, locale)}</span><span>{t('Completed work only · 50% therapist commission', '仅计算已完成服务 · 按摩师佣金 50%')}</span></footer>
        </>}
        </div>
      </>}
    </div>
  </main>;
}
