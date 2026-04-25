# Design — Session Comparison

## 1. Overview

Session comparison is a small, user-initiated feature layered on top of per-session evaluations. It takes two completed sessions from the same thread and produces a side-by-side metric delta view with an LLM-written summary. The backend is a single stateless endpoint (`POST /api/compare-sessions`) that computes mechanical deltas locally and calls `gemini-2.5-flash` for narrative. The frontend adds a Comparison panel to the session detail page and one mutator to `AppProvider`.

Design commitments:

- Never auto-trigger. The user picks a baseline and clicks Compare.
- Always return HTTP 200 with a normalized shape when possible. Only validation errors return 4xx.
- The mechanical delta path is the source of truth for numbers. Gemini only contributes prose.

## 2. Endpoint specification

### 2.1 Route

`POST /api/compare-sessions` → `server/comparison.js` → `compareSessions(req, res)`.

### 2.2 Request body

```json
{
  "agentSlug": "recruiter",
  "currentSession": {
    "id": "session-1735000002000-ee11ff22",
    "startedAt": 1735000002000,
    "endedAt": 1735000302000,
    "durationLabel": "5m 00s",
    "evaluation": {
      "status": "completed",
      "score": 78,
      "metrics": [
        { "label": "Impact clarity", "value": 82 },
        { "label": "Structure", "value": 74 },
        { "label": "Role fit", "value": 80 },
        { "label": "Delivery", "value": 76 }
      ]
    }
  },
  "baselineSession": {
    "id": "session-1734900001000-aabbccdd",
    "startedAt": 1734900001000,
    "endedAt": 1734900241000,
    "durationLabel": "4m 00s",
    "evaluation": {
      "status": "completed",
      "score": 68,
      "metrics": [
        { "label": "Impact clarity", "value": 70 },
        { "label": "Structure", "value": 78 },
        { "label": "Role fit", "value": 66 },
        { "label": "Delivery", "value": 60 }
      ]
    }
  }
}
```

### 2.3 Validation rules

Applied in order. First failure short-circuits.

1. `agentSlug`, `currentSession`, `baselineSession` are all present.
2. `currentSession.id !== baselineSession.id`.
3. Both sessions have `evaluation.status === 'completed'`.
4. Both sessions' agent type matches `agentSlug`. (Each session carries `agentSlug` on its record — the caller is expected to include it; if missing, we accept as long as both records carry matching metric label sets.)
5. Metrics arrays are non-empty and contain at least one shared `label`.

Any failure → HTTP 400 with `{ error, details }`. The `details` field carries the offending field name so the frontend can surface it cleanly.

### 2.4 Success response

```json
{
  "comparison": {
    "trend": "improved",
    "summary": "Delivery and role fit jumped markedly while structure slipped slightly.",
    "metrics": [
      {
        "label": "Impact clarity",
        "currentValue": 82,
        "baselineValue": 70,
        "delta": 12,
        "trend": "improved",
        "insight": "Answers opened with outcomes before context, which landed harder."
      },
      {
        "label": "Structure",
        "currentValue": 74,
        "baselineValue": 78,
        "delta": -4,
        "trend": "similar",
        "insight": "Answers occasionally skipped the 'result' beat of STAR."
      }
    ]
  }
}
```

### 2.5 Error response

```json
{
  "error": "current session is not completed",
  "details": { "field": "currentSession.evaluation.status" }
}
```

Fallback response (Gemini down) uses HTTP 200 and adds `error`:

```json
{
  "comparison": { "trend": "similar", "summary": "Automated summary unavailable; showing metric deltas only.", "metrics": [ ... insights:"" ... ] },
  "error": "gemini_failed"
}
```

## 3. Trend computation rules

### 3.1 Per-metric trend

For each metric present in both evaluations:

```
delta = currentValue - baselineValue
trend = delta >  4 ? 'improved'
      : delta < -4 ? 'declined'
      :              'similar'
```

The threshold is `4` on both sides. `delta === 4` is still `similar`; `delta === 5` flips to `improved`.

### 3.2 Overall trend (mechanical fallback only)

When Gemini fails we compute `overallTrend` from the average of per-metric deltas:

```
avg = mean(metric.delta for metric in metrics)

overallTrend = avg >  4 ? 'improved'
             : avg < -4 ? 'declined'
             :            'similar'
```

Mechanical fallback never produces `'mixed'` — only Gemini can.

### 3.3 Overall trend (Gemini path)

Gemini returns one of `'improved'|'mixed'|'similar'|'declined'`. `'mixed'` is reserved for the case where some metrics improved and others declined by more than the threshold. If Gemini returns anything else, we coerce to the mechanical value.

## 4. Gemini prompt

