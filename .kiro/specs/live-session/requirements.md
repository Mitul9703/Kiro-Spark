# Requirements — Live Session

Binding EARS-style user stories for the live rehearsal experience. The feature lives at `/session/[slug]` and orchestrates mic permission, prep research, avatar rendering, realtime voice, transcript capture, screen share, and coding, ending with a finalized session record handed to the evaluation pipeline.

---

## R1 — Mic permission gate (preflight)

**User story:** As a user entering a rehearsal, I want the app to request microphone permission before anything else, so the session cannot start without audio.

- **WHEN** the user navigates to `/session/[slug]` **THE SYSTEM SHALL** enter `preflight` phase and render a full-screen "Allow microphone" overlay.
- **WHEN** `navigator.mediaDevices.getUserMedia({ audio: true })` resolves **THE SYSTEM SHALL** retain the `MediaStream` for transcription and transition to `prep`.
- **IF** permission is denied or the promise rejects **THEN THE SYSTEM SHALL** transition to `error` with message `"Microphone access is required. Please grant permission and refresh."` and a `Retry` button that calls `getUserMedia` again.

## R2 — Prep phase runs external research (non-professor)

**User story:** As a user, I want the app to prepare company/role/question context before the call so the agent sounds informed.

- **WHEN** the session enters `prep` **AND** `agent.slug !== 'professor'` **THE SYSTEM SHALL** POST `/api/agent-external-context` with `{ agentSlug, thread, customContext, companyUrl, upload }` and show a loading overlay with rotating status text.
- **WHEN** the research response resolves **THE SYSTEM SHALL** store the result under `state.agents[slug].researchPrep.result` and transition to `live`.
- **WHEN** `agent.slug === 'professor'` **THE SYSTEM SHALL** skip the research fetch and transition directly from `prep` to `live`.
- **IF** the research fetch fails **THEN THE SYSTEM SHALL** still transition to `live` with `researchPrep.result = null` and surface a non-blocking toast `"Could not fetch external context — continuing without it."`.

## R3 — Avatar token issuance and rendering

**User story:** As a user, I want to see a realistic avatar that speaks with the AI voice.

- **WHEN** entering `live` **THE SYSTEM SHALL** POST `/api/anam-session-token` with `{ agentSlug }`.
- **WHEN** the endpoint returns `{ sessionToken, avatarProfile }` **THE SYSTEM SHALL** instantiate the Anam client (`@anam-ai/js-sdk`) with the token and attach its video/audio track to the main avatar `<video>` element.
- **WHILE** no avatar frame has rendered **THE SYSTEM SHALL** display a "Connecting…" shimmer over the video panel.
- **IF** `ANAM_API_KEY` is missing or the Anam call fails **THEN THE SYSTEM SHALL** transition to `error` with `"Avatar service unavailable"`.

## R4 — Live WebSocket bridge

**User story:** As a user, I want a low-latency voice loop with the avatar.

- **WHEN** entering `live` **THE SYSTEM SHALL** open a WebSocket to `{WS_BASE}/api/live?sessionId={id}&agentSlug={slug}`.
- **WHEN** the socket opens **THE SYSTEM SHALL** send exactly one `{type:"start_session", grounded}` frame containing `upload`, `externalResearch`, `customContext`, `hiddenGuidance`, and `coding` sub-objects.
- **IF** the socket closes before `ended` is requested **THEN THE SYSTEM SHALL** transition to `error` with `"Connection lost"` and offer a manual retry that navigates back to the thread page.

## R5 — User mic transcription via AssemblyAI

**User story:** As a user, I want my spoken words transcribed and sent to the agent.

- **WHEN** the WS is open **AND** mic is unmuted **THE SYSTEM SHALL** open an AssemblyAI realtime transcriber against the retained mic stream.
- **WHEN** the transcriber emits a finalized turn **THE SYSTEM SHALL** send `{type:"user_transcript", role:"User", text}` over the WS and append `{role:"User", text}` to the local transcript log via `appendTranscript()`.
- **WHEN** mute is toggled on **THE SYSTEM SHALL** stop forwarding user input and emit `{type:"mute", muted:true}`; toggling off reverses both.

