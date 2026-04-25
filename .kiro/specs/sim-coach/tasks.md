# Tasks: PitchMirror — Live AI Rehearsal Platform

## Task 1: Project Scaffold

- [ ] 1.1 Create `sim-coach/` directory at workspace root and initialize a Next.js 15 project with App Router and JavaScript (no TypeScript)
  - Copy `package.json` from reference with exact dependency versions, update `name` to `sim-coach`
  - Requirement: 1.1
- [ ] 1.2 Create `next.config.mjs` matching the reference (ESM, no special config needed beyond defaults)
- [ ] 1.3 Create `.env.example` listing all required and optional environment variables with descriptions
  - Requirement: 1.3
- [ ] 1.4 Create `.gitignore` covering `node_modules/`, `.env`, `uploads/`, `.next/`
- [ ] 1.5 Create `uploads/` directory (empty, for multer temp files)

## Task 2: Agent Data

- [ ] 2.1 Create `sim-coach/data/agents.js` — copy the full agent config array from the reference for all 5 agents (`professor`, `recruiter`, `investor`, `coding`, `custom`) with all fields: slug, name, role, duration, description, longDescription, scenario, focus, flow, previewMetrics, contextFieldLabel, contextFieldDescription, screenShare fields, evaluationCriteria, systemPrompt, evaluationPrompt, mockEvaluation, and coding-specific fields
  - Requirement: 3.1, 3.2, 3.3, 3.4
- [ ] 2.2 Create `sim-coach/data/agents.json` — same data as agents.js but as a JSON file (for any tooling that needs it)
- [ ] 2.3 Create `sim-coach/lib/agents.js` — exports `AGENTS`, `AGENT_LOOKUP`, `DEFAULT_METRICS`, `EVALUATION_CRITERIA`, and `buildMockEvaluation(slug)`
- [ ] 2.4 Create `sim-coach/lib/client-config.js` — exports `getBackendHttpUrl()`, `getBackendWsUrl()`, and `getApiUrl(path)` using `NEXT_PUBLIC_BACKEND_HTTP_URL` / `NEXT_PUBLIC_BACKEND_WS_URL` env vars with same-origin fallback
  - Requirement: 1.4, 1.5

## Task 3: Global Styles and Layout

- [ ] 3.1 Create `sim-coach/app/globals.css` — copy the full CSS from the reference including all CSS custom properties for dark/light themes, all component classes (buttons, cards, panels, transcript, code editor, resource accordion, comparison, session layout, etc.), and all responsive breakpoints
  - Requirement: 18.3
- [ ] 3.2 Create `sim-coach/app/layout.js` — root layout wrapping children in `AppProvider`, setting `<html lang="en" suppressHydrationWarning>`, and metadata for title "PitchMirror"
  - Requirement: 19.1

## Task 4: AppProvider (State Management)

- [ ] 4.1 Create `sim-coach/components/app-provider.js` — implement `AppProvider` with React Context, `useState`, and `useEffect` for localStorage persistence
  - State shape: `{ theme, agents: { [slug]: agentState }, threads: { [slug]: Thread[] }, sessions: { [slug]: Session[] } }`
  - Requirement: 2.1, 2.2, 2.3, 2.4
- [ ] 4.2 Implement `buildInitialAgentState()` — creates default state for all 5 agents with upload, session, researchPrep, evaluation, and rating fields
  - Requirement: 2.1
- [ ] 4.3 Implement `sanitizeState(state)` — safely merges persisted state with defaults, handles missing/corrupt fields, resets transient session status to "idle"
  - Requirement: 2.4
- [ ] 4.4 Implement `patchAgent(slug, updater)`, `patchSession(slug, sessionId, updater)`, `patchThread(slug, threadId, updater)` — immutable state updaters
- [ ] 4.5 Implement `createThread(slug, title)` — creates thread with unique ID, sets `selectedThreadId`, clears `threadName`
  - Requirement: 4.1
