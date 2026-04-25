# Implementation Gap Audit — 2026-04-24

## Summary

The teammate has shipped a substantial scaffolding under the codename "SimCoach" that covers ~all of the `agents-and-threads` plan, ~all of the `live-session` plan, and — as of commit c05c284 (just pushed) — **real, working `/api/evaluate-session` and `/api/session-resources` endpoints** powered by Gemini structured-JSON-schema responses and a Firecrawl search+scrape+curate pipeline. The matching client orchestration (`runEvaluationJob`, `runResourceJob`) now does real `fetch` + AbortController plumbing and writes results into the existing state slices. Three server endpoints remain stubs: `/api/evaluate-thread` (still no-op), `/api/compare-sessions` (still no-op), `/api/agent-external-context` (still no-op), and `/api/upload-deck` (still no-op). The matching `runThreadEvaluationJob` and `runComparisonJob` in `components/app-provider.js` are still placeholders synthesizing empty results. Apart from a few naming and structural divergences (single 1800-line `session-page.js` vs the split `components/session/*` files our plan requires; `simcoach-state-v1` localStorage key vs `spark-state-v1`; live-session WS protocol differs in every message name; agent ordering in the stale `agents.json` is wrong), the live + agents+threads + evaluation + resources layers are functional. The remaining work is to ship thread-evaluation, session-comparison, external-context, and PDF-upload endpoints, plus the matching client orchestration.

## Per-spec breakdown

### Spec 1: agents-and-threads

- **Done:**
  - All five App Router pages exist and forward params: `app/page.js`, `app/agents/page.js`, `app/agents/[slug]/page.js`, `app/agents/[slug]/threads/[threadId]/page.js`, `app/agents/[slug]/sessions/[sessionId]/page.js`, `app/session/[slug]/page.js`. All ≤7 lines.
  - `components/app-provider.js` (872 lines) implements context, `sanitizeState`, `patchAgent`, `patchSession`, `patchThread`, `createThread`, `selectThread`, `deleteThread`, `deleteSession`, `clearAgentSessions`, `createSessionRecord`, theme persistence, toast queue.
  - `components/landing-page.js` (hero + 3-step), `components/agents-page.js` (5-card grid), `components/agent-detail-page.js` (scenario, criteria, threads CRUD), `components/thread-detail-page.js` (upload, custom context, company URL, sessions history) all built.
  - `data/agents.json` (5 entries) and `data/agents.js` (a richer 5-entry default export — the source of truth `lib/agents.js` actually uses) wired through `lib/agents.js` exposing `AGENTS`, `AGENT_LOOKUP`, `buildMockEvaluation`.
  - `lib/client-config.js` exposes `getApiUrl`, `getBackendHttpUrl`, `getBackendWsUrl`.
  - `app/globals.css` is a heavy themed stylesheet covering every UI region the plans reference.

- **Partial:**
  - `data/agents.json` is missing several fields the `coding` agent and others need (see Cross-cutting concerns); the catalog used at runtime is actually `data/agents.js`, which has the complete shape — `agents.json` is stale/incomplete.
  - `app-provider.js` exposes the slices but uses `localStorage` key `simcoach-state-v1` (line 16) rather than the `spark-state-v1` our plans contract on. Mutator names are mostly aligned, but there is no `appendTranscript`, no `pushToast` exported (only an internal one), no top-level `_jobsRef` / `_autoTriggerRef` exports — instead per-job `useRef(new Map())` instances are private (lines 287-290).

- **Missing:**
  - `lib/ids.js` and `lib/format.js` are not present; ID generation is inlined as `Date.now()-random36` and time formatting is inlined per-component.
  - `scripts/smoke-agents-catalog.mjs` and the entire `scripts/` directory do not exist.
  - `components/shell.js` exists but does NOT live at the top-level wrap site our plan calls for; it is imported per-page. Acceptable but worth flagging.
  - `render.yaml` not committed.