## R6 — Avatar transcript stream

**User story:** As a user, I want to read what the agent says while hearing it.

- **WHEN** the server emits `{type:"transcript", role:"Agent", text}` **THE SYSTEM SHALL** append the entry to the transcript log and auto-scroll the panel to the latest line unless the user has manually scrolled up.
- **WHERE** the user has manually scrolled up **THE SYSTEM SHALL** show a "Jump to latest" pill that resumes auto-scroll on click.

## R7 — Mute toggle

**User story:** As a user, I want to mute myself mid-session without ending it.

- **WHEN** the user clicks the mute button **THE SYSTEM SHALL** flip `state.agents[slug].session.muted`, send `{type:"mute", muted}` over the WS, and stop feeding mic frames to AssemblyAI while muted.
- **WHEN** unmuted **THE SYSTEM SHALL** resume the AssemblyAI transcriber without reopening the WS.

## R8 — End session

**User story:** As a user, I want to end the session cleanly and land on the report.

- **WHEN** the user clicks "End Session" **THE SYSTEM SHALL** close the WS, stop AssemblyAI, detach the Anam client, release the mic stream, release any screen-share tracks, and transition to `ended`.
- **WHEN** entering `ended` **THE SYSTEM SHALL** write `endedAt`, `durationLabel`, `transcript`, and (for coding) `coding` to the session record via the AppProvider.
- **WHEN** the session record is written **THE SYSTEM SHALL** navigate to `/agents/[slug]/sessions/[sessionId]`.

## R9 — Elapsed timer

**User story:** As a user, I want to see how long I have been rehearsing.

- **WHEN** the phase becomes `live` **THE SYSTEM SHALL** start a timer updating every second and render `MM:SS` in the controls bar.
- **WHEN** the phase becomes `ended` or `error` **THE SYSTEM SHALL** freeze the timer and store its final string as `state.agents[slug].session.lastDurationLabel`.

## R10 — Screen share (non-coding agents)

**User story:** As a user, I want the agent to see what is on my screen during a walkthrough.

- **WHERE** `agent.slug !== 'coding'` **THE SYSTEM SHALL** render a "Share Screen" toggle button.
- **WHEN** the user clicks it **THE SYSTEM SHALL** call `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })`, sample a JPEG at 500ms cadence to an offscreen canvas, and send `{type:"screen_frame", data, mimeType:"image/jpeg"}` per sample.
- **WHEN** sharing starts or stops **THE SYSTEM SHALL** send `{type:"screen_share_state", active, surface}`.
- **WHEN** sharing is active **THE SYSTEM SHALL** request Picture-in-Picture via `requestPictureInPicture()` on a small control `<video>` element so mute/end remain reachable while the user is in the shared tab.
- **WHEN** sharing is active **THE SYSTEM SHALL** render a thumbnail preview of the captured surface in a dedicated side panel.
- **IF** the user ends the share from the browser's native stop bar **THEN THE SYSTEM SHALL** detect `track.onended`, flip state, and send `{type:"screen_share_state", active:false}`.

## R11 — Code editor (coding agent only)

**User story:** As a coding-round user, I want an editor with a real question and syntax highlighting.

- **WHERE** `agent.slug === 'coding'` **THE SYSTEM SHALL** replace the screen-share surface with a `@uiw/react-codemirror` editor.
- **WHEN** entering `live` **THE SYSTEM SHALL** resolve the interview question from `researchPrep.result.codingQuestion` or, if absent, `agent.codingQuestionBank[0]`, and render it in a markdown panel beside the editor.
- **WHEN** the user changes the editor content **THE SYSTEM SHALL** debounce 600ms and then send `{type:"code_snapshot", snapshot, language}`.
- **WHEN** the user changes the language picker **THE SYSTEM SHALL** swap the CodeMirror language extension and send an immediate `{type:"code_snapshot"}` with the new language.
- **WHEN** the session ends **THE SYSTEM SHALL** write `session.coding = { language, finalCode, interviewQuestion }`.

