// Smoke test for POST /api/compare-sessions.
// The dev server must be running (npm run dev) before invoking this script.
// Usage: node scripts/smoke-compare-sessions.mjs
// Override target via SPARK_HTTP_URL=http://host:port

const url = process.env.SPARK_HTTP_URL ?? 'http://localhost:3000';
const now = Date.now();

function fixtureMetrics(base) {
  return [
    { label: 'Communication clarity', value: base, justification: 'fixture' },
    { label: 'Impact storytelling', value: Math.max(0, base - 6), justification: 'fixture' },
    { label: 'Ownership signals', value: Math.max(0, base - 11), justification: 'fixture' },
    { label: 'Role fit', value: Math.max(0, base - 2), justification: 'fixture' },
  ];
}

function fixtureSession({ id, score, endedAtOffsetMs }) {
  // Send the same payload under both `evaluation.<field>` (teammate's contract on origin/main)
  // and `evaluation.result.<field>` (our local /api/compare-sessions contract). Whichever path
  // the running server expects will work.
  const evalBody = {
    score,
    summary: `Session ${id}`,
    metrics: fixtureMetrics(score),
    strengths: ['narrative is clear'],
    improvements: ['tighten metrics'],
    recommendations: [],
    resourceBriefs: [],
  };
  return {
    id,
    startedAt: new Date(now - endedAtOffsetMs - 600_000).toISOString(),
    endedAt: new Date(now - endedAtOffsetMs).toISOString(),
    durationLabel: '10:00',
    evaluation: { ...evalBody, result: evalBody },
  };
}

const body = {
  agentSlug: 'recruiter',
  currentSession: fixtureSession({ id: 'sess-current', score: 82, endedAtOffsetMs: 0 }),
  baselineSession: fixtureSession({ id: 'sess-baseline', score: 64, endedAtOffsetMs: 3 * 24 * 3600 * 1000 }),
};

const res = await fetch(`${url}/api/compare-sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const json = await res.json();
const cmp = json.comparison;
if (!cmp || typeof cmp !== 'object') { console.error('missing comparison', json); process.exit(1); }

const allowedTrend = new Set(['improved', 'mixed', 'similar', 'declined']);
if (!allowedTrend.has(cmp.trend)) { console.error('invalid trend', cmp.trend); process.exit(1); }
if (!Array.isArray(cmp.metrics) || cmp.metrics.length !== 4) {
  console.error('metrics length expected 4 got', cmp.metrics?.length, cmp);
  process.exit(1);
}
for (const m of cmp.metrics) {
  if (typeof m.delta !== 'number') { console.error('metric.delta not number', m); process.exit(1); }
  if (!['improved', 'declined', 'similar'].includes(m.trend)) {
    console.error('metric.trend invalid', m); process.exit(1);
  }
}
console.log('OK trend=%s metrics=%d %s',
  cmp.trend,
  cmp.metrics.length,
  json.error ? `(fallback: ${json.error})` : '(gemini-backed)');
