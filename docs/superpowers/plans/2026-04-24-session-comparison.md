# Session Comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-initiated side-by-side comparison flow — a baseline-session picker on the session detail page that calls `/api/compare-sessions` and renders metric deltas with Gemini-generated insights.

**Architecture:** A single stateless POST endpoint computes mechanical metric deltas with the >4 / <-4 trend rule, then asks Gemini 2.5-flash for an overall trend label, summary, and per-metric insight; mechanical fallback runs if Gemini fails. Frontend adds a comparison panel that filters eligible baselines to other completed sessions in the same thread.

**Tech Stack:** Express 5, @google/genai, plain JavaScript, React 19.

---

## Prerequisites

Depends on:

- **evaluation-engine plan** — each session record must carry `evaluation.status === 'completed'` with `evaluation.result.metrics = [{ label, value, justification }]` and a numeric `evaluation.result.score`. This feature only reads those values; it never triggers or mutates the evaluation.
- **agents-and-threads plan** — `AppProvider`, the state shape keyed by agent slug (`state.sessions[slug][i]`), the `patchSession(slug, sessionId, patch)` mutator, the `jobs = useRef(new Map())` ref for in-flight `AbortController`s, and the `spark-state-v1` localStorage round-trip. This plan adds a new `comparison` sub-record and one new mutator; it does not touch any existing mutator.
- **agents-and-threads plan** — `components/session-detail-page.js` chrome (back button, evaluation card block, transcript block). This plan inserts a new Comparison panel between the evaluation block and the transcript block.

## File Map

- `server/comparison.js` — new. `compareSessions(req, res)` handler plus pure helpers `computeDeltas`, `composePrompt`, `normalizeComparison`, `mechanicalFallback`, `resolveGeminiKey`.
- `server.js` — add one import and one `app.post('/api/compare-sessions', compareSessions)` line.
- `components/app-provider.js` — add `comparison` default sub-record, a `SET_COMPARISON` action, and a `runComparison(slug, sessionId, baselineSessionId)` mutator using `jobs.current` keyed `comparison:${sessionId}`.
- `components/session-detail-page.js` — import and render `<ComparisonPanel/>` between the evaluation block and the transcript block.
- `components/comparison-panel.js` — new. Owns the dropdown, Compare button, spinner, trend chip, and metric table.
- `scripts/fixtures/eval-current.json` — new. Four-metric completed-session fixture for the smoke script.
- `scripts/fixtures/eval-baseline.json` — new. Matching four-metric baseline fixture.
- `scripts/smoke-compare-sessions.mjs` — new. Hits `/api/compare-sessions` with the fixtures and asserts response shape.

## Tasks

### Task 1 — `server/comparison.js` skeleton + `computeDeltas` pure function

- [ ] Create `server/comparison.js` with the skeleton below. Implement `computeDeltas` fully; leave the handler body as a 501 stub for now.

```js
// server/comparison.js
import { GoogleGenAI } from '@google/genai';

const ALLOWED_TRENDS = ['improved', 'mixed', 'similar', 'declined'];

export function computeDeltas(currentMetrics, baselineMetrics) {
  const baselineByLabel = new Map(
    (baselineMetrics || []).map((m) => [m.label, Number(m.value)])
  );
  const deltas = [];
  for (const cur of currentMetrics || []) {
    if (!baselineByLabel.has(cur.label)) continue;
    const currentValue = Number(cur.value);
    const baselineValue = baselineByLabel.get(cur.label);
    const delta = currentValue - baselineValue;
    const trend =
      delta > 4 ? 'improved' : delta < -4 ? 'declined' : 'similar';
    deltas.push({
      label: cur.label,
      currentValue,
      baselineValue,
      delta,
      trend,
      insight: '',
    });
  }
  return deltas;
}

export async function compareSessions(req, res) {
  return res.status(501).json({ error: 'not implemented' });
}
```

