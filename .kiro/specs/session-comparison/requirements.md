# Requirements — Session Comparison

User stories in EARS form for the side-by-side session comparison feature.

## R1. User-initiated comparison

**As a** user reviewing a completed session,
**I want to** pick another completed session in the same thread and run a comparison,
**so that** I can see how my performance has changed over time.

- WHEN the user opens a session detail page AND the same thread contains at least one other completed session,
  THE SYSTEM SHALL render a Comparison panel with a baseline dropdown and a Compare button.
- WHEN the user opens a session detail page AND the thread contains no other completed sessions,
  THE SYSTEM SHALL NOT render the Comparison panel.
- THE SYSTEM SHALL NOT auto-trigger a comparison; comparison SHALL only run when the user clicks Compare.

## R2. Baseline dropdown eligibility

**As a** user choosing a baseline,
**I want** the dropdown to only list sessions that can actually be compared,
**so that** I do not pick a session that will return a 400.

- THE SYSTEM SHALL populate the baseline dropdown with every session in the same thread that is not the current session AND whose `evaluation.status === 'completed'`.
- THE SYSTEM SHALL sort dropdown entries most-recent-first by `endedAt`.
- THE SYSTEM SHALL display each entry with its session name (or fallback ordinal) and the formatted `endedAt` date.

## R3. Endpoint validation

**As a** backend operator,
**I want** `POST /api/compare-sessions` to reject malformed or mismatched inputs,
**so that** the LLM is never called with bad data.

- IF the request is missing `agentSlug`, `currentSession`, or `baselineSession`,
  THE SYSTEM SHALL respond with HTTP 400 and `{ error: 'missing required fields', details }`.
- IF either session has `evaluation.status !== 'completed'`,
  THE SYSTEM SHALL respond with HTTP 400 and an error message naming which session is not completed.
- IF `currentSession.id === baselineSession.id`,
  THE SYSTEM SHALL respond with HTTP 400 and `{ error: 'current and baseline must differ' }`.
- IF the two sessions' agent types do not match `agentSlug` or each other,
  THE SYSTEM SHALL respond with HTTP 400 and `{ error: 'agent mismatch' }`.

## R4. Mechanical delta and per-metric trend

**As a** user reading a comparison,
**I want** each metric to show a delta and a trend label,
**so that** I can see which rubric dimensions moved.

- THE SYSTEM SHALL compute `delta = currentValue - baselineValue` for every metric present in both evaluations.
- THE SYSTEM SHALL assign a per-metric trend label using these thresholds:
  - `delta > 4` → `'improved'`
  - `delta < -4` → `'declined'`
  - `-4 <= delta <= 4` → `'similar'`
- IF a metric is present in one evaluation but not the other,
  THE SYSTEM SHALL omit that metric from the output.

## R5. Gemini-generated insights and summary

**As a** user,
**I want** a written summary and per-metric insight,
**so that** the comparison is interpretable beyond raw numbers.

- THE SYSTEM SHALL call `gemini-2.5-flash` with both evaluations and ask for a JSON object containing:
  - `overallTrend`: one of `'improved'|'mixed'|'similar'|'declined'`
  - `summary`: a 1–2 sentence string
  - `metricInsights`: an object keyed by metric label, each a single sentence
- THE SYSTEM SHALL resolve the Gemini API key using the fallback chain `GEMINI_EVALUATION_API_KEY` → `GEMINI_API_KEY`.
- THE SYSTEM SHALL merge Gemini's per-metric insights into the mechanical metric rows before responding.

## R6. Mechanical fallback on Gemini failure

**As a** user,
**I want** a comparison result even when the LLM call fails,
**so that** I am not blocked by a transient provider error.

- IF the Gemini call throws or returns invalid JSON,
  THE SYSTEM SHALL compute `overallTrend` mechanically from the average metric delta using the same `>4 / <-4` thresholds,
  AND SHALL set `summary` to a generic string such as `'Automated summary unavailable; showing metric deltas only.'`,
  AND SHALL set each metric's `insight` to an empty string,
  AND SHALL include a top-level `error` field naming the failure (e.g. `'gemini_failed'`).
- THE SYSTEM SHALL still respond with HTTP 200 when the mechanical fallback succeeds.

## R7. Response shape

**As a** frontend developer,
**I want** a stable response shape,
**so that** the UI can render without conditional plumbing.

- THE SYSTEM SHALL respond with:
  ```
  { comparison: {
      trend: 'improved'|'mixed'|'similar'|'declined',
      summary: string,
      metrics: [{ label, currentValue, baselineValue, delta, trend, insight }]
    },
    error?: string
  }
  ```

## R8. AppProvider state and mutator

**As a** UI component,
**I want** a single mutator that drives the comparison lifecycle,
**so that** status, result, and abort are managed in one place.

- THE SYSTEM SHALL extend `state.sessions[slug][i]` with a `comparison` record:
  `{ status:'idle'|'processing'|'completed'|'failed', baselineSessionId?, startedAt?, completedAt?, failedAt?, result?, error? }`.
- THE SYSTEM SHALL expose an action `runComparison(slug, sessionId, baselineSessionId)` that transitions status `idle|failed → processing → completed|failed`.
- THE SYSTEM SHALL register the in-flight request's `AbortController` in the provider's job map keyed by `comparison:${sessionId}` and abort it on unmount or when a new comparison is started for the same session.

## R9. UI states

**As a** user,
**I want** distinct visual states,
**so that** I know whether a comparison is running, ready, or broken.

- WHEN `comparison.status === 'idle'`, THE SYSTEM SHALL render only the dropdown and Compare button.
- WHEN `comparison.status === 'processing'`, THE SYSTEM SHALL disable the Compare button and show a spinner beside it.
- WHEN `comparison.status === 'completed'`, THE SYSTEM SHALL render the overall trend chip, summary text, and metric table.
- WHEN `comparison.status === 'failed'`, THE SYSTEM SHALL render the error message and a Retry button that re-invokes `runComparison` with the last chosen baseline.
- THE SYSTEM SHALL color-code trend chips: improved=green, mixed=amber, similar=neutral, declined=red.

## R10. Metric table rendering

**As a** user,
**I want** a compact side-by-side table,
**so that** I can scan all metrics at once.

- THE SYSTEM SHALL render one row per metric with columns: label, baselineValue, currentValue, delta (prefixed by ↑ for positive, ↓ for negative, → for zero), per-metric trend chip, insight text.
- THE SYSTEM SHALL render the delta with one decimal place of precision.
- IF `insight` is an empty string (mechanical fallback), THE SYSTEM SHALL render an em dash (`—`) in the insight column.