Model: `gemini-2.5-flash`. Key resolution: `GEMINI_EVALUATION_API_KEY` → `GEMINI_API_KEY`.

### 4.1 Prompt template

```
You are a rehearsal-performance analyst comparing two practice sessions.

AGENT: {{agentSlug}}

BASELINE SESSION ({{baselineSession.durationLabel}} on {{formatDate(baselineSession.endedAt)}})
Overall score: {{baselineSession.evaluation.score}}
Metrics:
{{#each baselineSession.evaluation.metrics}}
- {{label}}: {{value}}
{{/each}}

CURRENT SESSION ({{currentSession.durationLabel}} on {{formatDate(currentSession.endedAt)}})
Overall score: {{currentSession.evaluation.score}}
Metrics:
{{#each currentSession.evaluation.metrics}}
- {{label}}: {{value}}
{{/each}}

MECHANICAL DELTAS (currentValue - baselineValue):
{{#each metricDeltas}}
- {{label}}: {{delta}} ({{trend}})
{{/each}}

Respond with a single JSON object and nothing else. Do not wrap it in markdown fences.

{
  "overallTrend":  "improved" | "mixed" | "similar" | "declined",
  "summary":       "1-2 sentences describing the overall change.",
  "metricInsights": {
    "<metric label>": "one sentence explaining why this metric moved as it did"
  }
}

Rules:
- overallTrend must be "mixed" only if some metrics improved by more than 4 and others declined by more than 4.
- summary must not invent specific quotes or timestamps.
- Every metric label listed above must appear as a key in metricInsights.
```

### 4.2 Response parsing

- Strip leading/trailing whitespace and stray code fences.
- Parse with `JSON.parse` inside a try/catch.
- Validate with a tiny Zod schema: `{ overallTrend: enum, summary: string, metricInsights: Record<string,string> }`.
- If validation fails → mechanical fallback.

## 5. Frontend integration

### 5.1 `runComparison` mutator

Lives in `components/app-provider.js`.

```
runComparison(slug, sessionId, baselineSessionId)
  1. Locate current and baseline session records.
  2. Guard: both must have evaluation.status === 'completed'; otherwise set comparison.status='failed' with a local error.
  3. Abort any existing controller at jobs.current.get(`comparison:${sessionId}`).
  4. Create a new AbortController; store it in the job map.
  5. setComparison(slug, sessionId, { status:'processing', baselineSessionId, startedAt: Date.now(), error: undefined })
  6. fetch POST /api/compare-sessions with both session records; signal: controller.signal.
  7. On 200: setComparison(..., { status:'completed', completedAt: Date.now(), result: json.comparison, error: json.error ?? undefined }).
  8. On non-2xx or thrown: setComparison(..., { status:'failed', failedAt: Date.now(), error: msg }). Swallow AbortError silently.
  9. finally: jobs.current.delete(`comparison:${sessionId}`).
```

### 5.2 AbortController flow

- Keyed `comparison:${sessionId}` in the shared `jobs` ref.
- Aborted on component unmount (session detail page cleanup effect).
- Aborted when `runComparison` is called again for the same session (user retries with different baseline).

### 5.3 AppProvider state extension

New nested record under each session:

```
state.sessions[slug][i].comparison = {
  status: 'idle',              // 'idle' | 'processing' | 'completed' | 'failed'
  baselineSessionId: undefined,
  startedAt: undefined,
  completedAt: undefined,
  failedAt: undefined,
  result: undefined,           // { trend, summary, metrics:[...] }
  error: undefined,            // string; set when status='failed' or fallback returned
}
```

Default value is injected when a session is first hydrated or created. The localStorage snapshot round-trips this record unchanged.

## 6. UI design

### 6.1 Placement

On `components/session-detail-page.js`, the Comparison panel sits below the main evaluation block and above the transcript. It is a single full-width card with the heading "Compare to another session".

### 6.2 Wireframe

```
┌────────────────────────────────────────────────────────────┐
│ Compare to another session                                 │
│                                                            │
│ Baseline: [ Session 2 — Apr 19  ▾ ]   [ Compare ]          │
│                                                            │
│ ── when status='completed' ─────────────────────────────── │
│ [ Improved ]  Delivery and role fit jumped markedly while  │
│               structure slipped slightly.                  │
│                                                            │
│ Metric           Baseline  Current  Δ      Trend     Why   │
│ Impact clarity   70        82       ↑12    [Improved] ...  │
│ Structure        78        74       ↓4     [Similar]  ...  │
│ Role fit         66        80       ↑14    [Improved] ...  │
│ Delivery         60        76       ↑16    [Improved] ...  │
└────────────────────────────────────────────────────────────┘
```

### 6.3 Color coding

Chips inherit shared theme tokens:

