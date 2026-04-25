# Tasks — Evaluation Engine

- [ ] 1. Scaffold `server/evaluation.js` and wire endpoints
  - Create `server/evaluation.js` exporting `evaluateSession` and `evaluateThread`.
  - In `server.js`, import both and register `app.post('/api/evaluate-session', evaluateSession)` and `app.post('/api/evaluate-thread', evaluateThread)`.
  - Add a `resolveGeminiKey()` helper that returns `process.env.GEMINI_EVALUATION_API_KEY || process.env.GEMINI_API_KEY || null`.
  - Add `safeDefaults(agentConfig)` returning `{ score:0, summary:'', metrics:[{label, value:0, justification:''}...], strengths:[], improvements:[], recommendations:[], resourceBriefs:[] }`.
  - _Requirements: 1.1, 1.3, 1.6_

- [ ] 2. Implement per-session prompt construction
  - Write `buildSessionPrompt({ agentConfig, transcript, upload, coding, customContext, durationLabel, startedAt, endedAt })` matching the template in `design.md §2`.
  - Render the transcript as alternating `User:` / `Agent:` lines.
  - Include the coding block only when `agentConfig.slug === 'coding'` and `coding.finalCode` is present; fence with the provided language.
  - Splice `agentConfig.evaluationPrompt` and iterate `agentConfig.evaluationCriteria` into the rubric list.
  - _Requirements: 1.2_

- [ ] 3. Implement per-session Gemini call and normalization
  - Instantiate `new GoogleGenAI({ apiKey })` and call `ai.models.generateContent({ model:'gemini-2.5-flash', contents:[{role:'user',parts:[{text:prompt}]}], config:{ responseMimeType:'application/json', temperature:0.35 } })`.
  - Implement `normalizeSessionResult(raw, agentConfig)` per `design.md §4`: walk `evaluationCriteria` in order, clamp `value` to [0,100], fill missing metrics with `value:0, justification:'No assessment returned.'`, discard extra metrics, recompute weighted `score`, truncate `strengths`/`improvements`/`recommendations` to 4, clamp `resourceBriefs` to 4.
  - On any thrown exception inside the handler, respond 200 with `{ evaluation: safeDefaults(agentConfig), error: err.message }`.
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 6.1-6.5_

- [ ] 4. Implement thread prompt construction and endpoint
  - Write `buildThreadPrompt({ agentConfig, thread, sessions })` rendering each prior session's metrics + summary oldest-first, then the task instructions and JSON schema from `design.md §5`.
  - Reject requests with fewer than 2 completed evaluations (HTTP 400).
  - Call Gemini with the same key-fallback chain, `temperature: 0.45`, `responseMimeType:'application/json'`.
  - Implement `normalizeThreadResult(raw, agentConfig)` to coerce `trajectory` into `{improving,stable,declining}`, align `metricTrends` with `evaluationCriteria` order, coerce `hiddenGuidance` to a non-empty string (empty → safe default `"Continue probing this user's weakest rubric area."`).
  - _Requirements: 2.1-2.5, 7.1, 7.3_

- [ ] 5. Extend `AppProvider` state shape
  - Add `evaluation` (status machine) to each session record's initial shape.
  - Add `evaluation` and `memory` to each thread record's initial shape.
  - Ensure the localStorage migration (in `app-provider.js`) merges any missing keys onto hydrated records so existing saved state doesn't crash.
  - _Requirements: 3.4, 4.2, 7.1, 8.1_

- [ ] 6. Add evaluation mutators
  - Add `startEvaluation`, `completeEvaluation`, `failEvaluation`, `retryEvaluation` on `useAppActions()`.
  - Add `startThreadEvaluation`, `completeThreadEvaluation`, `failThreadEvaluation`, `retryThreadEvaluation`.
  - Add `applyThreadMemory(threadId, { hiddenGuidance, summary, focusAreas })` that sets `memory` with `updatedAt: Date.now()`.
  - All mutators produce immutable updates to feed the existing debounced localStorage effect.
  - _Requirements: 3.2, 3.4, 4.2, 5.1-5.3, 7.1_