- [ ] Smoke-verify by importing the module in a throwaway node one-liner:

```
node -e "import('./server/comparison.js').then(m => console.log(m.computeDeltas([{label:'A',value:80},{label:'B',value:70}],[{label:'A',value:72},{label:'B',value:74}])))"
```

Expected: `[{label:'A',currentValue:80,baselineValue:72,delta:8,trend:'improved',insight:''},{label:'B',currentValue:70,baselineValue:74,delta:-4,trend:'similar',insight:''}]`.

### Task 2 — `composePrompt(currentEval, baselineEval, deltas)`

- [ ] Add `composePrompt` to `server/comparison.js`. It returns the string sent to Gemini and strictly follows the template in `session-comparison/design.md §4.1`. Include metric labels verbatim from `deltas` so the model returns matching keys.

```js
export function composePrompt({ agentSlug, currentSession, baselineSession, deltas }) {
  const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const lines = [];
  lines.push('You are a rehearsal-performance analyst comparing two practice sessions.');
  lines.push('');
  lines.push(`AGENT: ${agentSlug}`);
  lines.push('');
  lines.push(
    `BASELINE SESSION (${baselineSession.durationLabel ?? ''} on ${fmtDate(baselineSession.endedAt)})`
  );
  lines.push(`Overall score: ${baselineSession.evaluation.result?.score ?? baselineSession.evaluation.score}`);
  lines.push('Metrics:');
  for (const m of baselineSession.evaluation.result?.metrics ?? baselineSession.evaluation.metrics) {
    lines.push(`- ${m.label}: ${m.value}`);
  }
  lines.push('');
  lines.push(
    `CURRENT SESSION (${currentSession.durationLabel ?? ''} on ${fmtDate(currentSession.endedAt)})`
  );
  lines.push(`Overall score: ${currentSession.evaluation.result?.score ?? currentSession.evaluation.score}`);
  lines.push('Metrics:');
  for (const m of currentSession.evaluation.result?.metrics ?? currentSession.evaluation.metrics) {
    lines.push(`- ${m.label}: ${m.value}`);
  }
  lines.push('');
  lines.push('MECHANICAL DELTAS (currentValue - baselineValue):');
  for (const d of deltas) {
    lines.push(`- ${d.label}: ${d.delta} (${d.trend})`);
  }
  lines.push('');
  lines.push('Respond with a single JSON object and nothing else. Do not wrap it in markdown fences.');
  lines.push('');
  lines.push('{');
  lines.push('  "overallTrend":  "improved" | "mixed" | "similar" | "declined",');
  lines.push('  "summary":       "1-2 sentences describing the overall change.",');
  lines.push('  "metricInsights": {');
  lines.push('    "<metric label>": "one sentence explaining why this metric moved as it did"');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('Rules:');
  lines.push('- overallTrend must be "mixed" only if some metrics improved by more than 4 and others declined by more than 4.');
  lines.push('- summary must not invent specific quotes or timestamps.');
  lines.push('- Every metric label listed above must appear as a key in metricInsights.');
  return lines.join('\n');
}
```

- [ ] Verify by logging the output for the fixtures added in Task 7. No assertion needed; eyeball the four metric labels are present both in the metrics section and the deltas section.

### Task 3 — `normalizeComparison(raw, deltas)`

- [ ] Add `normalizeComparison` to `server/comparison.js`. Input `raw` is whatever Gemini returned (possibly a string with fences). Strip fences, `JSON.parse`, then merge per-metric insights into `deltas`. Clamp `overallTrend` to the four allowed values; default `summary` to a generic string.