- [ ] 4.6 Implement `selectThread(slug, threadId)`, `createSessionRecord(slug, sessionData)`, `clearAgentSessions(slug)`
- [ ] 4.7 Implement `deleteSession(slug, sessionId)` — removes session, updates thread `sessionIds`, aborts in-flight jobs
  - Requirement: 2.5
- [ ] 4.8 Implement `deleteThread(slug, threadId)` — removes thread and all its sessions, aborts all in-flight jobs
  - Requirement: 2.6
- [ ] 4.9 Implement `runEvaluationJob(session)` — POST to `/api/evaluate-session`, store result, derive resource briefs, push toast
  - Requirement: 13.1, 13.2, 13.3
- [ ] 4.10 Implement `runResourceJob(session)` — POST to `/api/session-resources`, store topics, push toast
  - Requirement: 16.1, 16.3, 16.4
- [ ] 4.11 Implement `runComparisonJob(session, baselineSessionId)` — POST to `/api/compare-sessions`, store result, push toast
  - Requirement: 15.2, 15.3
- [ ] 4.12 Implement `runThreadEvaluationJob(slug, threadId)` — POST to `/api/evaluate-thread`, store result and hiddenGuidance in thread memory
  - Requirement: 14.1, 14.2
- [ ] 4.13 Implement `requestResourceFetch(slug, sessionId)` and `requestSessionComparison(slug, sessionId, baselineId)` — public wrappers that look up session and call the job functions
  - Requirement: 16.1, 15.2
- [ ] 4.14 Implement `deriveResourceBriefs(agentSlug, evaluation)` — extracts up to 2 resource briefs from evaluation result or falls back to lowest-scoring metrics
  - Requirement: 13.5
- [ ] 4.15 Implement toast system: `pushToast(message)` with 4-second auto-dismiss, `dismissToast(id)`, expose `toasts` array via context
  - Requirement: 19.2, 19.3
- [ ] 4.16 Implement theme effect: on state change, write `document.documentElement.dataset.theme` and persist to localStorage
  - Requirement: 18.1, 18.2
- [ ] 4.17 Export `useAppState()` hook that reads from `AppContext` and throws if used outside provider

## Task 5: Shell Component

- [ ] 5.1 Create `sim-coach/components/shell.js` — implement `AppShell` component with topbar (PitchMirror brand link, theme toggle button with sun/moon SVG icons), toast stack rendering, and `page-frame` wrapper
  - Requirement: 19.1, 19.2, 19.3

## Task 6: Landing Page

- [ ] 6.1 Create `sim-coach/app/page.js` — renders `LandingPage` component
- [ ] 6.2 Create `sim-coach/components/landing-page.js` — hero section with title, copy, "View Agents" CTA button; three-step "How a session feels" panel with step cards
  - Requirement: 17.1

## Task 7: Agents Page

- [ ] 7.1 Create `sim-coach/app/agents/page.js` — renders `AgentsPage` component
- [ ] 7.2 Create `sim-coach/components/agents-page.js` — renders grid of 5 agent cards, each linking to `/agents/[slug]`, showing role badge, duration pill, name, description, and focus chips
  - Requirement: 17.2

## Task 8: Agent Detail Page

- [ ] 8.1 Create `sim-coach/app/agents/[slug]/page.js` — renders `AgentDetailPage` with `slug` param
- [ ] 8.2 Create `sim-coach/components/agent-detail-page.js` — agent info section (name, description, scenario, evaluation criteria grid with show more/less toggle), thread creation form (thread name input + "New thread" button), thread list with session count, last updated, evaluation summary, and action buttons (Continue, View, Delete)
  - Requirement: 4.1, 4.2, 4.3, 4.4, 17.3, 17.7

## Task 9: Thread Detail Page