- **Divergences from spec:**
  - `localStorage` key is `simcoach-state-v1` (app-provider.js:16) — every plan assumes `spark-state-v1`.
  - Brand "SimCoach" everywhere (`package.json`, `app/layout.js`, server.js:521, etc.); plans say "Spark".
  - `data/agents.json` is missing `coding` and several fields; `data/agents.js` is the actual runtime source. JSON file is stale.

### Spec 2: live-session

- **Done:**
  - Single Express+Next+ws bootstrap in `server.js` with `/api/health` (line 417), Anam token issuance (lines 422-468), WS upgrade routing for `/api/live` (lines 397-403), per-connection state machine (lines 83-394).
  - WS bridge wires Gemini Live (model `gemini-2.5-flash-native-audio-preview-12-2025`, AUDIO modality with output transcription) AND AssemblyAI streaming on the same socket (lines 226-252), forwarding mic audio to both.
  - System-instruction layering combines agent prompt + custom context + thread context + research + upload context + `screenShareInstruction` (lines 137-162).
  - `components/session-page.js` (1698 lines) implements the entire live session UX: mic permission overlay (lines 1387-1405), preflight/connecting/live/ended/error phase machine, 16 kHz PCM downsampling, Anam SDK integration with audio-stream-to-avatar, screen sharing with PiP window (lines 375-573), CodeMirror with JS/Python/Java/C++/SQL extensions, screen frame sampling at 1.2s intervals (lines 666-718), code-snapshot debounced 3 s sync.
  - `endSession()` builds and persists `SessionRecord` with `transcript`, `coding`, `externalResearch`, `customContext`, `upload` snapshots (lines 1262-1289).
  - Agent-specific `screenShareInstruction` strings live on each agent in `data/agents.js` and are forwarded to Gemini as a text-realtime-input on share start (server.js:339).

- **Partial:**
  - `server.js` is monolithic — the WS bridge, Anam handler, and Gemini wiring all live inline rather than in `server/live-bridge.js`, `server/anam.js`, `server/gemini-live.js` modules per `structure.md`.
  - The plan's WS protocol uses message types `start_session`, `user_transcript`, `transcript`, `transcript_ack`, `mute`, `screen_frame`, `screen_share_state`, `code_snapshot`, `history`, `error`. The actual implementation uses `session_context`, `user_audio`, `user_transcription`, `model_text`, `audio_chunk`, `turn_complete`, `live_closed`, `screen_frame`, `screen_share_state`, `code_snapshot`, `end_session`, `get_history`, `save_model_text`. **The protocols are entirely incompatible** but the implementation is internally consistent and arguably superior for streaming audio.
  - No mic audio is uploaded as text (per plan); instead AssemblyAI does mic transcription server-side and Gemini receives raw PCM directly. Different, working architecture.
  - No mute message goes over the wire — mute is enforced client-side in `processorNode.onaudioprocess` by skipping the send (line 883).
  - `server/assembly-token.js` not built — there's no `/api/assembly-token`. Token usage is server-side only via `ASSEMBLYAI_API_KEY`.

- **Missing:**
  - The `components/session/*` sub-component split does not exist; everything is in `components/session-page.js`.
  - `lib/ws-client.js`, `lib/anam-client.js`, `lib/assemblyai-client.js`, `lib/screen-share.js` are not factored out — all logic is inline in session-page.js.
  - `scripts/smoke-anam-token.mjs`, `scripts/smoke-assembly-token.mjs`, `scripts/smoke-live-handshake.mjs` not present.
  - The plan's avatar pool was 8 entries hashed by slug; teammate's pool is also 8 entries (server.js:51-60) but picks **randomly** (line 73), not slug-deterministic. Voice picked from a male/female list per profile gender.

