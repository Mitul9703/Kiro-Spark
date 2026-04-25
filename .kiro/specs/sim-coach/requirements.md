# Requirements: PitchMirror — Live AI Rehearsal Platform

## Requirement 1: Project Structure and Server

### Description

The application must be a Next.js 15 project with a custom Express + HTTP server (`server.js`) that serves the Next.js frontend and handles all API routes and WebSocket connections. The project is placed in a `sim-coach/` folder at the workspace root.

### Acceptance Criteria

- 1.1 Given the project is started with `node server.js`, when the server starts, then it serves the Next.js app and all `/api/*` routes on the configured port (default 3000).
- 1.2 Given a request to `GET /api/health`, when the server receives it, then it returns `{ status: "ok" }` with HTTP 200.
- 1.3 Given environment variables are missing for a required API key, when a route that needs that key is called, then the server returns HTTP 500 with a descriptive error message.
- 1.4 Given `NEXT_PUBLIC_BACKEND_HTTP_URL` and `NEXT_PUBLIC_BACKEND_WS_URL` are not set, when the frontend makes API calls, then it uses relative URLs (same origin).
- 1.5 Given `NEXT_PUBLIC_BACKEND_HTTP_URL` is set, when the frontend makes API calls, then it prefixes all API paths with that URL.

## Requirement 2: Client-Side State Management

### Description

All application state must be managed client-side using React Context backed by `localStorage`. There is no database, no authentication, and no server-side session storage.

### Acceptance Criteria

- 2.1 Given the app loads for the first time, when `AppProvider` initializes, then it creates default state for all 5 agents with empty threads and sessions.
- 2.2 Given state changes (theme, agents, threads, sessions), when the effect runs, then the state is serialized and saved to `localStorage` under key `pitchmirror-state-v1`.
- 2.3 Given the app reloads, when `AppProvider` mounts, then it reads from `localStorage` and restores the previous state via `sanitizeState()`.
- 2.4 Given corrupted or missing `localStorage` data, when `sanitizeState()` runs, then it returns valid default state without throwing.
- 2.5 Given a session is deleted, when `deleteSession()` is called, then the session is removed from state, its thread's `sessionIds` is updated, and any in-flight evaluation/resource/comparison jobs for that session are aborted.
- 2.6 Given a thread is deleted, when `deleteThread()` is called, then the thread and all its sessions are removed from state, and all in-flight jobs for those sessions and the thread are aborted.

## Requirement 3: Agent Configuration

### Description

The app must define 5 agents in `data/agents.js` with complete configuration including system prompts, evaluation criteria, and agent-specific settings.

### Acceptance Criteria

- 3.1 Given the agents data file, when it is imported, then it exports an array of exactly 5 agents with slugs: `professor`, `recruiter`, `investor`, `coding`, `custom`.
- 3.2 Given any agent config, when it is accessed, then it has: `slug`, `name`, `role`, `duration`, `description`, `longDescription`, `scenario`, `focus`, `flow`, `previewMetrics`, `contextFieldLabel`, `contextFieldDescription`, `evaluationCriteria`, `systemPrompt`, `evaluationPrompt`, `mockEvaluation`.
- 3.3 Given the `coding` agent config, when it is accessed, then it additionally has `codingLanguages`, `codingQuestionBank`, and `sessionKickoff`.
- 3.4 Given any agent's `evaluationCriteria`, when it is accessed, then each criterion has a `label` and `description`.

## Requirement 4: Thread Management

### Description

Users must be able to create named threads per agent to organize practice sessions into tracks.

### Acceptance Criteria

- 4.1 Given a user enters a thread name and clicks "New thread", when `createThread()` is called, then a new thread is created with a unique ID, the given title, empty `sessionIds`, and default evaluation/memory state.
- 4.2 Given a thread name is empty, when the user tries to create a thread, then an error message is shown and no thread is created.
- 4.3 Given threads exist for an agent, when the AgentDetailPage renders, then all threads are listed with their session count, last updated time, and evaluation summary if available.
- 4.4 Given a thread is deleted, when the user confirms deletion, then the thread and all its sessions are removed and the user is navigated back to the agent detail page.