- [ ] 7. Implement the session auto-trigger effect
  - Add the `useEffect` loop described in `design.md §6` that scans `state.sessions` and fires `/api/evaluate-session` for each session with `evaluation.status === 'idle'` and a non-empty transcript.
  - Guard by `jobs.current.has('evaluation:'+s.id)` so it never double-fires.
  - On `AbortError`, leave status as `processing`. On other errors, call `failEvaluation`. On success, call `completeEvaluation` then `maybeAutoTriggerThread`.
  - _Requirements: 3.1-3.4, 13.1, 13.2_

- [ ] 8. Implement the thread auto-trigger and hidden memory application
  - Write `maybeAutoTriggerThread(slug, threadId)` that counts the thread's completed sessions; if ≥2, fires `/api/evaluate-thread` with the current thread + sessions snapshot.
  - On success, call `completeThreadEvaluation(threadId, result)` and `applyThreadMemory(threadId, { hiddenGuidance, summary, focusAreas })`.
  - Re-run on every subsequent session completion so memory stays current.
  - _Requirements: 4.1-4.3, 7.1, 8.1, 8.2_

- [ ] 9. Unmount abort handling
  - Add the cleanup `useEffect(() => () => { for (const c of jobs.current.values()) c.abort(); jobs.current.clear(); }, [])`.
  - Confirm the `catch` branches in both auto-trigger loops early-return on `err.name === 'AbortError'` without flipping to `failed`.
  - _Requirements: 13.1, 13.2_

- [ ] 10. Build the session detail page evaluation card
  - In `components/session-detail-page.js`, read `session.evaluation` from context and render the four states (idle / processing / completed / failed) per `design.md §7`.
  - Completed state: score card (big number + summary), rubric metric bars (width `${value}%`), three columns (strengths / improvements / recommendations ≤ 4 each), resource brief cards.
  - Failed state: banner with `error` + "Retry evaluation" button calling `retryEvaluation(sessionId)`.
  - Idle safety net: "Generate evaluation" button calling `retryEvaluation` (same effect — flips status).
  - _Requirements: 9.1-9.4, 10.1-10.4_

- [ ] 11. Build the transcript display
  - Below the evaluation card, render `session.transcript` in a scrollable container (`max-height:60vh`).
  - Style user turns and agent turns distinctly (left/right alignment + different background tokens from `globals.css`).
  - Empty transcripts render the "No transcript captured." placeholder.
  - _Requirements: 11.1-11.3_

- [ ] 12. Build the thread detail page evaluation card
  - In `components/thread-detail-page.js`, render the evaluation card only when `thread.evaluation.status === 'completed'` AND the thread has ≥2 completed session evaluations.
  - Show summary, trajectory pill (green/grey/red), metric-trend table with arrow glyphs (▲/■/▼), strengths, focus areas, next-session focus.
  - Render `<details>` labeled "Hidden memory — used to steer next session"; body shows `memory.hiddenGuidance` with the "internal" label from `design.md §7`.
  - Also render a retry button when `thread.evaluation.status === 'failed'` that calls `retryThreadEvaluation(threadId)`.
  - _Requirements: 5.3, 7.1, 7.2, 12.1-12.3_

- [ ] 13. Add CSS for the evaluation cards
  - In `app/globals.css`, add tokens and rules for `.eval-card`, `.eval-score`, `.eval-metric`, `.eval-metric-bar`, `.eval-columns`, `.eval-column`, `.eval-brief`, `.transcript`, `.transcript-turn`, `.transcript-turn--user`, `.transcript-turn--agent`, `.thread-eval-card`, `.trend-pill--improving|stable|declining`.
  - Use existing theme CSS custom properties — no new color palette.
  - _Requirements: 10.1-10.4, 11.2, 12.2_

- [ ] 14. Write smoke scripts
  - `scripts/smoke-evaluate-session.mjs`: posts a fixture recruiter transcript to `/api/evaluate-session`, asserts `evaluation.score` is a number and `evaluation.metrics.length === 4`, prints the JSON, exits non-zero on any mismatch.
  - `scripts/smoke-evaluate-thread.mjs`: posts two fixture sessions (each carrying a synthetic `evaluation.result`), asserts `threadEvaluation.hiddenGuidance` is a non-empty string and `threadEvaluation.metricTrends.length === 4`, prints the JSON, exits non-zero on mismatch.
  - Both load env via `dotenv/config`, read `SMOKE_BASE` (default `http://localhost:3000`), and use native `fetch`.
  - _Requirements: 14.1-14.3_
