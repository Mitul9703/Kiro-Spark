# Tasks — Live Session

Sequenced implementation plan. Each task lists the requirement IDs it satisfies and a concrete verification step. Tasks are ordered so each builds on verified work before it.

---

## T1 — Add `lib/client-config.js` (Requirements: R15)

- Create `lib/client-config.js` exporting `getHttpBase()` and `getWsBase()` per R15.
- Add both `NEXT_PUBLIC_BACKEND_HTTP_URL` and `NEXT_PUBLIC_BACKEND_WS_URL` to `.env.example`.
- **Verify:** in a Next dev server, `console.log(getWsBase())` in a client component resolves to `ws://localhost:3000` with the vars unset.

## T2 — HTTP + WS server bootstrap (Requirements: R14)

- Implement `server.js` per design §4.1: Express + Next handler + `ws` attached with `noServer:true` and routed via the HTTP server's `upgrade` event only for `/api/live`.
- Add `npm run dev` and `npm run start` scripts that boot `server.js` (no plain `next dev`).
- **Verify:** Hit `http://localhost:3000/` → Next landing renders. Hit `ws://localhost:3000/api/live` with `wscat` → connection accepted; any other path → socket destroyed.

## T3 — Anam token endpoint (Requirements: R3, R12)

- Create `server/anam.js` exporting `anamSessionTokenHandler(req,res)` and `pickAvatarProfile(slug)` per design §6.
- Define `AVATAR_POOL` (8 entries), deterministic hash, voice mapping, POST to `https://api.anam.ai/v1/auth/session-token`.
- Mount in `server.js` as `POST /api/anam-session-token`.
- Write `scripts/smoke-anam-token.mjs`.
- **Verify:** Smoke script exits 0 against a dev server with `ANAM_API_KEY` set.

## T4 — AssemblyAI token endpoint (Requirements: R5)

- Create `server/assembly-token.js` exporting a handler that returns a short-lived AssemblyAI temporary token (`POST https://api.assemblyai.com/v2/realtime/token` with `expires_in:3600`) using `ASSEMBLYAI_API_KEY`.
- Mount as `GET /api/assembly-token`.
- Write `scripts/smoke-assembly-token.mjs`.
- **Verify:** Smoke script returns a non-empty token string.

## T5 — WS bridge skeleton (Requirements: R4, R13)

- Create `server/live-bridge.js` exporting `attachLiveBridge(wss)` per design §4.2.
- Implement query parsing, per-connection state, message routing switch, `close` cleanup.
- Leave the Gemini session stubbed: when `start_session` arrives, emit a canned `{type:"transcript", role:"Agent", text:"[stub] hello"}` after 500ms so the loop can be tested end-to-end before LLM integration.
- **Verify:** `wscat` sends `start_session`, receives the stub transcript, disconnect is clean.

## T6 — Wire Gemini Live into the bridge (Requirements: R13)

- Implement `openGemini({ agent, profile, grounded })` per design §4.3 using `@google/genai` against `gemini-2.5-flash-native-audio-preview-12-2025`, setting `voiceName` from profile and composing `systemInstruction`.
- Implement `sendUserText`, `sendSystemNote`, `sendInlineImage`, `sendKickoff`, and a text-chunk listener that emits `transcript` + `transcript_ack`.
- Write `scripts/smoke-live-ws.mjs` (see design §12.2).
- **Verify:** Smoke script receives ≥1 real agent `transcript` message within 15s.

## T7 — `SessionPage` scaffold + phase machine (Requirements: R1, R8, R16)

- Create `app/session/[slug]/page.js` (thin wrapper) and `components/session-page.js` with the phase reducer and overlays.
- Implement `<PreflightOverlay>`, `<PrepOverlay>`, `<ErrorOverlay>` with Retry/Exit wiring.
- Implement mic acquisition hook with `getUserMedia`; on grant, transition `prep`; on deny, `error`.
- **Verify:** Navigate to `/session/recruiter`. Deny mic → error overlay. Refresh, grant → transitions to `prep`.

## T8 — Prep phase fetch (Requirements: R2)

- In `prep`, call `/api/agent-external-context` (consumed but not implemented here) and rotate status text.
- Skip the fetch for `professor`.
- Store result under `state.agents[slug].researchPrep.result` via AppProvider action (contract from agents-and-threads extended here if missing).
- On success → `live`; on failure → `live` with a toast.
- **Verify:** Stub the endpoint to delay 3s, confirm overlay shows. Stub a 500, confirm toast appears and phase still advances.

## T9 — Anam avatar wiring (Requirements: R3)

- Implement `useAnamClient(token, profile, videoRef)` against `@anam-ai/js-sdk`.
- On entering `live`, POST `/api/anam-session-token`, then stream video into `<AvatarPanel>`.
- Show "Connecting…" shimmer until first frame (`videoRef.current.readyState >= 2`).
- **Verify:** With valid `ANAM_API_KEY`, avatar renders in the main panel within 3s. Unset key → error overlay.

## T10 — Live WS client + contract writes (Requirements: R4, R6, Contract changes)