## Requirement 5: Session Creation

### Description

Users must be able to configure and start a new session from within a thread, with optional PDF upload, custom context, and company URL.

### Acceptance Criteria

- 5.1 Given a user is on the ThreadDetailPage, when they enter a session name and click "Start Session", then the app navigates to `/session/[slug]`.
- 5.2 Given a session name is empty, when the user tries to start a session, then an error message is shown and navigation does not occur.
- 5.3 Given a user uploads a PDF, when the upload succeeds, then the extracted `contextText` is stored in `agentState.upload.contextText` and a preview URL is available.
- 5.4 Given a PDF upload fails, when the error is returned, then the upload status is set to `"error"` with the error message displayed.
- 5.5 Given the agent is `coding`, `investor`, or `custom` and a company URL is provided, when the user clicks "Start Session", then `POST /api/agent-external-context` is called before navigation and the result is stored in `agentState.researchPrep`.
- 5.6 Given the external research call is in progress, when the session start button is shown, then it displays "Fetching company context…" and is disabled.

## Requirement 6: PDF Upload Processing

### Description

The server must accept PDF uploads, extract text, and return cleaned context for use in sessions.

### Acceptance Criteria

- 6.1 Given a `POST /api/upload-deck` request with a PDF file, when the server processes it, then it parses the PDF with `pdf-parse`, sends the text to Gemini for cleaning, and returns `{ contextText, contextPreview, fileName }`.
- 6.2 Given the uploaded file is not a PDF or is empty, when the server processes it, then it returns HTTP 400 with an error message.
- 6.3 Given the PDF is successfully processed, when the response is returned, then `contextPreview` is a truncated version of `contextText` suitable for display.

## Requirement 7: External Research (LangChain Agent)

### Description

For coding, investor, and custom agents, the server must use a LangChain agent with Firecrawl tools to gather grounded external context.

### Acceptance Criteria

- 7.1 Given a `POST /api/agent-external-context` request with `agentSlug: "coding"` and a `companyUrl`, when the server processes it, then it runs a LangChain agent that searches and scrapes for a grounded coding interview question and returns `{ research: { markdown, title, companyName, sourceUrl } }`.
- 7.2 Given a `POST /api/agent-external-context` request with `agentSlug: "investor"` and a `companyUrl`, when the server processes it, then it returns a markdown investor diligence brief covering company snapshot, product signals, recent news, competitive context, and pressure points.
- 7.3 Given a `POST /api/agent-external-context` request with `agentSlug: "custom"` and a `companyUrl`, when the server processes it, then it returns a general web context brief.
- 7.4 Given no `companyUrl` is provided, when the route is called, then it returns HTTP 400 with an error message.
- 7.5 Given `FIRECRAWL_API_KEY` is not set, when the route is called, then it returns HTTP 500 with a descriptive error.

## Requirement 8: Anam Session Token

### Description

The server must create Anam avatar session tokens with randomly selected avatar profiles and matching voices.

### Acceptance Criteria

- 8.1 Given a `POST /api/anam-session-token` request, when the server processes it, then it calls the Anam API, picks a random avatar profile from the 8 available profiles, picks a matching voice from `GEMINI_VOICE_BY_GENDER`, and returns `{ sessionToken, avatarId, voiceName, avatarName }`.
- 8.2 Given the Anam API call fails, when the error is caught, then the server returns HTTP 500 with the error message.
- 8.3 Given a Male avatar is selected, when the voice is picked, then it is chosen from `["Charon"]`. Given a Female avatar is selected, when the voice is picked, then it is chosen from `["Aoede", "Autonoe", "Despina", "Sulafat"]`.

## Requirement 9: Live Session WebSocket

### Description