```js
export function normalizeComparison(raw, deltas) {
  let parsed = raw;
  if (typeof raw === 'string') {
    const stripped = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    parsed = JSON.parse(stripped);
  }
  const trend = ALLOWED_TRENDS.includes(parsed?.overallTrend)
    ? parsed.overallTrend
    : null;
  if (!trend) throw new Error('invalid overallTrend');
  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : 'Comparison summary unavailable.';
  const insights = parsed.metricInsights ?? {};
  const metrics = deltas.map((d) => ({
    ...d,
    insight: typeof insights[d.label] === 'string' ? insights[d.label] : '',
  }));
  return { trend, summary, metrics };
}
```

- [ ] Verify by feeding it a hand-crafted raw string matching the schema and the Task 1 deltas; confirm output has four metrics each with a non-empty `insight`.

### Task 4 — `mechanicalFallback(deltas)`

- [ ] Add `mechanicalFallback` to `server/comparison.js`. Compute `overallTrend` from the average delta using the same `>4 / <-4` thresholds; set `summary` to a canned string; leave each `insight` as `''`.

```js
export function mechanicalFallback(deltas) {
  const avg =
    deltas.length === 0
      ? 0
      : deltas.reduce((s, d) => s + d.delta, 0) / deltas.length;
  const trend = avg > 4 ? 'improved' : avg < -4 ? 'declined' : 'similar';
  return {
    trend,
    summary: 'Automated summary unavailable; showing metric deltas only.',
    metrics: deltas.map((d) => ({ ...d, insight: '' })),
  };
}
```

- [ ] Verify via a quick node REPL call with deltas of average +8 (expect `'improved'`), -10 (expect `'declined'`), +2 (expect `'similar'`).

### Task 5 — `compareSessions(req, res)` full handler

- [ ] Replace the 501 stub with the full handler. Validate input in the order specified in `session-comparison/design.md §2.3`: required fields → id mismatch → both completed → agent slug match → at least one shared metric label. On any failure: 400 with `{ error, details:{ field } }`. On success: call Gemini with `gemini-2.5-flash`; on any throw or normalization failure, fall back mechanically and include `error:'gemini_failed'`. Always 200 on the non-validation path.

```js
function resolveGeminiKey() {
  return process.env.GEMINI_EVALUATION_API_KEY || process.env.GEMINI_API_KEY || '';
}

export async function compareSessions(req, res) {
  const { agentSlug, currentSession, baselineSession } = req.body || {};

  if (!agentSlug || !currentSession || !baselineSession) {
    return res.status(400).json({
      error: 'missing required fields',
      details: { field: !agentSlug ? 'agentSlug' : !currentSession ? 'currentSession' : 'baselineSession' },
    });
  }
  if (currentSession.id === baselineSession.id) {
    return res.status(400).json({ error: 'current and baseline must differ' });
  }
  const curEval = currentSession.evaluation;
  const baseEval = baselineSession.evaluation;
  if (curEval?.status !== 'completed') {
    return res.status(400).json({
      error: 'current session is not completed',
      details: { field: 'currentSession.evaluation.status' },
    });
  }
  if (baseEval?.status !== 'completed') {
    return res.status(400).json({
      error: 'baseline session is not completed',
      details: { field: 'baselineSession.evaluation.status' },
    });
  }
  if (
    (currentSession.agentSlug && currentSession.agentSlug !== agentSlug) ||
    (baselineSession.agentSlug && baselineSession.agentSlug !== agentSlug) ||
    (currentSession.agentSlug &&
      baselineSession.agentSlug &&
      currentSession.agentSlug !== baselineSession.agentSlug)
  ) {
    return res.status(400).json({ error: 'agent mismatch' });
  }

  const currentMetrics = curEval.result?.metrics ?? curEval.metrics ?? [];
  const baselineMetrics = baseEval.result?.metrics ?? baseEval.metrics ?? [];
  const deltas = computeDeltas(currentMetrics, baselineMetrics);
  if (deltas.length === 0) {
    return res.status(400).json({
      error: 'no shared metric labels between sessions',
      details: { field: 'evaluation.metrics' },
    });
  }

  const apiKey = resolveGeminiKey();
  if (!apiKey) {
    return res
      .status(200)
      .json({ comparison: mechanicalFallback(deltas), error: 'gemini_unavailable' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = composePrompt({ agentSlug, currentSession, baselineSession, deltas });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0.3 },
    });
    const text = response?.text ?? response?.response?.text?.() ?? '';
    const comparison = normalizeComparison(text, deltas);
    return res.status(200).json({ comparison });
  } catch (err) {
    console.error('[compare-sessions] gemini failure', err?.message);
    return res
      .status(200)
      .json({ comparison: mechanicalFallback(deltas), error: 'gemini_failed' });
  }
}
```

