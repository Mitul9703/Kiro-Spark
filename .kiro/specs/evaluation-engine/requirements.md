# Requirements — Evaluation Engine

## Introduction

The evaluation engine turns raw session transcripts into structured, rubric-based feedback. It has two evaluators: a per-session evaluator (overall score, rubric metrics with justifications, strengths, improvements, recommendations, resource briefs) and a cross-session thread evaluator that produces trajectory analysis plus *hidden guidance* — an internal steering paragraph the next live session can silently inject into the agent's prompt. Both evaluators call `gemini-2.5-flash` via `@google/genai`, normalize the JSON output, and persist results to `AppProvider` state (mirrored to localStorage). Evaluations auto-trigger when a session ends with a non-empty transcript; thread-level evaluation auto-triggers once the parent thread has ≥2 completed session evaluations.

## Requirements

### Requirement 1 — Per-session evaluation endpoint

**User Story:** As a user who just finished a rehearsal session, I want Spark to generate a structured evaluation of my performance so that I know my score, my strengths, my weaknesses, and what to practice next.

#### Acceptance Criteria

1. WHEN the client POSTs `/api/evaluate-session` with a body containing `agentSlug`, `transcript`, and timing metadata THEN the server SHALL load the agent config from `data/agents.json` by slug and fail with HTTP 400 if the slug is unknown.
2. WHEN building the Gemini prompt THEN the server SHALL combine, in order, the agent's `evaluationPrompt`, the rubric criteria from `evaluationCriteria`, the transcript rendered as alternating `User:` / `Agent:` lines, the `upload.contextText` (if present), the `customContext` (if present), and for the `coding` agent the `interviewQuestion.markdown` plus `finalCode` fenced with the language tag.
3. WHEN calling Gemini THEN the server SHALL use model `gemini-2.5-flash` via `@google/genai` with a structured-JSON output instruction and SHALL resolve the API key from `GEMINI_EVALUATION_API_KEY`, falling back to `GEMINI_API_KEY`.
4. WHEN Gemini returns a response THEN the server SHALL parse the JSON, clamp every numeric score to the integer range [0,100], coerce missing arrays to `[]`, drop any rubric metrics not declared in the agent config, and emit metrics in the exact order defined by `evaluationCriteria`.
5. WHEN normalization succeeds THEN the server SHALL respond with `{ evaluation: { score, summary, metrics, strengths, improvements, recommendations, resourceBriefs } }`, where `strengths`, `improvements`, `recommendations` each contain at most 4 entries and `resourceBriefs` contains between 0 and 4 entries derived from the lowest-scoring metrics.
6. IF normalization fails for any reason THEN the server SHALL respond 200 with safe defaults (`score: 0`, all arrays empty, `summary: ''`) plus an `error` string explaining the failure.

### Requirement 2 — Thread evaluation endpoint

**User Story:** As a user who has done multiple sessions in one thread, I want a cross-session report so that I can see whether I'm improving and what to focus on next.

#### Acceptance Criteria

1. WHEN the client POSTs `/api/evaluate-thread` with `agentSlug`, `thread`, and `sessions` (each session carrying its own `evaluation.result`) THEN the server SHALL require at least 2 sessions with completed evaluations and respond HTTP 400 otherwise.
2. WHEN building the thread prompt THEN the server SHALL summarize each prior session's metrics in rubric order, list overall-score deltas, and instruct Gemini to output `summary`, `trajectory ('improving'|'stable'|'declining')`, `comments`, `strengths`, `focusAreas`, `nextSessionFocus`, `metricTrends` (one row per rubric metric with `trend` ∈ `{improving, stable, declining}`), and `hiddenGuidance`.
3. WHEN resolving the Gemini API key THEN the server SHALL try `GEMINI_EVALUATION_API_KEY` first, then `GEMINI_API_KEY`.
4. WHEN Gemini returns THEN the server SHALL normalize the JSON to the declared shape, clamp array lengths, and respond `{ threadEvaluation: {...} }`.
5. WHEN Gemini returns a `hiddenGuidance` string THEN the server SHALL preserve it verbatim — it MUST NOT be shown in the visible summary and MUST fit the instruction "steer the next session without breaking realism".

### Requirement 3 — Auto-trigger on session completion

**User Story:** As a user, I want evaluations to start automatically when my session ends, so that I don't have to click a button.

