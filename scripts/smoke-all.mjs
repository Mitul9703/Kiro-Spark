// Run every smoke script in parallel and print a one-line OK/FAIL summary.
// Usage: node scripts/smoke-all.mjs
// Override target via SPARK_HTTP_URL=http://host:port (forwarded to children).

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const here = path.resolve('scripts');
const scripts = fs
  .readdirSync(here)
  .filter((name) => name.startsWith('smoke-') && name.endsWith('.mjs') && name !== 'smoke-all.mjs')
  .sort();

if (!scripts.length) {
  console.error('no smoke scripts found under', here);
  process.exit(1);
}

function run(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, name)], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => resolve({ name, code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const results = await Promise.all(scripts.map(run));
let failed = 0;
for (const r of results) {
  const status = r.code === 0 ? 'OK   ' : 'FAIL ';
  const detail = r.code === 0 ? r.stdout.split('\n').pop() : (r.stderr.split('\n').pop() || `exit ${r.code}`);
  console.log(`${status} ${r.name.padEnd(36)} ${detail}`);
  if (r.code !== 0) failed += 1;
}

console.log('---');
console.log(`${results.length - failed} OK · ${failed} FAIL`);
process.exit(failed ? 1 : 0);