- [ ] Verify by hand: start the dev server, `curl -X POST http://localhost:3000/api/compare-sessions -H 'content-type: application/json' -d @scripts/fixtures/eval-current.json` once the fixtures and the route mount (next task) are in place.

### Task 6 — Mount `POST /api/compare-sessions` in `server.js`

- [ ] Add the import beside the other `server/*.js` imports and mount the route beside the evaluation routes.

```js
import { compareSessions } from './server/comparison.js';

// ...inside the express setup, alongside other /api routes:
app.post('/api/compare-sessions', compareSessions);
```

- [ ] Verify by running the dev server and hitting `curl -i -X POST http://localhost:3000/api/compare-sessions -H 'content-type: application/json' -d '{}'` — expect HTTP 400 with `{ error: 'missing required fields', details: { field: 'agentSlug' } }`.

### Task 7 — Fixtures + smoke script

- [ ] Create `scripts/fixtures/eval-current.json` as a complete request body for the recruiter agent with four metrics. Scores chosen so two improve, one declines (by more than 4), one stays similar — yielding a mixed/improved overall trend.

```json
{
  "agentSlug": "recruiter",
  "currentSession": {
    "id": "session-1735000002000-ee11ff22",
    "agentSlug": "recruiter",
    "startedAt": 1735000002000,
    "endedAt": 1735000302000,
    "durationLabel": "5m 00s",
    "evaluation": {
      "status": "completed",
      "result": {
        "score": 78,
        "metrics": [
          { "label": "Impact clarity", "value": 82 },
          { "label": "Structure",      "value": 74 },
          { "label": "Role fit",       "value": 80 },
          { "label": "Delivery",       "value": 76 }
        ]
      }
    }
  },
  "baselineSession": {
    "id": "session-1734900001000-aabbccdd",
    "agentSlug": "recruiter",
    "startedAt": 1734900001000,
    "endedAt": 1734900241000,
    "durationLabel": "4m 00s",
    "evaluation": {
      "status": "completed",
      "result": {
        "score": 68,
        "metrics": [
          { "label": "Impact clarity", "value": 70 },
          { "label": "Structure",      "value": 78 },
          { "label": "Role fit",       "value": 66 },
          { "label": "Delivery",       "value": 60 }
        ]
      }
    }
  }
}
```

- [ ] Create `scripts/fixtures/eval-baseline.json` with `currentSession.id` replaced by the same id as `baselineSession.id` — the smoke script reuses this file to prove the same-id rejection path.

```json
{
  "agentSlug": "recruiter",
  "currentSession": {
    "id": "session-1734900001000-aabbccdd",
    "agentSlug": "recruiter",
    "startedAt": 1734900001000,
    "endedAt": 1734900241000,
    "durationLabel": "4m 00s",
    "evaluation": { "status": "completed", "result": { "score": 68, "metrics": [] } }
  },
  "baselineSession": {
    "id": "session-1734900001000-aabbccdd",
    "agentSlug": "recruiter",
    "startedAt": 1734900001000,
    "endedAt": 1734900241000,
    "durationLabel": "4m 00s",
    "evaluation": { "status": "completed", "result": { "score": 68, "metrics": [] } }
  }
}
```

- [ ] Create `scripts/smoke-compare-sessions.mjs`:

```js
// Run against a live dev server:  node scripts/smoke-compare-sessions.mjs
// Requires GEMINI_API_KEY or GEMINI_EVALUATION_API_KEY for the happy path,
// but the mechanical fallback still produces a well-shaped response if absent.
import { readFile } from 'node:fs/promises';

const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const ALLOWED = ['improved', 'mixed', 'similar', 'declined'];

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

async function post(body) {
  const r = await fetch(`${BASE}/api/compare-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const happy = JSON.parse(
  await readFile(new URL('./fixtures/eval-current.json', import.meta.url))
);

const a = await post(happy);
assert(a.status === 200, `happy status was ${a.status}`);
assert(a.body.comparison, 'missing comparison');
assert(ALLOWED.includes(a.body.comparison.trend), `trend ${a.body.comparison.trend} not allowed`);
assert(a.body.comparison.metrics.length === 4, `metrics.length was ${a.body.comparison.metrics.length}`);
for (const m of a.body.comparison.metrics) {
  assert(typeof m.delta === 'number', `delta not numeric for ${m.label}`);
  assert(['improved', 'similar', 'declined'].includes(m.trend), `per-metric trend ${m.trend} invalid`);
}

const notCompleted = JSON.parse(JSON.stringify(happy));
notCompleted.currentSession.evaluation.status = 'processing';
const b = await post(notCompleted);
assert(b.status === 400, `not-completed expected 400, got ${b.status}`);
assert(/not completed/i.test(b.body.error), `not-completed error message: ${b.body.error}`);

const sameId = JSON.parse(
  await readFile(new URL('./fixtures/eval-baseline.json', import.meta.url))
);
const c = await post(sameId);
assert(c.status === 400, `same-id expected 400, got ${c.status}`);
assert(/must differ/i.test(c.body.error), `same-id error message: ${c.body.error}`);

console.log('PASS: smoke-compare-sessions');
```

- [ ] Verify by running `node scripts/smoke-compare-sessions.mjs` with the dev server up. Expect `PASS: smoke-compare-sessions`.

### Task 8 — AppProvider: comparison sub-record + `runComparison` mutator

- [ ] In `components/app-provider.js`, extend the session-record factory so every newly created or hydrated session carries:

```js
comparison: {
  status: 'idle',
  baselineSessionId: undefined,
  startedAt: undefined,
  completedAt: undefined,
  failedAt: undefined,
  result: undefined,
  error: undefined,
}
```

Merge defensively inside the `HYDRATE` reducer branch so older localStorage snapshots without `comparison` fill in the default.

- [ ] Add a `SET_COMPARISON` reducer action that patches `state.sessions[slug][i].comparison` by `sessionId`. Expose a mutator bound into the `useAppActions()` bag:

```js
const runComparison = useCallback(async (slug, sessionId, baselineSessionId) => {
  const sessions = stateRef.current.sessions[slug] || [];
  const current = sessions.find((s) => s.id === sessionId);
  const baseline = sessions.find((s) => s.id === baselineSessionId);
  if (!current || !baseline) {
    dispatch({ type: 'SET_COMPARISON', slug, sessionId, patch: {
      status: 'failed', failedAt: Date.now(), error: 'session or baseline not found',
    }});
    return;
  }
  if (current.evaluation?.status !== 'completed' || baseline.evaluation?.status !== 'completed') {
    dispatch({ type: 'SET_COMPARISON', slug, sessionId, patch: {
      status: 'failed', failedAt: Date.now(), error: 'both sessions must be completed',
    }});
    return;
  }

  const key = `comparison:${sessionId}`;
  const prior = jobs.current.get(key);
  if (prior) prior.abort();
  const ctrl = new AbortController();
  jobs.current.set(key, ctrl);

  dispatch({ type: 'SET_COMPARISON', slug, sessionId, patch: {
    status: 'processing', baselineSessionId, startedAt: Date.now(),
    completedAt: undefined, failedAt: undefined, result: undefined, error: undefined,
  }});

  try {
    const r = await fetch('/api/compare-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        agentSlug: slug,
        currentSession: current,
        baselineSession: baseline,
      }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
    dispatch({ type: 'SET_COMPARISON', slug, sessionId, patch: {
      status: 'completed', completedAt: Date.now(),
      result: body.comparison, error: body.error,
    }});
  } catch (err) {
    if (err.name === 'AbortError') return;
    dispatch({ type: 'SET_COMPARISON', slug, sessionId, patch: {
      status: 'failed', failedAt: Date.now(), error: err.message,
    }});
  } finally {
    jobs.current.delete(key);
  }
}, []);
```

- [ ] Add `runComparison` to the memoized actions bag returned by `useAppActions()`.
- [ ] Verify by running the dev server, opening a session detail page with two completed sessions, calling `window.__sparkActions?.runComparison(slug, a.id, b.id)` from DevTools (add a temporary `window.__sparkActions = actions` line for this check, then remove it), and watching the session record in React DevTools cycle `idle → processing → completed`.

### Task 9 — `components/comparison-panel.js`

- [ ] Create the panel. It reads current session, eligible baselines, and comparison state from context. The panel must return `null` when `eligibleBaselines.length === 0` so the parent does not render an empty card.

```js
'use client';
import { useMemo, useState } from 'react';
import { useAppState, useAppActions } from './app-provider.js';