#### Acceptance Criteria

1. WHEN a session's transcript becomes non-empty AND `session.evaluation.status === 'idle'` THEN the provider's auto-trigger effect SHALL fire `POST /api/evaluate-session` exactly once per session.
2. WHEN the fetch starts THEN the provider SHALL register the `AbortController` in its job map under key `evaluation:${sessionId}` and set `status = 'processing'` with `startedAt = Date.now()`.
3. IF the component tree unmounts or the session record is deleted THEN the provider SHALL call `abort()` on the controller and leave `status` as `processing` (the next mount will re-trigger idempotently).
4. WHEN the fetch resolves with a well-formed `evaluation` THEN the provider SHALL set `status = 'completed'`, store `result`, set `completedAt = Date.now()`, and remove the controller from the job map.

### Requirement 4 — Auto-trigger thread evaluation

**User Story:** As a user, I want a thread-level report to appear automatically once I have at least two sessions, so that progress tracking is passive.

#### Acceptance Criteria

1. WHEN a session evaluation transitions to `completed` AND its parent thread has ≥2 sessions with `evaluation.status === 'completed'` THEN the provider SHALL auto-trigger `POST /api/evaluate-thread` for that thread.
2. WHEN the thread evaluation completes THEN the provider SHALL set `thread.evaluation.status = 'completed'`, store the result, and also write `thread.memory = { hiddenGuidance, summary, focusAreas, updatedAt: Date.now() }`.
3. WHEN a thread already has a completed evaluation AND a newer session completes THEN the provider SHALL re-trigger `/api/evaluate-thread` so the memory stays current.

### Requirement 5 — Retry on failure

**User Story:** As a user whose evaluation failed (network drop, Gemini error), I want a retry button, so that I don't have to redo the session.

#### Acceptance Criteria

1. IF the evaluation fetch rejects OR the response body omits `evaluation` OR the response contains an `error` field THEN the provider SHALL set `session.evaluation.status = 'failed'`, store `error`, set `failedAt = Date.now()`, and stop auto-retrying.
2. WHEN the user clicks the "Retry evaluation" button on the session detail page THEN the provider SHALL reset `status` to `idle`, which re-enters the auto-trigger path.
3. IF a thread evaluation fails THEN the user SHALL see a retry control on the thread detail page that resets `thread.evaluation.status` to `idle`.

### Requirement 6 — Score normalization

**User Story:** As a developer, I want score normalization to be defensive, so that one malformed LLM response doesn't crash the UI.

#### Acceptance Criteria

1. WHEN a returned `score` is a string numeric THEN the server SHALL parse it with `Number()` and clamp to [0,100].
2. WHEN a returned `metric.value` is missing, `NaN`, negative, or > 100 THEN the server SHALL clamp into [0,100] (missing → 0).
3. WHEN the model returns fewer metrics than declared THEN the server SHALL fill the missing ones with `{ label, value: 0, justification: 'No assessment returned.' }`.
4. WHEN the model returns extra metrics not in the rubric THEN the server SHALL discard them silently.
5. WHEN the model returns the overall `score` as the unweighted mean but the rubric declares weights THEN the server SHALL recompute the weighted average from `metrics` and override `score`.

### Requirement 7 — Hidden memory generation

**User Story:** As a user, I want the system to remember my recurring weaknesses across sessions and gently coach the next session accordingly, so that my rehearsals compound.

#### Acceptance Criteria

1. WHEN Gemini returns `hiddenGuidance` THEN the provider SHALL store it on `thread.memory.hiddenGuidance` with `updatedAt = Date.now()`.
2. WHEN the thread detail page renders the memory disclosure THEN it SHALL label the section "Hidden memory — internal, used to steer next session" so the user understands what it is.
3. `hiddenGuidance` SHALL NOT appear inside `summary`, `comments`, `strengths`, or `focusAreas` — those fields are shown openly to the user.

### Requirement 8 — Hidden memory consumption by next session

**User Story:** As a user starting a second (or later) session in a thread, I want the agent to already know my weak spots, so that it probes them without me repeating myself.

#### Acceptance Criteria