- [ ] 9.1 Create `sim-coach/app/agents/[slug]/threads/[threadId]/page.js` — renders `ThreadDetailPage` with `slug` and `threadId` params
- [ ] 9.2 Create `sim-coach/components/thread-detail-page.js` — thread overview card (session count, average score, delete button), session creation form (session name, custom context textarea, company URL for coding/investor/custom, PDF upload with preview), thread evaluation panel (trajectory, next session focus, metric trends, strengths, focus areas, hidden memory — all collapsible), past sessions list with links and delete buttons
  - Requirement: 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 14.4, 17.4

## Task 10: Session Detail Page

- [ ] 10.1 Create `sim-coach/app/agents/[slug]/sessions/[sessionId]/page.js` — renders `SessionDetailPage` with `slug` and `sessionId` params
- [ ] 10.2 Create `sim-coach/components/session-detail-page.js` — session info card (agent, file, thread link, custom context, external research brief), coding workspace card (coding agent only: language, company URL, interview question markdown, final code), evaluation card (score, metric cards with progress bars and justification toggle, strengths, improvements, recommendations), improvement resources card (fetch button, processing state, accordion of topic groups with resource cards), session comparison card (baseline selector, compare button, delta metrics grid), transcript card (scrollable, expand/collapse toggle)
  - Requirement: 13.2, 13.3, 15.1, 15.3, 16.1, 16.3, 16.4, 16.5, 17.5

## Task 11: Session Page (Live Room)

- [ ] 11.1 Create `sim-coach/app/session/[slug]/page.js` — renders `SessionPage` with `slug` param
- [ ] 11.2 Create `sim-coach/components/session-page.js` — implement the full live session room
  - Requirement: 10.1 through 10.10, 11.1 through 11.5, 12.1 through 12.5, 17.6
- [ ] 11.3 Implement audio utility functions: `floatTo16BitPCM`, `downsampleFloat32`, `int16ToBase64`, `base64ToUint8Array`, `pcmBytesToInt16Array`, `downsampleInt16`, `formatDuration`
- [ ] 11.4 Implement `createMicPipeline(mediaStream)` — creates `AudioContext`, `ScriptProcessor` (4096 samples), `GainNode`; on `onaudioprocess` downsamples to 16kHz and sends `user_audio` via WebSocket when not muted
  - Requirement: 10.4
- [ ] 11.5 Implement `attachSocketHandlers(socket)` — handles all incoming WebSocket message types: `status`, `live_closed`, `error`, `model_text`, `user_transcription`, `audio_chunk`; on open sends `session_context` and `get_history`
  - Requirement: 10.6, 10.7
- [ ] 11.6 Implement `startSessionFlow(mediaStream)` — fetches Anam session token, creates Anam client, streams to video element, opens WebSocket, creates mic pipeline, sets session phase to "live"
  - Requirement: 10.3
- [ ] 11.7 Implement `endSession()` — sends `end_session` via WebSocket, calls `createSessionRecord()` with transcript/coding/upload data, navigates to `/agents/[slug]?ended=1`
  - Requirement: 10.8
- [ ] 11.8 Implement `performCleanup()` — stops mic stream, closes AudioContext, closes WebSocket, stops screen stream, closes PiP window, stops Anam client
- [ ] 11.9 Implement `toggleMute()` — toggles `mutedRef` and `agentState.session.muted`, updates gain node
- [ ] 11.10 Implement CodeMirror integration: language selector, `getCodingLanguageExtensions(language)`, debounced `code_snapshot` sending (3s debounce), sync state indicator
  - Requirement: 11.1, 11.2, 11.3, 11.4
- [ ] 11.11 Implement screen share: `startScreenShare()`, `stopScreenShare()`, `notifyScreenShareState()`, frame capture loop (1200ms interval, canvas JPEG at 0.72 quality, max 1280px wide)
  - Requirement: 12.1, 12.2, 12.3, 12.4