const TREND_CHIP = {
  improved: 'chip chip-success',
  mixed: 'chip chip-warning',
  similar: 'chip chip-neutral',
  declined: 'chip chip-danger',
};

function formatShortDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDelta(delta) {
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  return `${arrow}${Math.abs(delta).toFixed(1)}`;
}

export function ComparisonPanel({ slug, session, threadId }) {
  const state = useAppState();
  const { runComparison } = useAppActions();
  const [selected, setSelected] = useState('');

  const eligibleBaselines = useMemo(() => {
    const all = state.sessions[slug] || [];
    return all
      .filter(
        (s) =>
          s.id !== session.id &&
          s.threadId === threadId &&
          s.evaluation?.status === 'completed'
      )
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
  }, [state.sessions, slug, session.id, threadId]);

  if (eligibleBaselines.length === 0) return null;

  const comparison = session.comparison || { status: 'idle' };
  const processing = comparison.status === 'processing';
  const completed = comparison.status === 'completed';
  const failed = comparison.status === 'failed';
  const canCompare = !!selected && !processing;

  const onCompare = () => {
    if (!canCompare) return;
    runComparison(slug, session.id, selected);
  };
  const onRetry = () => {
    if (comparison.baselineSessionId) {
      runComparison(slug, session.id, comparison.baselineSessionId);
    }
  };

  return (
    <section className="card comparison-panel">
      <h2>Compare to another session</h2>

      <div className="comparison-controls">
        <label>
          Baseline:
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={processing}
          >
            <option value="">Select a baseline…</option>
            {eligibleBaselines.map((s, i) => (
              <option key={s.id} value={s.id}>
                {(s.sessionName || `Session ${i + 1}`) +
                  ' — ' +
                  formatShortDate(s.endedAt)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onCompare} disabled={!canCompare}>
          {processing ? 'Comparing…' : 'Compare'}
        </button>
        {processing && <span className="spinner" aria-hidden="true" />}
      </div>

      {failed && (
        <div className="comparison-error">
          <p>{comparison.error || 'Comparison failed.'}</p>
          {comparison.baselineSessionId && (
            <button type="button" onClick={onRetry}>Retry</button>
          )}
        </div>
      )}

      {completed && comparison.result && (
        <div className="comparison-result">
          <div className="comparison-header">
            <span className={TREND_CHIP[comparison.result.trend] || TREND_CHIP.similar}>
              {comparison.result.trend}
            </span>
            <p>{comparison.result.summary}</p>
            {comparison.error === 'gemini_failed' && (
              <small>Summary unavailable — showing deltas only.</small>
            )}
          </div>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Current</th>
                <th>Δ</th>
                <th>Trend</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {comparison.result.metrics.map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td>{m.baselineValue}</td>
                  <td>{m.currentValue}</td>
                  <td>{formatDelta(m.delta)}</td>
                  <td>
                    <span className={TREND_CHIP[m.trend] || TREND_CHIP.similar}>
                      {m.trend}
                    </span>
                  </td>
                  <td>{m.insight ? m.insight : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] Verify visually: dropdown lists every other completed session in the thread sorted most-recent-first; Compare is disabled until a baseline is picked; color-coded chip renders on completion; em dash renders in the Why column when `insight` is empty.

### Task 10 — Wire panel into `components/session-detail-page.js`

- [ ] Import the panel and render it between the existing evaluation card and the transcript block. Pass `slug`, `session`, and the `threadId` the page already has in scope.

```js
import { ComparisonPanel } from './comparison-panel.js';

// ...inside the page JSX, between the evaluation card and the transcript:
<ComparisonPanel slug={slug} session={session} threadId={session.threadId} />
```

- [ ] Verify visually by loading a session detail page. With only the current session completed in its thread, the panel is absent. Add a second completed session in the same thread and reload — the panel appears between the evaluation block and the transcript.

### Task 11 — Manual QA sweep

- [ ] Start the dev server. In the recruiter agent, create a thread and run two sessions to completion so both have `evaluation.status === 'completed'`.
- [ ] Open the newer session detail page. Confirm: panel renders, dropdown contains the older session, Compare is disabled until selection.
- [ ] Select the older session, click Compare. Confirm: button text changes to "Comparing…", spinner appears, and within ~5s the trend chip, summary, and four-row metric table render. Arrows on deltas match sign; color chip matches trend.
- [ ] Pick a different baseline mid-flight (only works if you have three completed sessions). Confirm the prior request is aborted (network tab shows the first request cancelled) and the new one runs.
- [ ] Kill the network (DevTools offline), click Compare, confirm `failed` state with message and Retry button. Re-enable network, click Retry, confirm success.
- [ ] Set `GEMINI_EVALUATION_API_KEY` and `GEMINI_API_KEY` to bogus values, restart the server, rerun comparison. Confirm response carries `error:'gemini_failed'`, the "Summary unavailable" small-text renders, and every Why column shows an em dash.
- [ ] Navigate away mid-request. Confirm no stale state writes in the console after the page unmounts (the AbortController should swallow the in-flight fetch).

## Requirement coverage

- R1 (user-initiated, no auto-trigger) — Tasks 9, 10, 11.
- R2 (baseline eligibility) — Task 9 (filter + sort).
- R3 (endpoint validation) — Tasks 5, 7.
- R4 (mechanical deltas + trend thresholds) — Tasks 1, 5, 7.
- R5 (Gemini-generated insights + key fallback) — Tasks 2, 3, 5.
- R6 (mechanical fallback on Gemini failure) — Tasks 4, 5, 11.
- R7 (stable response shape) — Tasks 3, 4, 5, 7.
- R8 (AppProvider state + mutator + AbortController) — Task 8.
- R9 (UI states: idle/processing/completed/failed) — Task 9.
- R10 (metric table columns and formatting) — Tasks 1, 9.

## Contract handoff

This plan consumes two upstream contracts — the session record shape from `agents-and-threads` (extending only `state.sessions[slug][i].comparison`) and `evaluation.status === 'completed'` plus `evaluation.result.metrics` from `evaluation-engine`. It produces no new contracts consumed by other specs: the `comparison` sub-record is owned by this spec and read only by the components added here. No downstream spec depends on it.