The server must handle WebSocket connections at `/api/live`, bridging browser audio/video to Gemini Live and relaying AssemblyAI transcription back to the browser.

### Acceptance Criteria

- 9.1 Given a WebSocket connection to `/api/live?agent=slug&voice=voiceName`, when the connection is established, then the server creates a Gemini Live session with the agent's system prompt and the specified voice, and creates an AssemblyAI RealtimeTranscriber.
- 9.2 Given the WebSocket receives `{ type: "session_context", ... }`, when processed, then the server builds a full system prompt incorporating custom context, thread memory (hiddenGuidance), upload context, and external research, and sends it to Gemini.
- 9.3 Given the WebSocket receives `{ type: "user_audio", data: base64PCM }`, when processed, then the server forwards the PCM audio to Gemini Live via `sendRealtimeInput`.
- 9.4 Given Gemini Live emits audio output, when received, then the server relays it to the browser as `{ type: "audio_chunk", data: base64PCM }`.
- 9.5 Given Gemini Live emits text output, when received, then the server relays it to the browser as `{ type: "model_text", text }`.
- 9.6 Given AssemblyAI produces a transcription, when received, then the server relays it to the browser as `{ type: "user_transcription", text, finished: bool }`.
- 9.7 Given the WebSocket receives `{ type: "screen_frame", data: base64JPEG }`, when processed, then the server forwards the image to Gemini Live via `sendRealtimeInput`.
- 9.8 Given the WebSocket receives `{ type: "code_snapshot", language, snapshot }`, when processed, then the server sends the code as text context to Gemini Live.
- 9.9 Given the WebSocket receives `{ type: "end_session" }`, when processed, then the server closes the Gemini Live session and AssemblyAI connection, and sends `{ type: "live_closed" }` to the browser.
- 9.10 Given the WebSocket connection closes unexpectedly, when detected, then the server cleans up the Gemini Live session and AssemblyAI connection.

## Requirement 10: Live Session Frontend

### Description

The SessionPage must handle the complete live session experience including mic capture, avatar display, transcript, and session controls.

### Acceptance Criteria

- 10.1 Given the SessionPage loads, when it mounts, then it requests microphone access via `getUserMedia({ audio: true })`.
- 10.2 Given microphone access is denied, when the error is caught, then the page shows a "blocked" state with a message explaining mic access is required.
- 10.3 Given microphone access is granted, when the session starts, then the page opens a WebSocket to `/api/live?agent=slug&voice=voiceName` and initializes the Anam avatar.
- 10.4 Given the session is live, when the user speaks, then mic audio is captured via `AudioContext + ScriptProcessor`, downsampled to 16kHz PCM, and sent as base64 via WebSocket.
- 10.5 Given `audio_chunk` messages arrive, when processed, then the PCM audio is downsampled from 24kHz to 16kHz and fed to the Anam avatar audio stream.
- 10.6 Given `model_text` messages arrive, when processed, then the text is accumulated in the live model buffer and displayed in the transcript panel.
- 10.7 Given `user_transcription` messages arrive with `finished: true`, when processed, then the user buffer is flushed to the transcript as a finalized entry.
- 10.8 Given the user clicks "End Session", when the handler runs, then it sends `{ type: "end_session" }` via WebSocket, calls `createSessionRecord()` in AppProvider, and navigates to `/agents/[slug]?ended=1`.
- 10.9 Given a session name is not set when the SessionPage loads, when the guard check runs, then the page redirects to `/agents/[slug]`.
- 10.10 Given a thread is not selected when the SessionPage loads, when the guard check runs, then the page redirects to `/agents/[slug]`.

## Requirement 11: Code Editor (Coding Agent)

### Description

The coding agent session must include a CodeMirror editor with language support and debounced code snapshot syncing to the server.

### Acceptance Criteria

