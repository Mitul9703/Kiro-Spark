// Smoke test for POST /api/evaluate-session.
// The dev server must be running (npm run dev) before invoking this script.
// Usage: node scripts/smoke-evaluate-session.mjs
// Override target via SPARK_HTTP_URL=http://host:port

import fs from 'node:fs';
const url = process.env.SPARK_HTTP_URL ?? 'http://localhost:3000';
const body = {
  agentSlug: 'recruiter',
  transcript: [
    { role: 'Agent', text: 'Walk me through your most recent project.' },
    { role: 'User', text: 'I led a team of three on a payments redesign that cut p99 latency by 40%.' },
  ],
  durationLabel: '04:12',
  startedAt: new Date(Date.now() - 252_000).toISOString(),
  endedAt: new Date().toISOString(),
};
const res = await fetch(`${url}/api/evaluate-session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const json = await res.json();
if (typeof json.evaluation?.score !== 'number') { console.error('missing evaluation.score', json); process.exit(1); }
if (!Array.isArray(json.evaluation?.metrics) || json.evaluation.metrics.length < 1) { console.error('metrics missing', json); process.exit(1); }
console.log('OK score=%d metrics=%d', json.evaluation.score, json.evaluation.metrics.length);
