'use client';

import { useEffect, useState } from 'react';
import { bookingSettings, type Locale } from './catalog';
import { DemoApiError, getDemoSession, loadStaffDemoState, malaysiaDateValue, type StaffState } from './demo-booking';
import { minuteValue, overrunWarnings, roomSchedule, shopTime, type RoomStatus, type RoomVisit } from './room-schedule';
import styles from './rooms.module.css';

export function OverrunWarnings({ state, locale, onOpenBooking }: { state: StaffState; locale: Locale; onOpenBooking?: (id: string) => void }) {
  const t = (en: string, zh: string) => locale === 'zh' ? zh : en;
  const warnings = overrunWarnings(state);
  if (!warnings.length) return null;
  return <section className={styles.warning} role="status"><strong>{t('Treatment overruns / conflicts — staff action required', '疗程超时／冲突 — 请员工处理')}</strong>
    <p>{t('Therapists and rooms remain blocked for new bookings until completion, followed by five minutes of cleaning. Existing bookings have not been changed.', '按摩师和设施将暂停接受新预约，直到员工标记完成并清洁五分钟。现有预约保持不变。')}</p>
    {warnings.map((warning) => <div key={warning.id}><p><strong>{warning.reference}</strong> · {warning.date} {warning.cleaning ? t('· Cleaning after late completion', '· 超时结束后清洁中') : warning.overnight && t('· Still open from a previous day', '· 前一天的疗程仍未结束')} {onOpenBooking && <button type="button" onClick={() => onOpenBooking(warning.id)}>{t('Review treatment', '查看疗程')}</button>}</p>
      {warning.conflicts.length > 0 && <ul>{warning.conflicts.map((conflict) => <li key={conflict.id}>{t('Potential conflict', '潜在冲突')}: {conflict.reference} · {conflict.date} {conflict.time} {onOpenBooking && <button type="button" onClick={() => onOpenBooking(conflict.id)}>{t('Review booking', '查看预约')}</button>}</li>)}</ul>}
    </div>)}
  </section>;
}