1. WHEN a live session is started on a thread whose `thread.memory.hiddenGuidance` is non-empty THEN the evaluation-engine spec SHALL expose that string via `state.threads[slug][j].memory`, and the live-session spec SHALL be responsible for injecting it into the Gemini Live system prompt.
2. The evaluation-engine spec itself SHALL NOT mutate the live system prompt — it only populates `thread.memory`.

### Requirement 9 — Evaluation UI states

**User Story:** As a user on the session detail page, I want clear feedback about whether my evaluation is still generating, so that I'm not left staring at a blank screen.

#### Acceptance Criteria

1. WHEN `session.evaluation.status === 'processing'` THEN the page SHALL render a spinner with the label "Generating evaluation…" where the score card would be.
2. WHEN `status === 'failed'` THEN the page SHALL render an error banner with the `error` message and a "Retry evaluation" button.
3. WHEN `status === 'idle'` and the transcript is non-empty THEN the page SHALL render a "Generate evaluation" button (the auto-trigger should normally pre-empt this, but it acts as a safety net).
4. WHEN `status === 'completed'` THEN the page SHALL render the full evaluation card (score, metrics, strengths, improvements, recommendations, resource briefs).

### Requirement 10 — Evaluation card rendering

**User Story:** As a user reading my report, I want a clean, scannable layout, so that I can immediately see my score and top takeaways.

#### Acceptance Criteria

1. The score card SHALL render the overall `score` in a large numeric style (CSS `font-size: 4rem` equivalent) with the summary paragraph below it.
2. Each rubric metric SHALL render a horizontal bar whose width is `${value}%` plus the label, the numeric value, and the justification.
3. Strengths, Improvements, and Recommendations SHALL render as three equal-width columns (stacked on narrow viewports) with at most 4 bullet points each.
4. Resource Briefs SHALL render as cards showing `topic`, `improvement`, `whyThisMatters`, `searchPhrases`, and `resourceTypes`; fetched resources themselves are owned by the `research-and-resources` spec and are not rendered by this spec.

### Requirement 11 — Transcript display

**User Story:** As a user reviewing my session, I want to re-read the full transcript, so that I can connect the evaluation's feedback to specific moments.

#### Acceptance Criteria

1. The session detail page SHALL render the full transcript below the evaluation card in a scrollable container (`max-height` approximately `60vh`).
2. User turns and agent turns SHALL be visually distinct (different background color, different alignment).
3. Empty transcripts SHALL render a placeholder "No transcript captured." rather than an empty block.

### Requirement 12 — Thread evaluation card

**User Story:** As a user with multiple sessions in a thread, I want a thread-level summary card, so that I can see progress at a glance.

#### Acceptance Criteria

1. The thread evaluation card SHALL render ONLY when `thread.evaluation.status === 'completed'` AND the thread has ≥2 sessions with completed evaluations.
2. The card SHALL show `summary`, `trajectory` (rendered as a colored pill: green=improving, grey=stable, red=declining), a metric-trend table (one row per metric with label + trend arrow + comment), `strengths`, `focusAreas`, and `nextSessionFocus`.
3. The "Hidden memory" disclosure SHALL be collapsed by default behind a `<details>` element labeled `Hidden memory — used to steer next session` and SHALL show `memory.hiddenGuidance` when expanded.

### Requirement 13 — Abort handling on unmount

**User Story:** As a developer, I want in-flight evaluations to be cancellable, so that navigating away doesn't waste API quota or cause setState-on-unmounted warnings.

#### Acceptance Criteria

1. WHEN the provider unmounts THEN every entry in the job map SHALL have `abort()` called.
2. WHEN an evaluation is aborted THEN its `fetch` SHALL reject with `AbortError` and the catch branch SHALL leave status as `processing` (not flip to `failed`).

### Requirement 14 — Smoke coverage

**User Story:** As the build owner, I want per-endpoint smoke scripts, so that I can verify the evaluators work against a real Gemini key without spinning up the full UI.

#### Acceptance Criteria

1. `scripts/smoke-evaluate-session.mjs` SHALL POST a fixture transcript for the `recruiter` agent to `/api/evaluate-session` and print the returned evaluation.
2. `scripts/smoke-evaluate-thread.mjs` SHALL POST two fixture evaluations to `/api/evaluate-thread` and print the returned `threadEvaluation`.
3. Both scripts SHALL exit non-zero on HTTP error, JSON parse failure, or a response missing the expected top-level key.