## R12 — Anam token endpoint

**User story:** As a developer, I need a backend that brokers Anam credentials so the API key never reaches the browser.

- **WHEN** the frontend POSTs `/api/anam-session-token` with `{ agentSlug }` **THE SYSTEM SHALL** pick an avatar profile deterministically from a fixed pool of 8 by hashing `agentSlug`, POST `https://api.anam.ai/v1/auth/session-token` with the persona config, and return `{ sessionToken, avatarProfile: { name, avatarId, gender, voiceName } }`.
- **IF** `ANAM_API_KEY` is absent **THEN THE SYSTEM SHALL** reply `500 { error: "ANAM_API_KEY is not configured" }`.
- **IF** Anam returns non-2xx **THEN THE SYSTEM SHALL** reply `502 { error: "Failed to issue Anam session token", details }`.

## R13 — Live WS bridge to Gemini Live

**User story:** As a developer, I need a server that bridges the client to Gemini Live with the right voice and persona.

- **WHEN** a client connects to `/api/live` **THE SYSTEM SHALL** parse `sessionId` and `agentSlug` from the query string, create a Gemini Live session via `@google/genai` against `gemini-2.5-flash-native-audio-preview-12-2025`, set the voice to the avatar profile's `voiceName`, and build a system instruction from `agent.systemPrompt` plus grounded context plus `memory.hiddenGuidance`.
- **WHEN** the client sends `user_transcript` **THE SYSTEM SHALL** forward it as user content to Gemini.
- **WHEN** the client sends `screen_frame` **THE SYSTEM SHALL** forward the inline base64 image to Gemini.
- **WHEN** the client sends `code_snapshot` **THE SYSTEM SHALL** inject a system-note turn `"User's current code (do not echo verbatim): <lang>\n<snippet>"`.
- **WHEN** Gemini yields a text chunk **THE SYSTEM SHALL** emit `{type:"transcript", role:"Agent", text}` to the client.
- **WHEN** the client sends `get_history` **THE SYSTEM SHALL** reply with `{type:"history", history}`.
- **WHEN** the socket closes **THE SYSTEM SHALL** stop the Gemini session and release per-connection resources; no reconnection is attempted.

## R14 — HTTP + WS server integration

**User story:** As an operator, I need one process to serve both Next.js and the WS bridge so Render can host it as a single web service.

- **WHEN** the server boots **THE SYSTEM SHALL** create one HTTP server, mount Express for `/api/*`, mount the Next.js handler as fallback for everything else, and attach a `ws` server with `{ noServer: true }` that handles `upgrade` events only when `url.pathname === '/api/live'`.

## R15 — Client config resolution

**User story:** As a developer, I need HTTP and WS URLs to resolve correctly in dev, prod, and cross-origin setups.

- **WHEN** a browser module imports `lib/client-config.js` **THE SYSTEM SHALL** expose `getHttpBase()` returning `process.env.NEXT_PUBLIC_BACKEND_HTTP_URL || ''` and `getWsBase()` returning `process.env.NEXT_PUBLIC_BACKEND_WS_URL` or, if absent, `(location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host`.

## R16 — Error overlay and recovery

**User story:** As a user, when something breaks I want a clear message, not a frozen page.

- **WHEN** the phase is `error` **THE SYSTEM SHALL** render a modal with the error text, a `Retry` button that restarts the lifecycle from `preflight`, and an `Exit` button that navigates back to the thread page.
- **WHILE** the phase is `error` **THE SYSTEM SHALL** have released the mic stream, screen-share tracks, WS, and Anam client so no background resources leak.