- 11.1 Given the coding agent session is live, when the SessionPage renders, then a CodeMirror editor is shown with a language selector defaulting to the first language in `agent.codingLanguages`.
- 11.2 Given the user selects a language, when the selector changes, then the CodeMirror extensions update to match the selected language (JavaScript, Python, Java, C++, SQL, or plain for Pseudocode).
- 11.3 Given the user types in the editor, when 3 seconds have elapsed since the last keystroke, then a `code_snapshot` message is sent via WebSocket with the current code and language.
- 11.4 Given the code has not changed since the last send, when the debounce timer fires, then no message is sent.
- 11.5 Given the session ends, when `createSessionRecord()` is called, then the final code and selected language are saved in `session.coding.finalCode` and `session.coding.language`.

## Requirement 12: Screen Sharing

### Description

Non-coding agents must support screen sharing with frame capture sent to the server for Gemini visual context.

### Acceptance Criteria

- 12.1 Given the agent is not `coding`, when the SessionPage renders, then a screen share panel is shown with a "Start sharing" button.
- 12.2 Given the user clicks "Start sharing", when `getDisplayMedia` succeeds, then the screen stream is captured, a preview video is shown, and `screen_share_state` is sent to the server.
- 12.3 Given screen sharing is active, when the capture interval fires (every 1200ms), then a JPEG frame is captured from the preview video via canvas, encoded as base64, and sent as `screen_frame` via WebSocket.
- 12.4 Given the user stops sharing or the track ends, when cleanup runs, then the stream is stopped, the preview is cleared, and `screen_share_state { active: false }` is sent to the server.
- 12.5 Given screen sharing is active and the session is live, when `documentPictureInPicture` is available, then a PiP window is opened with the avatar video and session controls (mute, stop sharing, end call).

## Requirement 13: Session Evaluation

### Description

After a session ends, the app must automatically trigger evaluation via the server and store the result in the session record.

### Acceptance Criteria

- 13.1 Given a session record is created in AppProvider, when `runEvaluationJob()` is triggered, then it calls `POST /api/evaluate-session` with the transcript, upload context, coding data, and custom context.
- 13.2 Given the evaluation API returns successfully, when the result is stored, then `session.evaluation.status` is set to `"completed"` and `session.evaluation.result` contains the normalized evaluation.
- 13.3 Given the evaluation API fails, when the error is caught, then `session.evaluation.status` is set to `"failed"` with the error message.
- 13.4 Given `POST /api/evaluate-session` is called, when the server processes it, then it builds an evaluation prompt from the transcript and agent-specific rubric, calls Gemini with a structured JSON schema, normalizes the result against `agent.evaluationCriteria`, and returns `{ evaluation }`.
- 13.5 Given the evaluation result contains `resourceBriefs`, when `deriveResourceBriefs()` runs, then it returns up to 2 briefs for use in resource fetching.

## Requirement 14: Thread Evaluation

### Description

After sessions complete in a thread, the app must trigger a longitudinal thread evaluation that produces trajectory analysis and hidden guidance for the next session.

### Acceptance Criteria

- 14.1 Given a thread has at least one completed session, when `runThreadEvaluationJob()` is triggered, then it calls `POST /api/evaluate-thread` with the thread metadata and all completed session evaluations.
- 14.2 Given the thread evaluation API returns successfully, when the result is stored, then `thread.evaluation.status` is `"completed"` and `thread.memory.hiddenGuidance` contains the hidden guidance string.
- 14.3 Given `POST /api/evaluate-thread` is called, when the server processes it, then it returns `{ threadEvaluation: { summary, trajectory, comments, strengths, focusAreas, nextSessionFocus, metricTrends, hiddenGuidance } }`.
- 14.4 Given `thread.memory.hiddenGuidance` is set, when the next session starts, then the `session_context` WebSocket message includes `threadContext: thread.memory.hiddenGuidance`.

## Requirement 15: Session Comparison

### Description

Users must be able to compare any two completed sessions within the same agent to see metric deltas.

### Acceptance Criteria

