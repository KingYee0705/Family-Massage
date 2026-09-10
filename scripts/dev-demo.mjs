import { spawn } from 'node:child_process';
import { dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
  DEMO_API_PORT: process.env.DEMO_API_PORT ?? '4311',
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 400).unref();
}
function launch(args) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
  return child;
}
launch(['scripts/demo-server.ts']);
const deadline = Date.now() + 15_000;
let ready = false;
while (!ready && Date.now() < deadline && !stopping) {
  try {
    ready = (await fetch(`http://127.0.0.1:${env.DEMO_API_PORT}/api/demo/public-state`)).ok;
  } catch { /* Wait briefly for the local database to initialise. */ }
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 150));
}
if (ready) {
  launch(['node_modules/vinext/dist/cli.js', 'dev']);
  console.log('\nCustomer demo: http://127.0.0.1:3000\nStaff dashboard: http://127.0.0.1:3000/staff\nBoss dashboard: http://127.0.0.1:3000/boss\nLocal test data only. Press Ctrl+C to stop.\n');
} else if (!stopping) {
  console.error('The demo API did not start. Check the error above.');
  stop(1);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
