import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SupportReply } from '../app/support-types.ts';
import { configuredSupportProvider, type SupportProvider } from './support-provider.ts';
import { guardedIntent, parseSupportQuery, redactSupportText, renderSupportReply, replyLocale, SupportError, validateSupportRequest } from './support-knowledge.ts';

// No reference to SQLite, authenticated users, booking state or privileged APIs.
export function createSupportService(options: { provider?: SupportProvider; timeoutMs?: number; now?: () => number } = {}) {
  const provider = options.provider ?? configuredSupportProvider();
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const clients = new Map<string, { count: number; until: number }>();
  let hourly = { count: 0, until: 0 }; let active = 0;
  function limit(client: string) {
    const time = now();
    for (const [key, value] of clients) if (value.until <= time) clients.delete(key);
    // Never trust forwarded IP headers supplied by a caller. The local proxy
    // means browsers may share this conservative per-address allowance.
    const key = createHash('sha256').update(client).digest('hex');
    if (hourly.until <= time) hourly = { count: 0, until: time + 3_600_000 };
    const counter = clients.get(key) ?? { count: 0, until: time + 600_000 };
    if (active >= 3 || hourly.count >= 120 || counter.count >= 20 || (!clients.has(key) && clients.size >= 1024)) throw new SupportError(429, 'rate_limited');
    counter.count++; clients.set(key, counter); hourly.count++;
  }
  async function reply(raw: unknown, client: string): Promise<SupportReply> {
    if (provider.mode === 'disabled') throw new SupportError(503, 'disabled');
    const request = validateSupportRequest(raw);
    limit(client);
    const locale = replyLocale(request);
    const guard = guardedIntent(request.message);
    if (guard) return renderSupportReply({ intent: guard, categories: [], minutes: 0 }, locale, provider.mode);
    const safe = { ...request, message: redactSupportText(request.message), history: request.history.map(redactSupportText) };
    active++;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SupportError(504, 'timeout')); }, timeoutMs); });
      const query = parseSupportQuery(await Promise.race([provider.interpret(safe, controller.signal), timeout]));
      return renderSupportReply(query, locale, provider.mode);
    } catch (error) {
      if (error instanceof SupportError) throw error;
      throw new SupportError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'timeout' : 'provider_failure');
    } finally { clearTimeout(timer); active--; }
  }
  return { mode: provider.mode, reply };
}

function readSupportBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const finish = (error?: SupportError) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', failed);
      if (error) { req.resume(); reject(error); }
    };
    const failed = () => finish(new SupportError(400, 'invalid_request'));
    const data = (chunk: Buffer) => { size += chunk.length; if (size > 20_000) finish(new SupportError(413, 'too_large')); else chunks.push(chunk); };
    const end = () => { finish(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new SupportError(400, 'invalid_request')); } };
    const timer = setTimeout(() => finish(new SupportError(408, 'timeout')), 5000);
    req.on('data', data); req.on('end', end); req.on('error', failed); req.on('aborted', failed);
  });
}

export function supportHandler(service = createSupportService()) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/api/demo/support' && path !== '/api/demo/support/config') return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '600' } : {}) });
      res.end(JSON.stringify(body));
    };
    try {
      if (path.endsWith('/config') && req.method === 'GET') send(200, { mode: service.mode, enabled: service.mode !== 'disabled' });
      else if (path === '/api/demo/support' && req.method === 'POST') {
        if (req.headers['x-demo-client'] !== 'serene-local' || !req.headers['content-type']?.startsWith('application/json')) throw new SupportError(403, 'invalid_client');
        if (req.headers.origin && !['http://127.0.0.1:3000', 'http://localhost:3000'].includes(req.headers.origin)) throw new SupportError(403, 'invalid_client');
        send(200, await service.reply(await readSupportBody(req), req.socket.remoteAddress ?? 'local'));
      } else send(405, { error: 'method_not_allowed' });
    } catch (error) {
      // Deliberately never log raw errors, messages, credentials or responses.
      const safe = error instanceof SupportError ? error : new SupportError(503, 'unavailable');
      send(safe.status, { error: safe.code });
    }
    return true;
  };
}