- 15.1 Given a session has a completed evaluation and at least one other completed session exists for the same agent, when the SessionDetailPage renders, then a comparison selector is shown.
- 15.2 Given the user selects a baseline session and clicks "Compare", when `requestSessionComparison()` is called, then it calls `POST /api/compare-sessions` with both sessions' evaluation results.
- 15.3 Given the comparison API returns successfully, when the result is stored, then `session.comparison.status` is `"completed"` and the result shows `trend`, `summary`, and per-metric `delta` values.
- 15.4 Given `POST /api/compare-sessions` is called, when the server processes it, then it calls Gemini to compare the two evaluations and returns `{ comparison: { trend, summary, metrics[] } }` with delta values computed from actual metric scores.

## Requirement 16: Improvement Resources

### Description

After evaluation, users must be able to fetch targeted improvement resources via Firecrawl search and Gemini curation.

### Acceptance Criteria

- 16.1 Given a session has a completed evaluation with `resourceBriefs`, when the user clicks "Fetch resources", then `requestResourceFetch()` is called and `POST /api/session-resources` is triggered.
- 16.2 Given `POST /api/session-resources` is called, when the server processes it, then for each brief it runs two Firecrawl searches (video + article), deduplicates results, optionally scrapes top candidates, and curates with Gemini.
- 16.3 Given the resource fetch succeeds, when the result is stored, then `session.resources.status` is `"completed"` and `session.resources.topics` contains grouped resource items.
- 16.4 Given the resource fetch fails, when the error is caught, then `session.resources.status` is `"failed"` with a retry button shown.
- 16.5 Given no `resourceBriefs` exist for a session, when the resources panel renders, then it shows "Complete the evaluation first to unlock resources."

## Requirement 17: Frontend Pages and Navigation

### Description

The app must implement all required pages using Next.js App Router with correct routing and navigation.

### Acceptance Criteria

- 17.1 Given the app is running, when the user visits `/`, then the LandingPage renders with a hero section and "View Agents" CTA.
- 17.2 Given the user visits `/agents`, when the page renders, then all 5 agent cards are shown in a grid with name, role, duration, description, and focus chips.
- 17.3 Given the user visits `/agents/[slug]`, when the page renders, then the AgentDetailPage shows agent info, evaluation criteria, and thread management UI.
- 17.4 Given the user visits `/agents/[slug]/threads/[threadId]`, when the page renders, then the ThreadDetailPage shows thread overview, session creation form, thread evaluation, and past sessions list.
- 17.5 Given the user visits `/agents/[slug]/sessions/[sessionId]`, when the page renders, then the SessionDetailPage shows session info, evaluation, resources, comparison, and transcript.
- 17.6 Given the user visits `/session/[slug]`, when the page renders, then the SessionPage shows the live session room.
- 17.7 Given an invalid agent slug is used, when the page renders, then an "Agent not found" empty state is shown with a back link.

## Requirement 18: Dark/Light Theme

### Description

The app must support dark and light themes toggled by the user, persisted across sessions.

### Acceptance Criteria

- 18.1 Given the app loads, when the theme is applied, then `document.documentElement.dataset.theme` is set to `"dark"` or `"light"`.
- 18.2 Given the user clicks the theme toggle button, when `setTheme()` is called, then the theme switches and the change is persisted to `localStorage`.
- 18.3 Given the theme is `"dark"`, when CSS variables are applied, then the dark color palette is used. Given the theme is `"light"`, when CSS variables are applied, then the light color palette is used.

## Requirement 19: Shell and Layout

### Description

All pages must use the `AppShell` component which provides the top navigation bar with brand name and theme toggle.

### Acceptance Criteria

- 19.1 Given any page renders, when `AppShell` is used, then the topbar shows "PitchMirror" brand name and a theme toggle button.
- 19.2 Given toasts are queued, when `AppShell` renders, then toast notifications are shown in the bottom-right corner and auto-dismiss after 4 seconds.
- 19.3 Given the user clicks a toast, when the click handler runs, then the toast is immediately dismissed.
