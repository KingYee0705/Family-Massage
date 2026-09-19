import { resolve } from 'node:path';
import { configuredSupportProvider, mockProvider, type SupportProvider } from './support-provider.ts';
import { createSupportService } from './support-service.ts';
import { supportEvaluation } from './support-eval-data.ts';

// Opt-in only: the default never loads credentials or sends external requests.
const real = process.argv.includes('--real');
if (real && !process.argv.includes('--allow-paid')) throw new Error('Real evaluation may incur charges. Supply --real --allow-paid only after reviewing the dataset and provider account.');
if (real) { try { process.loadEnvFile(resolve('.env.support.local')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to load local support configuration.'); } }
const provider = real ? configuredSupportProvider() : mockProvider;
if (real && provider.mode !== 'openai') throw new Error('Real evaluation requires an explicitly configured real provider, model and server credential.');
let calls = 0;
const counted: SupportProvider = { mode: provider.mode, interpret: (request, signal) => { calls++; return provider.interpret(request, signal); } };
const service = createSupportService({ provider: counted });
let passed = 0; const latencies: number[] = [];
for (const sample of supportEvaluation) {
  const start = performance.now();
  try {
    const reply = await service.reply(sample.request, sample.id);
    const ok = sample.includes.every((text) => reply.text.includes(text)) && (sample.excludes ?? []).every((text) => !reply.text.includes(text))
      && (sample.handoff === undefined || sample.handoff === reply.handoff) && (sample.bookingLink === undefined || sample.bookingLink === reply.bookingLink);
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${sample.id}`);
  } catch { console.log(`ERROR ${sample.id} (provider unavailable or invalid response)`); }
  latencies.push(Math.round(performance.now() - start));
}
latencies.sort((a, b) => a - b);
console.log(JSON.stringify({ mode: provider.mode, passed, total: supportEvaluation.length, providerCalls: calls, p95Ms: latencies[Math.ceil(latencies.length * .95) - 1] }));
if (passed !== supportEvaluation.length) process.exitCode = 1;