- Implement `useLiveSocket` per design §3.4.
- On open: send `start_session` with `grounded` built from AppProvider state.
- On `{type:"transcript"}`: call `appendTranscript(slug, sessionId, { role:"Agent", text, ts:Date.now() })`.
- Render `<TranscriptPanel>` with auto-scroll + "Jump to latest" pill.
- Extend AppProvider with `state.agents[slug].session` fields and `appendTranscript` / `finalizeSession` actions per design §10.
- **Verify:** End-to-end with the stub from T5 (or real Gemini from T6): agent text appears in the panel; scrolling up shows the pill; new message does not yank scroll.

## T11 — AssemblyAI realtime transcription (Requirements: R5, R7)

- Implement `useAssemblyAiTranscriber` per design §7 (token from T4).
- On finalized transcript: `appendTranscript({ role:"User", ... })` and send `{type:"user_transcript"}` over the WS.
- Honor the `muted` flag: tear down transcriber on mute, rebuild on unmute.
- **Verify:** Speak into the mic with the dev server running → user lines appear and agent replies reference them.

## T12 — Mute + End controls + elapsed timer (Requirements: R7, R8, R9)

- Implement `<ControlsBar>` with mute toggle, end button, and `MM:SS` timer via `useElapsedTimer`.
- Mute flips `state.agents[slug].session.muted`, sends `{type:"mute"}`, pauses AssemblyAI.
- End triggers full teardown sequence: stop AssemblyAI → close WS → stop Anam → stop mic → stop screen share → `finalizeSession(...)` → navigate to `/agents/[slug]/sessions/[sessionId]`.
- **Verify:** Clicking End leaves no open handles (DevTools → Application → Media shows no active streams) and the session detail page loads.

## T13 — Screen share + frame sampler (Requirements: R10)

- For non-coding agents, render "Share Screen" in `<ControlsBar>`.
- Implement `getDisplayMedia`, 500ms JPEG sampler, and `{type:"screen_frame"}` send with back-pressure guard (`bufferedAmount > 2MB` → skip tick).
- Emit `{type:"screen_share_state"}` on start/stop, including native stop-bar detection via `track.onended`.
- Render `<ScreenSharePreview>` thumbnail and a hidden PiP `<video>` that calls `requestPictureInPicture()` on share start.
- **Verify:** Start share, navigate to another tab, PiP surface visible with mute/end reachable. Stop via native bar → UI flips back. Check WS frame rate ≈2/s.

## T14 — Coding workspace (Requirements: R11)

- For `agent.slug === 'coding'`, render `<CodingWorkspace>` instead of `<ScreenSharePreview>`.
- Integrate `@uiw/react-codemirror` with `LANG_MAP` per design §9; default language = `agent.codingLanguages[0]`.
- Source `interviewQuestion` from `researchPrep.result.codingQuestion` or `agent.codingQuestionBank[0]`; render via a lightweight markdown renderer.
- Debounce editor changes at 600ms and send `{type:"code_snapshot"}`; on language change, send immediately with new language.
- On `ended`, write `session.coding = { language, finalCode, interviewQuestion }` via `finalizeSession`.
- **Verify:** Start a coding session, type Python code, end → re-open session detail page → `coding.finalCode` matches editor content, `coding.language === "python"`, `coding.interviewQuestion` is populated.

## T15 — Error overlay recovery paths (Requirements: R16)

- Wire every failure in design §11 to the phase machine's `error` transition with an appropriate message.
- `Retry` resets to `preflight` (re-requesting mic, re-opening WS). `Exit` navigates to `/agents/[slug]/threads/[threadId]`.
- Ensure teardown runs before transitioning to `error` (single shared `disposeAll()` helper).
- **Verify:** Kill the server mid-session → overlay shows "Connection lost"; Retry restarts flow; Exit routes back.

## T16 — PDF / research grounding pass-through (Requirements: R4)

- When building the `start_session` `grounded` payload, include `upload` (cleaned PDF text), `externalResearch`, `customContext`, `hiddenGuidance` (from thread memory), and `coding` (if applicable).
- Keep the payload under 64KB; if over, truncate `externalResearch` and log a warning.
- **Verify:** Network tab shows the first WS frame carries all four grounded fields when present.

## T17 — End-to-end smoke per agent (Requirements: R1–R16)

- Run the manual QA matrix from design §12.1 against a dev build: recruiter, professor, investor, coding, custom.
- For each, confirm: mic gate → prep behaviour → avatar renders → 2-turn exchange → transcript writes → end → session detail page loads with full transcript.
- **Verify:** All five agents complete without unhandled errors in console.

## T18 — Smoke script CI entry (Requirements: R3, R5, R13)

- Add `npm run smoke:live` that runs `smoke-anam-token.mjs`, `smoke-assembly-token.mjs`, and `smoke-live-ws.mjs` in sequence against a running dev server.
- Document required envs (`ANAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY`) in the script headers.
- **Verify:** `npm run smoke:live` exits 0 when keys are present and the dev server is up.