| Trend    | Background var      | Foreground var      |
| -------- | ------------------- | ------------------- |
| improved | `--chip-success-bg` | `--chip-success-fg` |
| mixed    | `--chip-warning-bg` | `--chip-warning-fg` |
| similar  | `--chip-neutral-bg` | `--chip-neutral-fg` |
| declined | `--chip-danger-bg`  | `--chip-danger-fg`  |

### 6.4 Panel visibility

The panel renders only when `eligibleBaselines.length >= 1`, where `eligibleBaselines` are other sessions in the same thread with `evaluation.status === 'completed'`, sorted by `endedAt` descending. If no eligible baselines exist, the entire card is omitted.

### 6.5 Baseline dropdown

A native `<select>`. Each `<option value={session.id}>` renders `${session.name ?? 'Session ' + (index+1)} — ${formatShortDate(session.endedAt)}`. The placeholder option is `"Select a baseline…"` with `value=""`, and the Compare button stays disabled until a non-empty value is selected.

### 6.6 States

| State      | Rendered                                                            |
| ---------- | ------------------------------------------------------------------- |
| idle       | Dropdown + Compare button only                                      |
| processing | Dropdown disabled, Compare button disabled, inline spinner          |
| completed  | Trend chip + summary + metric table + small "Run again" link        |
| failed     | Red inline error + "Retry" button (reuses last `baselineSessionId`) |

## 7. Contract changes

### 7.1 AppProvider state

Owned by `agents-and-threads`; this spec adds exactly one sub-record:

```diff
 state.sessions[slug][i] = {
   id, name, startedAt, endedAt, durationLabel,
   evaluation: { ... },               // evaluation-engine
   resources:  { ... },               // research-and-resources
+  comparison: {
+    status: 'idle' | 'processing' | 'completed' | 'failed',
+    baselineSessionId?: string,
+    startedAt?: number,
+    completedAt?: number,
+    failedAt?: number,
+    result?: { trend, summary, metrics: [...] },
+    error?: string,
+  },
 }
```

### 7.2 AppProvider actions

Adds one action to the `useAppActions()` surface:

```
runComparison(slug: string, sessionId: string, baselineSessionId: string): Promise<void>
```

### 7.3 Job map keys

Adds one job key namespace: `comparison:${sessionId}`.

## 8. Error handling

| Case                                 | Handling                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Missing baseline selection           | Compare button disabled; `runComparison` not called.                                                                                     |
| Baseline session no longer completed | `runComparison` pre-check sets `status='failed'` with message; no request sent.                                                          |
| Mismatched agent slugs               | Backend returns 400 `{ error:'agent mismatch' }`; frontend shows message verbatim.                                                       |
| Gemini timeout / invalid JSON / 5xx  | Backend falls back to mechanical; response includes `error:'gemini_failed'`. UI shows result plus a subtle notice "Summary unavailable". |
| Network error                        | `status='failed'`, `error` holds `err.message`; Retry button re-invokes with same baseline.                                              |
| Component unmount mid-flight         | Cleanup effect calls `controller.abort()`; fetch rejects with AbortError; mutator ignores it.                                            |
| User picks a new baseline mid-flight | Next `runComparison` call aborts prior controller before creating its own.                                                               |

## 9. Testing strategy

### 9.1 Manual QA checklist

1. Open a thread with exactly one completed session → Comparison panel must not render.
2. Add a second completed session → panel appears; dropdown shows the other session.
3. Pick baseline, click Compare → spinner appears, then trend chip + table fill in within ~5s.
4. Pick a different baseline, click Compare again → prior in-flight request is aborted; new one runs.
5. Unplug network, click Compare → failed state with Retry; retry succeeds when network returns.
6. Temporarily set a bogus `GEMINI_EVALUATION_API_KEY` → result renders with em-dash insights and "Summary unavailable" notice.
7. Navigate away mid-request → no state updates logged after unmount.

### 9.2 `scripts/smoke-compare-sessions.mjs`

Node script, runs against a live dev server. Steps:

1. Load `scripts/fixtures/comparison-current.json` and `comparison-baseline.json` — pre-baked evaluations with four metrics each.
2. `POST /api/compare-sessions` with `agentSlug:'recruiter'` and both fixtures.
3. Assert 200, `body.comparison.trend` is one of the four labels, `body.comparison.metrics.length === 4`, every metric has a numeric `delta` and a `trend` from the three values.
4. Repeat with `currentSession.evaluation.status = 'processing'` → assert 400 and a helpful message.
5. Repeat with `baselineSession.id === currentSession.id` → assert 400.
6. Print a pass/fail summary and exit with non-zero on any failure.

The script lives at `scripts/smoke-compare-sessions.mjs` and is invoked as `node scripts/smoke-compare-sessions.mjs` (server must already be running on `PORT`).
