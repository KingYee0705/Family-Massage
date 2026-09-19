'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { business, type Locale } from './catalog';
import { SUPPORT_MAX_HISTORY, SUPPORT_MAX_MESSAGE, type SupportMode, type SupportReply } from './support-types';
import styles from './support-chat.module.css';

type Message = { role: 'user' | 'assistant'; text: string; reply?: SupportReply };

export default function SupportChat({ locale }: { locale: Locale }) {
  const t = (en: string, zh: string) => locale === 'zh' ? zh : en;
  const [mode, setMode] = useState<SupportMode | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/demo/support/config', { credentials: 'omit', signal: controller.signal })
      .then(async (response) => { if (!response.ok) return; const data = await response.json() as { mode?: SupportMode }; if (data.mode && ['mock', 'openai', 'disabled'].includes(data.mode)) setMode(data.mode); })
      .catch(() => { /* Opening chat will offer retry and staff contact. */ });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, pending, error]);
  function close() { dialog.current?.close(); launcher.current?.focus({ preventScroll: true }); }
  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || request.current) return;
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 16_000);
    setPending(message); setInput(''); setError('');
    try {
      const response = await fetch('/api/demo/support', {
        method: 'POST', credentials: 'omit', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Demo-Client': 'serene-local' },
        body: JSON.stringify({ message, locale, history: messages.filter((entry) => entry.role === 'user').slice(-SUPPORT_MAX_HISTORY).map((entry) => entry.text) }),
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error(t('Chat request limit reached. Please wait up to one hour or contact staff.', '聊天请求已达上限，请稍后（最长一小时）再试，或联系店员。'));
        throw new Error(t('Support is unavailable right now. Your question has been restored below. Try again or contact staff; bookings still work normally.', '客服暂时无法使用，您的问题已恢复到输入框。请重试或联系店员，正常预约不受影响。'));
      }
      const reply: SupportReply = await response.json();
      if (typeof reply.text !== 'string' || reply.text.length > 16_000 || !['mock', 'openai'].includes(reply.mode)) throw new Error(t('Invalid support response. Please try again.', '客服回复异常，请重试。'));
      setMode(reply.mode);
      setMessages((previous) => [...previous, { role: 'user' as const, text: message }, { role: 'assistant' as const, text: reply.text, reply }].slice(-20));
    } catch (cause) {
      setInput(message);
      setError(controller.signal.aborted ? t('The reply took too long. Please retry or contact staff.', '回复超时，请重试或联系店员。') : cause instanceof Error && cause.message !== 'Failed to fetch' ? cause.message : t('Cannot connect to support. Please retry or contact staff.', '无法连接客服，请重试或联系店员。'));
    } finally { window.clearTimeout(timeout); request.current = null; setPending(''); }
  }
  if (mode === 'disabled') return null;
  return <>
    <button ref={launcher} type="button" className={styles.launcher} aria-haspopup="dialog" aria-controls="support-chat" onClick={() => { dialog.current?.showModal(); field.current?.focus({ preventScroll: true }); }}>
      <span aria-hidden="true">?</span> {t('Ask about services', '咨询疗程')}
    </button>
    <dialog ref={dialog} id="support-chat" className={styles.dialog} aria-labelledby="support-title" aria-describedby="support-privacy" onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => launcher.current?.focus({ preventScroll: true })}>
      <div className={styles.layout} lang={locale === 'zh' ? 'zh-Hans' : 'en'}>
        <header className={styles.header}><div><h2 id="support-title">{t('Service support', '疗程咨询')}</h2><span>{mode === 'mock' ? t('DEMO · Scripted replies, not a live AI', '演示 · 规则回复，非真实 AI') : mode === 'openai' ? t('AI-assisted catalogue support', 'AI 辅助菜单咨询') : t('Connecting to support', '正在连接客服')}</span></div><button type="button" aria-label={t('Close chat', '关闭聊天')} onClick={close}>×</button></header>
        <p id="support-privacy" className={styles.notice}>{mode === 'openai' ? t('Questions are sent to an external AI provider. ', '问题将发送至外部 AI 服务。') : ''}{t('Do not share personal, payment or medical details. No bookings are made here. Only recent questions are used; refresh or clear to forget this chat.', '请勿提供个人、付款或医疗资料。这里不办理预约。仅使用近期问题作为上下文，刷新或清空即可清除此聊天。')}</p>
        <div ref={log} className={styles.log} role="log" aria-label={t('Support conversation', '客服对话')} aria-live="polite" aria-relevant="additions text" tabIndex={0}>
          {!messages.length && <p className={styles.welcome}>{t('How can I help? Try “How much is a 60-minute Thai massage?” or “有哪些附加项目？”', '您好！试着问：“60分钟泰式按摩多少钱？” 或 “What add-ons are available?”')}</p>}
          {messages.map((message, index) => <article key={index} className={message.role === 'user' ? styles.user : styles.assistant}><strong>{message.role === 'user' ? t('You', '您') : message.reply?.mode === 'mock' ? t('Demo support', '演示客服') : t('Support', '客服')}</strong><p>{message.text}</p>{Boolean(message.reply?.sources.length) && <small>{t('Source: current service catalogue', '来源：当前服务菜单')}</small>}{message.reply?.bookingLink && <button type="button" onClick={close}>{t('Continue in the booking form', '返回预约表格')}</button>}{message.reply?.handoff && <a href={`https://wa.me/${business.whatsappNumber}`} target="_blank" rel="noopener noreferrer">{t('Ask shop staff', '联系店员')} ↗</a>}</article>)}
          {pending && <><article className={styles.user}><strong>{t('You', '您')}</strong><p>{pending}</p></article><p role="status">{t('Finding approved information…', '正在查询已核实信息…')}</p></>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
        <form className={styles.form} onSubmit={send}><label htmlFor="support-question">{t('Your question', '您的问题')}</label><textarea ref={field} id="support-question" rows={2} maxLength={SUPPORT_MAX_MESSAGE} value={input} onChange={(event) => setInput(event.target.value)} disabled={Boolean(pending)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div className={styles.actions}><small>{input.length}/{SUPPORT_MAX_MESSAGE}</small><button type="submit" disabled={Boolean(pending) || !input.trim()}>{pending ? t('Please wait…', '请稍候…') : t('Send', '发送')}</button></div></form>
        <footer className={styles.footer}><button type="button" disabled={Boolean(pending)} onClick={() => { setMessages([]); setInput(''); setError(''); field.current?.focus(); }}>{t('Clear conversation', '清空聊天')}</button><a href={`https://wa.me/${business.whatsappNumber}`} target="_blank" rel="noopener noreferrer">{t('Contact staff', '联系店员')} ↗</a></footer>
      </div>
    </dialog>
  </>;
}