- **Divergences from spec:**
  - Anam pool is 8 hardcoded UUIDs; plan said "8-entry"; counts match.
  - `gemini-2.5-flash-native-audio-preview-12-2025` matches spec exactly.
  - Screen share normalization (`normalizeDisplaySurface`) maps `browser→tab, window→window, monitor→screen`; plan didn't specify this.
  - PiP window opens via `documentPictureInPicture` API with hand-built DOM — not in plan, additive.
  - WS URL params are `?agent=&voice=` not `?sessionId=&agentSlug=`. Server-side bridge has no notion of `sessionId` — transcripts are not server-persisted (history is stub-empty, server.js:375).

### Spec 3: evaluation-engine

- **Done:**
  - **`POST /api/evaluate-session` is fully wired** (server.js:735-806). It builds a labeled-transcript prompt with the agent's `evaluationPrompt` as `systemInstruction`, sends to `gemini-2.5-flash` with `responseMimeType: "application/json"` and a strongly-typed `evaluationResponseSchema` (server.js:80-108) covering `score`, `summary`, `metrics[].label/score/justification`, `strengths[]`, `improvements[]`, `recommendations[]`, `resourceBriefs[].topic/improvement/whyThisMatters/searchPhrases/resourceTypes`. `normalizeEvaluationResult` (server.js:161-195) clamps every score to 0-100, walks the agent's criteria in order, slices arrays to 4, and caps `resourceBriefs` to 2.
  - **`runEvaluationJob`** in app-provider.js:653-721 fully wires the call: AbortController keyed by `${agentSlug}:${id}` in `evaluationJobsRef`, dispatch `processing` → POST `/api/evaluate-session` with full body (transcript, upload, coding, customContext, durationLabel, startedAt, endedAt) → on success dispatch `completed` with `result: payload.evaluation` AND derive `resourceBriefs` into `session.resources.briefs` and flip `resources.status` to `idle` so the auto-trigger picks them up. On failure: `failed` + toast.
  - State slices: `session.evaluation` and `thread.evaluation` are present with `status/result/error/startedAt/completedAt` lifecycle (lines 30-44, 195-207).
  - `components/session-detail-page.js` renders the score card (line 401-422), four-status branches, rubric metric cards with progress bars and collapsible justifications, three-column lists.
  - `components/thread-detail-page.js` renders thread evaluation card with trajectory pill, metric trends, recurring strengths, focus areas, hidden memory disclosure (lines 377-457).
  - Auto-trigger effects (lines 787-812) re-fire on `processing` status across sessions+threads.

- **Partial:**
  - `/api/evaluate-thread` is still a stub (server.js: returns `{ ok: true, evaluation: null }`); `runThreadEvaluationJob` (lines 626-651) is still a placeholder that immediately marks `completed` with `"Thread evaluation not yet implemented."`. **No real Gemini call for thread-level evaluations.**
  - `applyThreadMemory` is not implemented anywhere. `thread.memory.hiddenGuidance` is read by the live session bridge from state but never written by any job — the dependent live-session "hidden steering" feature is dead code until thread evaluation lands.
  - No `retryEvaluation` / `retryThreadEvaluation` action wired to the failed-state UI.

- **Missing:**
  - `server/evaluation.js` module does not exist (logic lives inline in `server.js`). Acceptable — single-file backend pattern is consistent across the codebase.
  - `composeThreadPrompt`, `normalizeThreadEvaluation`, `safeThreadDefaults` — none implemented.
  - `scripts/fixtures/recruiter-transcript.json`, `recruiter-thread.json`, `smoke-evaluate-session.mjs`, `smoke-evaluate-thread.mjs` — none present.
  - `weight` field on `evaluationCriteria` not present in the catalog (plans tolerate this — equal weights).