export function RoomBoard({ state, date, time, locale, onOpenBooking }: { state: StaffState; date: string; time: string; locale: Locale; onOpenBooking?: (id: string) => void }) {
  const t = (en: string, zh: string) => locale === 'zh' ? zh : en;
  const [filter, setFilter] = useState<'room' | 'chair'>('room');
  const [view, setView] = useState<'cards' | 'timeline'>('cards');
  const [selectedId, setSelectedId] = useState('');
  const report = roomSchedule(state, date, time);
  const visible = report.resources.filter((resource) => resource.kind === filter);
  const selected = visible.find((resource) => resource.id === selectedId);
  const labels: Record<RoomStatus, string> = { free: t('Available', '空闲'), reserved: t('Reserved', '已安排'), in_service: t('In service', '服务中'), cleaning: t('Cleaning buffer', '清洁预留'), check: t('Needs staff check', '待员工核对'), closed: t('Shop closed', '已打烊') };
  const colors: Record<RoomStatus, string> = { free: styles.free, reserved: styles.reserved, in_service: styles.serving, cleaning: styles.cleaning, check: styles.check, closed: styles.closed };
  const startMinute = minuteValue(bookingSettings.firstTime);
  const totalMinutes = minuteValue(bookingSettings.closingTime) - startMinute;
  const dayStart = new Date(`${date}T00:00:00+08:00`).getTime();
  const timelineTime = (at: number) => at <= dayStart ? '00:00' : at >= dayStart + 86_400_000 ? '24:00' : shopTime(new Date(at));
  const cleanupLabel = (visit: RoomVisit) => visit.window.overdue
    ? t('Until staff completes treatment + 5 min cleaning', '待员工标记完成后再清洁5分钟')
    : t('Cleaning until', '清洁至') + ' ' + malaysiaDateValue(new Date(visit.window.cleanupEnd)) + ' ' + shopTime(new Date(visit.window.cleanupEnd));
  const position = (value: string) => Math.max(0, Math.min(100, (minuteValue(value) - startMinute) / totalMinutes * 100));
  function Visit({ visit }: { visit: RoomVisit }) { return <article className={styles.visit}><div><strong>{visit.assignment.start}–{visit.assignment.end}</strong><span>{cleanupLabel(visit)}</span></div><div><strong>{visit.guestName}</strong><span>{visit.treatment[locale]}</span><span>{visit.staffNumber} · {visit.therapist[locale]}</span><small>{visit.reference}</small></div>{onOpenBooking && <button onClick={() => onOpenBooking(visit.bookingId)}>{t('Manage booking', '管理预约')}</button>}</article>; }
  return <section className={styles.board} aria-label={t('Rooms and foot chairs', '房间与足椅')}>
    <OverrunWarnings state={state} locale={locale} onOpenBooking={onOpenBooking} />
    <div className={styles.metrics}><article><span>{t('Customers booked', '已预约顾客')}</span><strong>{report.customers}</strong><small>{report.bookings} {t('bookings · selected day', '笔预约 · 所选日期')}</small></article><article><span>{t('Available rooms', '空闲房间')}</span><strong>{report.freeRooms}<small> / {bookingSettings.massageBeds}</small></strong><small>{time} · {t('excludes cleaning', '不含清洁中')}</small></article><article><span>{t('Available foot chairs', '空闲足椅')}</span><strong>{report.freeChairs}<small> / {bookingSettings.footMassageChairs}</small></strong><small>{time}</small></article><article><span>{t('Available therapists', '空闲按摩师')}</span><strong>{report.availableTherapists}</strong><small>{t('On shift · not reserved', '上班中 · 无预约占用')}</small></article></div>
    {report.checks > 0 && <p className={styles.warning} role="status">{t('A treatment has passed its planned end or overlaps another booking. Check with the therapist before admitting another guest.', '有疗程已超过预计结束时间或出现重叠。安排下一位顾客前，请先与按摩师核对。')}</p>}
    <div className={styles.toolbar}><div className={styles.switch}><button aria-pressed={filter === 'room'} onClick={() => { setFilter('room'); setSelectedId(''); }}>{t('Rooms', '按摩房')} · {bookingSettings.massageBeds}</button><button aria-pressed={filter === 'chair'} onClick={() => { setFilter('chair'); setSelectedId(''); }}>{t('Foot chairs', '足椅')} · {bookingSettings.footMassageChairs}</button></div><div className={styles.switch}><button aria-pressed={view === 'cards'} onClick={() => setView('cards')}>{t('Room cards', '房间卡片')}</button><button aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>{t('Day timeline', '全天时间表')}</button></div></div>
    <p className={styles.note}>{t('Scheduled times · One bed per room · Empty rooms still need an available, qualified therapist.', '按预约时段显示 · 每房一张床 · 空房仍需有空且合适的按摩师。')}</p>
    {view === 'cards' ? <div className={styles.cards}>{visible.map((resource) => <button key={resource.id} className={styles.card + ' ' + colors[resource.status]} aria-expanded={selectedId === resource.id} onClick={() => setSelectedId(selectedId === resource.id ? '' : resource.id)}><div className={styles.cardTop}><strong>{resource.name[locale]}</strong><span>{labels[resource.status]}</span></div>{resource.active ? <><div className={styles.mainTime}>{resource.active.assignment.start}–{resource.active.assignment.end}</div><strong>{resource.active.guestName}</strong><span>{resource.active.staffNumber} · {resource.active.therapist[locale]}</span><p>{resource.active.treatment[locale]}</p><small>{resource.status === 'check' ? t('Confirm actual finish with staff', '请核对实际结束时间') : t('Reserved through cleaning until', '含清洁预留至')} {resource.status !== 'check' && resource.occupiedUntil}</small></> : <><div className={styles.mainTime}>{resource.status === 'closed' ? '—' : (report.live ? t('Free now', '当前空闲') : t('Available', '空闲'))}</div><p>{resource.next ? t('Free until', '空闲至') + ' ' + resource.next.assignment.start : t('No further bookings', '之后暂无预约')}</p></>}<div className={styles.next}>{resource.next ? <>{t('Next', '下一场')}: <strong>{resource.next.assignment.start}–{resource.next.assignment.end}</strong> · {resource.next.therapist[locale]}</> : t('No later booking', '之后暂无预约')}<span>{resource.schedule.length} {t('visits · selected day', '场 · 当日')}</span></div></button>)}</div> : <div className={styles.timelineScroll} tabIndex={0} role="region" aria-label={t('Scrollable room timetable', '可横向滚动的房间时间表')}><div className={styles.timeline}><div className={styles.timelineHeader}><strong>{filter === 'room' ? t('Room', '房间') : t('Chair', '足椅')}</strong><div>{Array.from({ length: 13 }, (_, index) => <span key={index} style={{ left: position((11 + index) + ':00') + '%' }}>{11 + index}:00</span>)}</div></div>{visible.map((resource) => <div key={resource.id} className={styles.timelineRow}><button className={styles.laneName} onClick={() => setSelectedId(resource.id)}>{resource.name[locale]}<small>{resource.schedule.length} {t('visits', '场')}</small></button><div className={styles.lane}>{resource.schedule.map((visit) => <div key={visit.key}><button className={styles.block + ' ' + (visit.status === 'completed' ? styles.completed : visit.status === 'in_service' ? styles.serving : styles.reserved)} style={{ left: position(timelineTime(visit.window.start)) + '%', width: (position(timelineTime(visit.window.overdue ? Infinity : visit.window.end)) - position(timelineTime(visit.window.start))) + '%' }} title={visit.assignment.start + '–' + visit.assignment.end + ' · ' + visit.guestName + ' · ' + visit.therapist[locale]} onClick={() => { setSelectedId(resource.id); if (onOpenBooking) onOpenBooking(visit.bookingId); }}><strong>{visit.assignment.start}–{visit.assignment.end}</strong><span>{visit.guestName}</span><span>{visit.staffNumber} · {visit.therapist[locale]}</span></button><span className={styles.cleaningBlock} style={{ left: position(timelineTime(visit.window.overdue ? Infinity : visit.window.end)) + '%', width: (position(timelineTime(visit.window.cleanupEnd)) - position(timelineTime(visit.window.overdue ? Infinity : visit.window.end))) + '%' }} title={cleanupLabel(visit)} /></div>)}{time >= bookingSettings.firstTime && time <= bookingSettings.closingTime && <span className={styles.nowLine} style={{ left: position(time) + '%' }} title={time} />}</div></div>)}</div></div>}
    {selected && <section className={styles.details}><header><h3>{selected.name[locale]} · {t('Day schedule', '当日安排')}</h3><button onClick={() => setSelectedId('')}>{t('Close', '关闭')}</button></header>{!selected.schedule.length ? <p>{t('No bookings for this space on the selected day.', '此位置当日暂无预约。')}</p> : selected.schedule.map((visit) => <Visit key={visit.key} visit={visit} />)}</section>}
  </section>;
}