- [ ] 11.12 Implement Picture-in-Picture: `openPipWindow()`, `closePipWindow()` using `documentPictureInPicture` API with avatar video, mute/stop/end buttons
  - Requirement: 12.5
- [ ] 11.13 Implement session guards: redirect to `/agents/[slug]` if `sessionName` is empty or no thread is selected
  - Requirement: 10.9, 10.10
- [ ] 11.14 Implement transcript management: `mergeTranscriptChunk()`, `flushUserTranscript()`, `finalizeUserBuffer()`, live buffer display, auto-scroll

## Task 12: server.js — Foundation

- [ ] 12.1 Create `sim-coach/server.js` — set up Express app, HTTP server, Next.js integration, CORS, multer, dotenv, and WebSocket server
  - Requirement: 1.1
- [ ] 12.2 Implement `getGeminiApiKey(task)` — checks task-specific env vars with fallback to `GEMINI_API_KEY`, throws descriptive error if none found
  - Requirement: 1.3
- [ ] 12.3 Define `ANAM_AVATAR_PROFILES` array (8 profiles with name, avatarId, gender) and `GEMINI_VOICE_BY_GENDER` map
  - Requirement: 8.3
- [ ] 12.4 Implement `pickRandomItem(items)` and `pickRandomAnamProfile()` — picks random profile and matching voice
  - Requirement: 8.1
- [ ] 12.5 Implement response schema objects for Gemini structured output: `evaluationResponseSchema`, `comparisonResponseSchema`, `threadEvaluationResponseSchema`, `tinyFishArticlesSchema`
- [ ] 12.6 Implement utility functions: `normalizeTranscriptRole()`, `buildTranscriptText()`, `buildCodingContext()`, `buildExternalResearchContext()`, `normalizeEvaluationResult()`, `normalizeComparisonResult()`
- [ ] 12.7 Implement Firecrawl utilities: `searchFirecrawl(query, options)`, `scrapeWithFirecrawl(url)`, `domainFromUrl()`, `normalizeHttpUrl()`, `companyNameFromUrl()`, `normalizeFirecrawlCandidates()`
- [ ] 12.8 Implement `GET /api/health` route returning `{ status: "ok" }`
  - Requirement: 1.2

## Task 13: server.js — HTTP API Routes

- [ ] 13.1 Implement `POST /api/anam-session-token` — call Anam REST API with `ANAM_API_KEY`, pick random profile + voice, return `{ sessionToken, avatarId, voiceName, avatarName }`
  - Requirement: 8.1, 8.2, 8.3
- [ ] 13.2 Implement `POST /api/upload-deck` — accept PDF via multer (`upload.single("deck")`), parse with `pdf-parse`, send to Gemini (`uploadPrep` key) for cleaning, return `{ contextText, contextPreview, fileName }`, delete temp file
  - Requirement: 6.1, 6.2, 6.3
- [ ] 13.3 Implement `POST /api/agent-external-context` — validate `companyUrl` and `FIRECRAWL_API_KEY`, run LangChain agent with search + scrape tools, return `{ research }` or `{ message }` if no URL
  - Requirement: 7.1, 7.2, 7.3, 7.4, 7.5
- [ ] 13.4 Implement LangChain agent setup: `searchTool` (Firecrawl search with Zod schema), `scrapeTool` (Firecrawl scrape with Zod schema), `ChatGoogleGenerativeAI` model, `createAgent()` with agent-specific system prompts for coding/investor/custom
  - Requirement: 7.1, 7.2, 7.3
- [ ] 13.5 Implement `POST /api/evaluate-session` — build evaluation prompt from transcript + agent rubric, call Gemini with `evaluationResponseSchema`, normalize result, return `{ evaluation }`
  - Requirement: 13.4, 13.5
- [ ] 13.6 Implement `POST /api/evaluate-thread` — build thread analysis prompt from all session evaluations, call Gemini with `threadEvaluationResponseSchema`, return `{ threadEvaluation }`
  - Requirement: 14.3