- **Divergences from spec:**
  - **Server returns `metrics[].score` (plan calls it `value`).** `normalizeEvaluationResult` translates `score → value` before persisting (server.js:170), so the client sees `value` consistently. Plan-internal naming was `value` end-to-end; the rename works but is worth noting.
  - Recommendations are capped at 4 (plan says 4, matches).
  - `resourceBriefs` capped at 2 server-side (plan says 4). Two is plenty for the UI; flag for spec sync.
  - Plan recomputes `score` server-side as a weighted mean of metrics; teammate trusts the model's `score` (clamped) rather than recomputing. With no `weight` field on criteria, the difference is small but not exact.
  - Resource brief rendering is inlined into the same metric-card component as the evaluation; plan separates `resourceBriefs` (in evaluation result) from `resources` (fetched). The teammate's `deriveResourceBriefs` helper at app-provider.js:218-274 synthesizes fallback briefs from `improvements`+`metrics` when `resourceBriefs` absent, which is additive.

### Spec 4: research-and-resources

- **Done:**
  - **`POST /api/session-resources` is fully wired** (server.js:809-840). It hard-fails with 400 if `FIRECRAWL_API_KEY` is missing, then runs `Promise.all` over up to 2 briefs. Each brief flows through `fetchResourcesForBrief` (server.js:286-330): two parallel Firecrawl searches (one biased to YouTube, one to articles/leetcode for coding), dedupe by URL, scrape candidates that lack a snippet, then call Gemini `gemini-2.5-flash` with `responseMimeType: "application/json"` and `tinyFishArticlesSchema` (server.js:110-124) to curate the top 4. Output items have `{title, url, type, source, reason}`.
  - **`searchFirecrawl`** (server.js:204-216) and **`scrapeWithFirecrawl`** (server.js:218-229) are real HTTP wrappers around `https://api.firecrawl.dev/v1/search` and `/v2/scrape` with `markdown` formats and `onlyMainContent: true`.
  - **`runResourceJob`** in app-provider.js:574-624 fully wires the call: AbortController keyed by `${agentSlug}:${id}` in `resourceJobsRef`, dispatch `processing` → POST `/api/session-resources` → on success store `topics: payload.topics` and toast. On failure: `failed`. Auto-trigger fires after evaluation completes via `runEvaluationJob` setting `resources.status: "idle"` with derived briefs.
  - State slices: `state.agents[slug].upload`, `state.agents[slug].researchPrep`, `state.agents[slug].companyUrl`, `state.agents[slug].customContextText` all exist (app-provider.js:48-66).
  - `state.sessions[slug][i].externalResearch` and `state.sessions[slug][i].resources` defaults present (lines 192-208, 781-789).
  - `thread-detail-page.js` wires the file input to `/api/upload-deck` (lines 65-96) and conditionally calls `/api/agent-external-context` for `coding`/`investor`/`custom` (lines 115-162).
  - `session-detail-page.js` renders the resources accordion with topic groups, YouTube icon, external link icon, count pill, all four status states (lines 425-522).

- **Partial:**
  - `/api/upload-deck` is still a stub (server.js:842-845) — returns empty `contextText`. No multer, no pdf-parse pipeline.
  - `/api/agent-external-context` is still a stub (server.js:725-732) — always returns `research: null`. No LangChain ReAct, no Firecrawl, no `extractCompanyName`.
  - The thread-detail-page.js client code that calls `/api/agent-external-context` will receive `null` and proceed to the live session without research.

