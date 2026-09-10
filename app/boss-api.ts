import type { BossDeductionInput, BossMonthReport } from './boss-types.ts';
import { DemoApiError } from './demo-booking.ts';

async function bossRequest(path: string, method = 'GET', body?: unknown): Promise<BossMonthReport> {
  let response: Response;
  try {
    response = await fetch(`/api/demo/boss${path}`, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Client': 'serene-local' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new DemoApiError('The local demo server is unavailable. Please retry.'); }
  let data: BossMonthReport & { error?: string };
  try { data = await response.json(); }
  catch { throw new DemoApiError('The local demo server is unavailable.'); }
  if (!response.ok) throw new DemoApiError(data.error ?? 'Unable to update the monthly statement.', response.status);
  return data;
}

export const loadBossMonth = (month: string, statementId?: string) => bossRequest(`/month?month=${encodeURIComponent(month)}${statementId ? `&statementId=${encodeURIComponent(statementId)}` : ''}`);
export const saveBossDeductions = (month: string, therapistId: string, input: BossDeductionInput) => bossRequest(`/month/${encodeURIComponent(month)}/therapists/${encodeURIComponent(therapistId)}`, 'PATCH', input);
export const saveBossStatement = (month: string, expectedRevision: string) => bossRequest(`/month/${encodeURIComponent(month)}/close`, 'POST', { expectedRevision });
export const reopenBossMonth = (month: string, expectedRevision: string, reason: string) => bossRequest(`/month/${encodeURIComponent(month)}/reopen`, 'POST', { expectedRevision, reason });