- [ ] 13.7 Implement `POST /api/compare-sessions` — build comparison prompt from two evaluation results, call Gemini with `comparisonResponseSchema`, normalize with actual metric deltas, return `{ comparison }`
  - Requirement: 15.4
- [ ] 13.8 Implement `POST /api/session-resources` — for each brief call `fetchResourcesForBrief()`, return `{ topics }`
  - Requirement: 16.2
- [ ] 13.9 Implement `fetchResourcesForBrief(brief)` — run two Firecrawl searches, deduplicate, enrich with scraping, curate with Gemini via `curateResourceCandidates()`
  - Requirement: 16.2
- [ ] 13.10 Implement `curateResourceCandidates(brief, candidates)` — call Gemini with `tinyFishArticlesSchema` to select best resources from candidates
  - Requirement: 16.2

## Task 14: server.js — WebSocket Handler

- [ ] 14.1 Implement WebSocket upgrade handler for `/api/live` — parse `agent` and `voice` query params, look up agent config, set up Gemini Live session and AssemblyAI transcriber
  - Requirement: 9.1
- [ ] 14.2 Implement Gemini Live session setup — `GoogleGenAI({ apiKey: getGeminiApiKey("live") })`, `ai.live.connect({ model, config: { systemInstruction, speechConfig: { voiceConfig } } })`, handle `message` events for audio and text output
  - Requirement: 9.4, 9.5
- [ ] 14.3 Implement AssemblyAI RealtimeTranscriber setup — connect with `ASSEMBLYAI_API_KEY`, relay `transcript` events to browser as `user_transcription` messages
  - Requirement: 9.6
- [ ] 14.4 Implement `session_context` handler — build full system prompt from agent base prompt + custom context + thread memory + upload context + external research, send to Gemini as system instruction update
  - Requirement: 9.2
- [ ] 14.5 Implement `user_audio` handler — forward base64 PCM to Gemini `sendRealtimeInput({ audio: { data, mimeType } })`
  - Requirement: 9.3
- [ ] 14.6 Implement `screen_frame` handler — forward base64 JPEG to Gemini `sendRealtimeInput({ media: { data, mimeType } })`
  - Requirement: 9.7
- [ ] 14.7 Implement `code_snapshot` handler — format code as text context message and send to Gemini
  - Requirement: 9.8
- [ ] 14.8 Implement `end_session` handler — close Gemini Live session, close AssemblyAI, send `live_closed` to browser
  - Requirement: 9.9
- [ ] 14.9 Implement WebSocket `close` and `error` handlers — clean up Gemini and AssemblyAI connections
  - Requirement: 9.10
- [ ] 14.10 Implement Gemini audio output relay — on Gemini `audio` event, encode PCM as base64 and send `audio_chunk` to browser
  - Requirement: 9.4
- [ ] 14.11 Implement Gemini text output relay — on Gemini `text` event, send `model_text` to browser
  - Requirement: 9.5

## Task 15: Verification

- [ ] 15.1 Run `npm install` in `sim-coach/` and verify all dependencies install without errors
- [ ] 15.2 Run `npm run build` in `sim-coach/` and verify Next.js builds without errors
- [ ] 15.3 Verify all 6 pages render without runtime errors by checking for missing imports or undefined references
- [ ] 15.4 Verify `server.js` starts without errors when `NODE_ENV=development node server.js` is run (with a valid `.env` file)
- [ ] 15.5 Verify the WebSocket handler correctly parses `?agent=` and `?voice=` params and looks up the agent config
- [ ] 15.6 Verify `sanitizeState()` handles null, undefined, and partial state objects without throwing
- [ ] 15.7 Verify `normalizeEvaluationResult()` clamps scores to [0, 100] for any numeric input
- [ ] 15.8 Verify `deriveResourceBriefs()` returns 0–2 items for any evaluation shape including empty/null inputs