- **Missing:**
  - `server/firecrawl.js`, `server/upload.js`, `server/external-context.js`, `server/resources.js` modules — logic lives inline in `server.js` for the resources path; the upload + external-context modules don't exist.
  - `langchain`, `@langchain/google-genai`, `multer`, `pdf-parse`, `zod` listed in `package.json` deps but **none are imported anywhere**. The teammate's resources implementation bypasses LangChain entirely — it does plain `fetch` + a single Gemini structured-output call. This is simpler and works, but means the ReAct-agent design from the plan is unused.
  - `extractCompanyName`, `runCompanyResearch`, `runCodingQuestionResearch`, `runCustomResearch` — none implemented.
  - `scripts/fixtures/sample.pdf`, `scripts/smoke-firecrawl.mjs`, `scripts/smoke-upload-deck.mjs`, `scripts/smoke-external-context.mjs`, `scripts/smoke-session-resources.mjs` — none present.
  - `uploads/` directory and `.gitignore` entry — not verified.
  - Mutators `uploadDeck`, `clearUpload`, `runResearchPrep` not exposed on the actions bag — that logic lives inline in `thread-detail-page.js` (functional but not the plan's separation).

- **Divergences from spec:**
  - **Resources implementation is much simpler than the plan's ReAct agent.** Plan called for `createAgent` from `langchain` with Zod-typed `searchWeb`/`scrapeWebsite` tools, `maxIterations: 6`. Teammate does two parallel `searchFirecrawl` calls + one `curateResourceCandidates` Gemini call. **It works and is faster**, but it doesn't iterate. Decision needed: keep the simpler shape or rebuild on ReAct.
  - Plan: 5 resources per brief; teammate: 4 (`tinyFishArticlesSchema` allows arbitrary count, but `slice(0,4)` at server.js:830 and again at 329).
  - Plan: 5 briefs per session; teammate: 2 briefs (server.js:816 — `briefs.slice(0,2)`).
  - Resource items use field name `reason` (server.js:282); plan calls it `reason_relevant`. The schema accepts `reason_relevant` from Gemini, then the curator renames it to `reason` in the response. Frontend reads `item.reason` (session-detail-page.js:503).
  - `coding` agent gets specially crafted Firecrawl queries biased toward `leetcode.com / neetcode.io / geeksforgeeks.org` (server.js:295-297). Not in the plan, additive.
  - `professor` is excluded from `/api/agent-external-context` calls in the frontend (thread-detail-page.js:115); plan says professor short-circuits server-side. Same outcome, different layer.
  - `recruiter` is **not** in the conditional fetch list at thread-detail-page.js:115 — only `coding/investor/custom` trigger external context. The product steering doc says recruiter does company research; flag for product decision.

### Spec 5: session-comparison

- **Done:**
  - State slice `session.comparison` with `status / baselineSessionId / result / error` shape exists (app-provider.js:18-25, 195-208).
  - `components/session-detail-page.js` renders the comparison panel (lines 524-617): baseline dropdown filtered to other completed sessions, Compare button, processing/failed/completed branches, trend chip, per-metric delta cards with `+/-` formatting and `improved/declined/neutral` colour classes.
  - Auto-trigger on processing status exists (app-provider.js:743-746).

- **Partial:**
  - `runComparisonJob` (app-provider.js:671-690) is a placeholder that returns `{ trend: "similar", summary: "Session comparison not yet implemented.", metrics: [] }` without calling the API.
  - `/api/compare-sessions` returns `{ ok: true, comparison: null, message: "Session comparison not yet implemented." }` (server.js:491-493).

- **Missing:**
  - `server/comparison.js` module — not present.
  - `computeDeltas`, `composePrompt`, `normalizeComparison`, `mechanicalFallback`, `resolveGeminiKey` — none implemented.
  - `components/comparison-panel.js` as a separate file does not exist; the panel is inlined in session-detail-page.js (acceptable; less of a hard divergence).
  - `scripts/fixtures/eval-current.json`, `eval-baseline.json`, `smoke-compare-sessions.mjs` — none present.

- **Divergences from spec:**
  - `runComparisonJob` does not match the plan's prior-controller-abort + AbortController-keyed-by-`comparison:${sessionId}` pattern. The teammate uses the existing `comparisonJobsRef` (app-provider.js:289) but only registers it during `clearAgentSessions`/`deleteSession` cleanup, not during the actual job lifecycle.
  - Comparison eligibility filter does NOT scope to `same threadId` — the teammate filters only by `id !== sessionId && evaluation.status === 'completed'` (session-detail-page.js:236-240). Plan requires `s.threadId === threadId`. Cross-thread baselines are currently allowed.

## Cross-cutting concerns

- **Agent catalog** — `data/agents.json` has 4 entries (`professor`, `recruiter`, `investor`, `custom` — coding is **missing**) and lacks `contextFieldLabel`, `contextFieldDescription`, `screenShareTitle`, `screenShareHelperText`, `screenShareEmptyText`, `screenShareInstruction`, `codingLanguages`, `codingQuestionBank`, `sessionKickoff`. **`data/agents.js` is the actual runtime catalog** (imported by `lib/agents.js`); it has all 5 agents with all those fields. The `.json` file is stale and should be brought up to parity or deleted. Both `evaluationPrompt` and `mockEvaluation` exist on every agent. `weight` not present on `evaluationCriteria` items (plans tolerate this).

- **AppProvider state shape** — most slices are present and the right shape: `agents[slug].upload/researchPrep/sessionName/threadName/customContextText/companyUrl/selectedThreadId/session/evaluation/rating`; `threads[slug][i].evaluation/memory/sessionIds/title/createdAt/updatedAt`; `sessions[slug][i].transcript/upload/externalResearch/coding/customContext/evaluation/resources/comparison/threadId/sessionName/startedAt/endedAt/durationLabel`. Missing/unexposed actions: `appendTranscript`, `pushToast` (internal only), `applyThreadMemory`, `retryEvaluation`, `retryThreadEvaluation`, `uploadDeck`, `clearUpload`, `runResearchPrep`, `fetchSessionResources`, `runComparison`. The plans reserve `actions._jobsRef` / `actions._autoTriggerRef` for cross-spec consumption — these refs exist privately but are not exposed.

- **Server endpoints** present in `server.js` (post c05c284):
  - `GET  /api/health` (line 671) — live-session.
  - `POST /api/anam-session-token` (line 676) — live-session, **fully implemented**.
  - `POST /api/agent-external-context` (line 726) — research-and-resources, **stub**.
  - `POST /api/evaluate-session` (line 735) — evaluation-engine, **fully implemented (Gemini structured JSON)**.
  - `POST /api/evaluate-thread` — evaluation-engine, **NO LONGER MOUNTED** (the stub was removed in c05c284 but no real handler replaced it; the route does not exist now). Frontend `runThreadEvaluationJob` is a no-op that doesn't call any API, so this is currently invisible.
  - `POST /api/compare-sessions` — session-comparison, **NO LONGER MOUNTED** (also removed in c05c284). Frontend `runComparisonJob` is a no-op placeholder.
  - `POST /api/session-resources` (line 809) — research-and-resources, **fully implemented (Firecrawl + Gemini)**.
  - `POST /api/upload-deck` (line 843) — research-and-resources, **stub** (no multer mounted).
  - `WS   /api/live` (line 80, 397, mount at 651) — live-session, **fully implemented (with divergent protocol)**.
  - Missing: `GET /api/assembly-token` (live-session plan T4) — token issuance is bypassed because AssemblyAI is server-side only.

- **WebSocket bridge** — `server.js` registers WS at `/api/live` and dispatches on `msg.type`. Implemented messages: `session_context`, `user_audio`, `screen_frame`, `screen_share_state`, `code_snapshot`, `end_session`, `get_history`, `save_model_text`. Outbound: `status`, `model_text`, `user_transcription`, `audio_chunk`, `turn_complete`, `live_closed`, `error`, `history`. **The plan's protocol (`start_session`, `user_transcript`, `transcript`, `transcript_ack`, `mute`, etc.) is entirely absent.** This is a deliberate, working architectural choice (binary audio path with AssemblyAI server-side) but every other spec that references the WS message names will need to either adopt the new protocol or be reconciled. URL params are `?agent=<slug>&voice=<voiceName>` rather than `?sessionId=&agentSlug=`. No `sessionId` plumbing on the server — transcripts are persisted only on the client.

- **package.json** — installed: `@anam-ai/js-sdk`, `@codemirror/*`, `@google/genai`, `@langchain/google-genai`, `@uiw/react-codemirror`, `assemblyai`, `buffer`, `cors`, `cross-env`, `dotenv`, `express`, `langchain`, `multer`, `next ^15.3.1`, `pdf-parse`, `react ^19.1.0`, `react-dom`, `ws`, `zod`. **All plan-required deps are present**, including `langchain`, `multer`, `pdf-parse`, `zod` which are unused so far. `@langchain/core` is **not** explicitly in dependencies (plan §research-and-resources Task 7 imports from it); it ships transitively through `langchain` so this may be fine. No `eslint` / `eslint-config-next`. No `dev` `prettier`.

- **Their `.kiro/specs/sim-coach/` spec** — A single monolithic spec ("PitchMirror — Live AI Rehearsal Platform") covering the same scope as our five plans combined. The shape is similar — five agents, threads, sessions, evaluation, resources, comparison, live WS bridge — but it bundles every concern into one `requirements.md` / `design.md` / `tasks.md` triplet (1008 lines total), uses the brand "PitchMirror" / "SimCoach", names the localStorage key `pitchmirror-state-v1`, and treats the WS protocol around mic/audio streaming + AssemblyAI server-side as load-bearing (which is what got built). **Recommendation: supersede it.** Our 5-spec decomposition is what every plan in `docs/superpowers/plans/` was authored against, and the contract handoff blocks in those plans depend on the slice ownership being split. Keep `sim-coach/` for historical reference but treat the five Spark specs in `.kiro/specs/{agents-and-threads,live-session,evaluation-engine,research-and-resources,session-comparison}/` as authoritative.

## Recommended execution order

Post-c05c284, the highest-leverage gaps are the four still-stubbed/missing endpoints. Group for parallelism:

1. **[Agent A — research+resources missing pieces]** Build `/api/upload-deck` (multer + pdf-parse + Gemini cleanup) and `/api/agent-external-context` (Firecrawl search/scrape + agent-specific prompts dispatched on `agentSlug`). These two are independent files in `server.js`. Replace the stubs at server.js:725-732 and 842-845. Pattern after the now-working `/api/session-resources` block. `langchain` may or may not be needed — match the simpler approach the teammate already adopted unless the iteration is required.
2. **[Agent B — thread evaluation]** Add `/api/evaluate-thread` to `server.js` (it was removed in c05c284 — currently absent). Compose a thread-level prompt over the completed sessions in the thread, call `gemini-2.5-flash` with a `threadEvaluationResponseSchema`, return `{ summary, trajectory, comments[], strengths[], focusAreas[], nextSessionFocus, metricTrends[], hiddenGuidance }`. Then replace `runThreadEvaluationJob` (app-provider.js:626-651) with real fetch logic and an `applyThreadMemory` hook so `thread.memory.hiddenGuidance` is actually written — this is what unlocks the live-session "hidden steering" feature already wired into the system instruction (server.js:403-405).
3. **[Agent C — comparison]** Add `/api/compare-sessions` to `server.js` (also removed in c05c284). Compute deltas mechanically, ask Gemini for a trend label and per-metric insight, fall back to mechanical-only on Gemini failure. Replace `runComparisonJob` (app-provider.js:735-754) with real fetch logic and AbortController plumbing. Also: scope the eligibility filter at `session-detail-page.js:236` to `s.threadId === session.threadId`.
4. **[Agent D — retry wiring]** Add `retryEvaluation` / `retryThreadEvaluation` mutators and wire the failed-state UI buttons (session-detail-page.js:392-399, thread-detail-page.js:389-398). With real Gemini in production these will be hit immediately — the missing retry button is a usability cliff.
5. **[Parallel — protocol reconciliation]** Decide whether to update the live-session plan to match the implemented WS protocol (`session_context` / `user_audio` / `model_text`) or rewrite the bridge to the plan's protocol. Recommend: update the plan. The implementation streams better.
6. **[Parallel — data hygiene]** Delete or fix `data/agents.json` (the runtime catalog is `data/agents.js`). The stale JSON is missing the `coding` agent and several fields.
7. **[Parallel — smoke scripts]** Author `scripts/smoke-evaluate-session.mjs`, `smoke-session-resources.mjs`, `smoke-firecrawl.mjs` against the now-working endpoints. Quick wins.
8. **[Optional]** Recruiter inclusion in research conditional (thread-detail-page.js:115) — product decision: should recruiter trigger company research? Spec says yes.
9. **[Optional]** Rebrand `simcoach-state-v1` → `spark-state-v1` and "SimCoach" → "Spark" across UI/server. Cosmetic; not blocking.
10. **[Optional]** Refactor `components/session-page.js` (1698 lines) and `server.js` (870 lines) into the per-spec module split that `structure.md` calls for. Maintainability; not blocking.

## Risk flags

- **Stale `data/agents.json`** lacks the `coding` agent; if any consumer accidentally imports it instead of `data/agents.js`, the coding flow breaks. Recommend deleting the file once we confirm no imports reach it.
- **Recruiter is missing from research conditional** in `thread-detail-page.js:115` — product spec says recruiter does company research, but only `coding/investor/custom` trigger `/api/agent-external-context`. Easy fix; flag because users will hit it.
- **Comparison filter does NOT scope to thread** (`session-detail-page.js:236`) — currently any completed session across the agent is offered as a baseline, not just sessions in the same thread. Plan requires same-thread.
- **`localStorage` key mismatch** — `simcoach-state-v1` vs `spark-state-v1`. Cross-spec contracts assume the latter; if any future code reads `localStorage` directly it will miss data.
- **WS protocol divergence** — every plan-doc reference to `start_session` / `user_transcript` / `transcript` / `transcript_ack` is wrong against the running code. Future engineers reading the plan will be confused.
- **No retry button anywhere** — the failed-state UI in session-detail-page.js (line 392-399) and thread-detail-page.js (line 389-398) shows the error but there is no `retry...` mutator wired to a click. With real Gemini failures becoming routine once endpoints are live, this will be painful immediately.
- **`/api/evaluate-thread` and `/api/compare-sessions` routes were silently removed in c05c284** rather than left as stubs. The frontend's `runThreadEvaluationJob` and `runComparisonJob` placeholders never call those URLs anyway, so nothing broke — but now there is no server-side scaffolding to extend, only the agreed plan. Future engineers should re-add the routes from scratch.
- **`thread.memory.hiddenGuidance` is consumed by the live bridge but never written.** server.js:403-405 reads `sessionThreadContext` from the `session_context` message; the client (session-page.js:916) sends `thread?.memory?.hiddenGuidance || ""`. But no job ever populates `thread.memory.hiddenGuidance` because thread evaluation is stubbed. The wiring is correct end-to-end; just empty.
- **`sessionId` is unknown to the server-side WS bridge** — the URL only carries `?agent=&voice=`. Server cannot persist transcripts, replay history, or correlate live audio with the session record. `get_history` always returns `[]` (server.js:374-377). If any spec needs server-side session memory (e.g., for resume), this needs to be added.
- **Anam avatar / voice randomization** is per-session, non-deterministic (server.js:73). If we want consistent avatars per agent (plan said hashed-by-slug), this needs changing.
- **PDF upload stub returns empty `contextText`** so the frontend's "Document preview" section will render with `upload.contextPreview === ""` once a real `multer` route lands. The UI (thread-detail-page.js:298-353) handles this gracefully but will look broken until the real pipeline ships.
- **`@langchain/core` not in dependencies explicitly** — plan §research-and-resources Task 7 imports `tool` from `@langchain/core/tools`. May resolve transitively, but could break on a clean install. Verify before relying on it.
- **No `uploads/` directory** is created and `.gitignore` was not verified to contain it. Real `multer` route at `dest: 'uploads/'` will throw on first run if the directory doesn't exist.
- **`process.on("uncaughtException")` swallowing errors** in server.js:14-19 will hide bugs during development. Useful for production WS resilience, dangerous during the next round of API work.