export function BossRooms({ locale, onUnauthorized }: { locale: Locale; onUnauthorized: () => void }) {
  const t = (en: string, zh: string) => locale === 'zh' ? zh : en;
  const [state, setState] = useState<StaffState | null>(null);
  const [date, setDate] = useState(malaysiaDateValue);
  const [snapshot, setSnapshot] = useState('');
  const [clock, setClock] = useState(shopTime);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const update = async () => { try {
      const session = await getDemoSession();
      if (!active) return;
      if (session?.role !== 'owner') { setState(null); onUnauthorized(); return; }
      const next = await loadStaffDemoState();
      if (active) { setState(next); setClock(shopTime()); setError(''); }
    } catch (cause) { if (!active) return; if (cause instanceof DemoApiError && [401,403].includes(cause.status)) { setState(null); onUnauthorized(); } else setError(locale === 'zh' ? '暂时无法刷新，显示上次的房间记录。' : 'Unable to refresh. Showing the last room records.'); } };
    void update(); const timer = window.setInterval(() => { void update(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [locale, onUnauthorized, retry]);
  const time = snapshot || (date === malaysiaDateValue() ? clock : '14:00');
  return <section className={styles.bossRooms}><h1>{t('Rooms & occupancy', '房间与预约')}</h1><div className={styles.controls}><label>{t('Date', '日期')}<input type="date" value={date} onChange={(event) => { if (event.target.value) { setDate(event.target.value); setSnapshot(''); } }} /></label><label>{t('View at', '查看时间')}<input type="time" value={time} onChange={(event) => setSnapshot(event.target.value)} /></label><button onClick={() => { setDate(malaysiaDateValue()); setSnapshot(''); setClock(shopTime()); }}>{t('Now', '现在')}</button><button onClick={() => setRetry((value) => value + 1)}>{t('Refresh', '刷新')}</button><span>{t('Updates every 15s · Malaysia time', '每 15 秒更新 · 马来西亚时间')}</span></div>{error && <p role="alert" className={styles.warning}>{error}</p>}{state ? <RoomBoard state={state} date={date} time={time} locale={locale} /> : <p role="status">{t('Loading room schedule…', '正在载入房间安排…')}</p>}</section>;
}
