# Tasks — Session Comparison

Sequenced. Each task ends with the requirement IDs it satisfies.

## T1. Scaffold `server/comparison.js` and wire the route

- Create `server/comparison.js` exporting `compareSessions(req, res)`.
- In `server.js`, mount `app.post('/api/compare-sessions', compareSessions)`.
- Stub returns HTTP 501 so the route is reachable before logic exists.
- **Satisfies:** R3 (route exists), R7 (shape placeholder).

## T2. Implement request validation

- Validate presence of `agentSlug`, `currentSession`, `baselineSession`.
- Reject when either `evaluation.status !== 'completed'`.
- Reject when `currentSession.id === baselineSession.id`.
- Reject on agent-type mismatch.
- Return HTTP 400 with `{ error, details }` on any failure.
- **Satisfies:** R3.

## T3. Compute mechanical metric deltas and per-metric trends

- Intersect metric labels across both evaluations.
- For each shared label: `delta = current - baseline`; `trend` from the `>4 / <-4` thresholds.
- Build the `metrics[]` array with `label, currentValue, baselineValue, delta, trend, insight:''` (insight filled in T4 on success path).
- Unit-verify via a temporary console log against the fixture in T8.
- **Satisfies:** R4, R10.

## T4. Gemini call with key fallback and JSON-validated response

- Resolve API key: `GEMINI_EVALUATION_API_KEY` → `GEMINI_API_KEY`.
- Build the prompt from the template in `design.md §4.1`; model `gemini-2.5-flash`.
- Parse response, strip fences, `JSON.parse`, validate with Zod.
- Merge `metricInsights[label]` into each metric row.
- Coerce `overallTrend` to the enum; if invalid, fall through to T5.
- **Satisfies:** R5, R7.

## T5. Mechanical fallback on Gemini failure

- On any throw / invalid JSON / schema miss: compute `overallTrend` from the average metric delta, set summary to the canned string, set every `insight` to `''`, include `error:'gemini_failed'` at the top level.
- Still respond with HTTP 200.
- **Satisfies:** R6.

## T6. Extend AppProvider state and add `runComparison` mutator

- Initialize `comparison: { status:'idle', ... }` whenever a session record is hydrated or created.
- Add `runComparison(slug, sessionId, baselineSessionId)` following the lifecycle in `design.md §5.1`.
- Register/abort `AbortController` under `jobs.current.get('comparison:' + sessionId)`.
- Ensure the localStorage snapshot round-trips the new field without loss.
- **Satisfies:** R8.

## T7. Build the Comparison panel in `components/session-detail-page.js`

- Compute `eligibleBaselines` (other completed sessions in the same thread, sorted by `endedAt` desc).
- Render nothing when the list is empty.
- Render dropdown + Compare button; disable button until a baseline is chosen and while `status === 'processing'`.
- Render trend chip, summary, and metric table on `status === 'completed'`.
- Render spinner on `processing`; error + Retry on `failed`.
- Apply the color tokens from `design.md §6.3`.
- **Satisfies:** R1, R2, R9, R10.

## T8. Write `scripts/smoke-compare-sessions.mjs` plus fixtures

- Create `scripts/fixtures/comparison-current.json` and `scripts/fixtures/comparison-baseline.json` with four-metric evaluations.
- Implement the smoke script per `design.md §9.2` (happy path, not-completed 400, same-id 400).
- Document invocation in a top-of-file comment.
- **Satisfies:** R3, R4, R5, R6, R7.

## T9. Manual QA sweep

- Walk the seven-step checklist in `design.md §9.1` end-to-end on a local dev server.
- Verify AbortController cleanup by navigating away mid-request and confirming no stale state writes in the console.
- Flip `GEMINI_EVALUATION_API_KEY` to a bogus value once to confirm the mechanical fallback path renders the em-dash insights and the "Summary unavailable" notice.
- **Satisfies:** R1, R2, R6, R8, R9, R10.
