# Live Session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the realtime rehearsal experience — `/session/[slug]` page, WebSocket bridge to Gemini Live, Anam avatar, AssemblyAI mic, screen share, code editor — that runs the heart of the product.

**Architecture:** Express 5 + `ws` mounted on the same HTTP server in `server.js`. WebSocket at `/api/live` per browser session bridges Gemini Live (audio + text) to the Anam SDK on the client (lip-sync) and AssemblyAI realtime transcription (user mic → text). Coding sessions add a CodeMirror editor; non-coding agents support `getDisplayMedia` screen share with 500ms JPEG sampling.

**Tech Stack:** Express 5, ws 8, @google/genai, @anam-ai/js-sdk, assemblyai, @uiw/react-codemirror, plain JavaScript.

---

## Prerequisites

**The `agents-and-threads` plan must be complete before starting this plan.** This plan depends on:

- The **AppProvider state shape and mutators** already mounted in `components/app-provider.js`:
  - `useAppState()` / `useAppActions()` hooks.
  - `appendTranscript(slug, sessionId, entry)` — extended by this plan to accept `{ role: 'User'|'Agent', text, ts }`.
  - `patchSession(slug, sessionId, patch)` — used to finalize `endedAt`, `durationLabel`, `coding`.
  - `patchAgent(slug, patch)` — used to write the `session` lifecycle sub-object (`status`, `muted`, `lastDurationLabel`).
  - The default `state.agents[slug].session` slice (`{ status, muted, lastEndedAt, lastDurationLabel }`) and the `researchPrep` placeholder (owned by research spec but read here).
- The **agent catalog** at `data/agents.json` with the five entries (`recruiter`, `professor`, `investor`, `coding`, `custom`), each carrying `systemPrompt`, `codingLanguages` (coding only), `codingQuestionBank` (coding only), and all context-field metadata.
- **`lib/client-config.js`** for resolving `getHttpBase()` and `getWsBase()`. This plan creates that file as T1 because it is a live-session-owned helper per the spec's tasks.md — the agents-and-threads plan does not create it.
- The **stub `app/session/[slug]/page.js`** placeholder produced by agents-and-threads. This plan replaces it.
- **`Shell`** component from `components/shell.js` — the session page deliberately does NOT wrap itself in `Shell` (full-screen stage), but the error-overlay exit button routes back into `Shell`-wrapped pages.
- **`lib/agents.js`** — re-exports `data/agents.json`; used on both server and client.
- **`lib/ids.js`** — `generateId('jobKey')` used to key in-flight fetches.

Required environment variables (checked lazily): `ANAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `GEMINI_LIVE_API_KEY` (falls back to `GEMINI_API_KEY`), `NEXT_PUBLIC_BACKEND_HTTP_URL`, `NEXT_PUBLIC_BACKEND_WS_URL`.

---

## File Map

### Server bootstrap + modules

- `server.js` (modified) — replaces any prior `next dev` bootstrap. Wraps the Next.js request handler in Express, mounts `/api/*` routes, creates one `http.Server`, and attaches a `ws.WebSocketServer` with `noServer:true` for the `/api/live` upgrade path only.
- `server/anam.js` (new) — exports `anamSessionTokenHandler(req,res)` and `pickAvatarProfile(slug)`. Hashes slug into an 8-entry `AVATAR_POOL`; POSTs `https://api.anam.ai/v1/auth/session-token`.
- `server/assembly-token.js` (new) — GET handler returning a short-lived AssemblyAI token via `POST https://api.assemblyai.com/v2/realtime/token`.
- `server/live-bridge.js` (new) — exports `attachLiveBridge(wss)`. Per-connection state machine; routes `start_session`, `user_transcript`, `code_snapshot`, `screen_frame`, `screen_share_state`, `mute`, `get_history`; wraps a Gemini Live session.
- `server/gemini-live.js` (new) — `openGemini({ agent, profile, grounded })` factory. Composes system instruction, opens `@google/genai` live session, exposes `sendUserText`, `sendSystemNote`, `sendInlineImage`, `sendKickoff`, `onText`, `close`.

### Frontend page + orchestrator

- `app/session/[slug]/page.js` (replaces stub) — thin page wrapper (<30 lines). Reads `searchParams` for `threadId`/`sessionId` and forwards to `<SessionPage/>`.
- `components/session-page.js` (new) — the big orchestrator. Owns `usePhaseMachine`, `useMicStream`, and composes the sub-components below.

### Session sub-components (under `components/session/`)

- `components/session/avatar-stage.js` — main 16:9 `<video>` panel where the Anam track renders; includes the "Connecting…" shimmer.
- `components/session/transcript-log.js` — virtualized transcript list with auto-scroll plus "Jump to latest" pill.
- `components/session/controls-bar.js` — mute, end, elapsed timer (`MM:SS`), share-screen toggle.
- `components/session/screen-share-panel.js` — side-panel thumbnail + stop overlay for non-coding agents.
- `components/session/code-editor-panel.js` — two-pane CodeMirror editor + markdown question for the coding agent.
- `components/session/mic-permission-overlay.js` — preflight full-screen overlay with allow/retry.
- `components/session/prep-overlay.js` — rotating status text while `/api/agent-external-context` runs.
- `components/session/error-overlay.js` — modal with message + Retry + Exit.
- `components/session/pip-handle.js` — invisible 1×1 `<video>` target for `requestPictureInPicture`.

### Client libraries (under `lib/`)

- `lib/client-config.js` — `getHttpBase()` and `getWsBase()` resolvers.
- `lib/ws-client.js` — thin `WebSocket` wrapper. No reconnect. Exposes `send(obj)`, `on(type, handler)`, `close()`, `status`.
- `lib/anam-client.js` — wraps `@anam-ai/js-sdk` lifecycle: `createStream({ token, videoEl })`, `stop()`, event forwarders.
- `lib/assemblyai-client.js` — wraps `assemblyai` realtime transcriber. Tears down on mute, rebuilds on unmute.
- `lib/screen-share.js` — `startSampler({ stream, send, bufferedBytesFn })` — 500ms JPEG sampler with back-pressure guard.

### Smoke scripts

- `scripts/smoke-anam-token.mjs` — POSTs `/api/anam-session-token` for each agent slug; asserts `sessionToken` and `avatarProfile.voiceName`.
- `scripts/smoke-assembly-token.mjs` — GETs `/api/assembly-token`; asserts non-empty token.
- `scripts/smoke-live-handshake.mjs` — opens a WS, sends `start_session`, asserts ≥1 `transcript` event within 15s.

### Global styles

- `app/globals.css` (appended) — style blocks scoped via `.session-*` classnames for the stage, overlays, transcript, controls, and editor.

---

## Tasks

### T1 — Add `lib/client-config.js` and `.env.example` entries

Satisfies **R15**. Gives every client module a single resolver for HTTP and WS URLs.

**Files:** `lib/client-config.js`, `.env.example`.

- [ ] Create `lib/client-config.js` with the two exported resolvers.
- [ ] Add both public vars to `.env.example` with empty values.
- [ ] Verify by importing from a temporary `console.log` in any client component.

```js
// lib/client-config.js
export function getHttpBase() {
  return process.env.NEXT_PUBLIC_BACKEND_HTTP_URL || "";
}

export function getWsBase() {
  const explicit = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  if (explicit) return explicit;
  if (typeof window === "undefined") return "";
  const scheme = window.location.protocol === "https:" ? "wss://" : "ws://";
  return `${scheme}${window.location.host}`;
}
```

Append to `.env.example`:

```
NEXT_PUBLIC_BACKEND_HTTP_URL=
NEXT_PUBLIC_BACKEND_WS_URL=
```

- [ ] **Verify:** `node -e "globalThis.window={location:{protocol:'http:',host:'localhost:3000'}}; import('./lib/client-config.js').then(m => console.log(m.getWsBase()))"` prints `ws://localhost:3000`.
- [ ] **Commit:**

```
git add lib/client-config.js .env.example
git commit -m "live-session: add client-config resolver for HTTP and WS base URLs"
```

---

### T2 — `server.js` Express + Next.js + ws bootstrap, `/api/health`

Satisfies **R14**. One HTTP server hosts Next.js, Express API routes, and the `ws` upgrade path.

**Files:** `server.js`, `package.json` (scripts).

- [ ] Create `server.js` at the repo root.
- [ ] Wire Express with a single health route, the Next.js handler as fallthrough, and `ws` via `noServer:true`.
- [ ] Replace `npm run dev` and `npm run start` in `package.json` to invoke `node server.js`.
- [ ] Add `cross-env NODE_ENV=development` where needed for parity with `tech.md`.

```js
// server.js
require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const next = require("next");
const { WebSocketServer } = require("ws");

async function main() {
  const dev = process.env.NODE_ENV !== "production";
  const nextApp = next({ dev });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Other /api/* handlers are mounted here as later tasks add them.

  app.all("*", (req, res) => handle(req, res));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === "/api/live") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  // attachLiveBridge(wss) is added in T5.

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => console.log(`[spark] listening on http://${host}:${port}`));
}

main().catch((err) => {
  console.error("[spark] fatal", err);
  process.exit(1);
});
```

Update `package.json` scripts:

```json
{
  "scripts": {
    "dev": "cross-env NODE_ENV=development node server.js",
    "build": "next build",
    "start": "cross-env NODE_ENV=production node server.js"
  }
}
```

- [ ] **Verify:** run `npm run dev`, then `curl -s http://localhost:3000/api/health` returns `{"ok":true}` and the landing page at `/` renders.
- [ ] **Verify:** `npx wscat -c ws://localhost:3000/api/live?sessionId=t&agentSlug=recruiter` connects; `npx wscat -c ws://localhost:3000/api/anything-else` disconnects immediately.
- [ ] **Commit:**

```
git add server.js package.json
git commit -m "live-session: bootstrap Express + Next.js + ws on a single HTTP server"
```

---

### T3 — `server/anam.js` token endpoint + avatar pool

Satisfies **R3**, **R12**. Brokers Anam credentials so the API key never hits the browser.

**Files:** `server/anam.js`, `server.js` (mount), `scripts/smoke-anam-token.mjs`.

- [ ] Create `server/anam.js` with `AVATAR_POOL`, `pickAvatarProfile`, and `anamSessionTokenHandler`.
- [ ] Mount `POST /api/anam-session-token` in `server.js`.
- [ ] Write `scripts/smoke-anam-token.mjs`.
- [ ] Confirm voice mapping: Male → `Charon`; Females have per-entry voice names.

```js
// server/anam.js
const AVATAR_POOL = [
  {
    name: "Kevin",
    avatarId: "49a96a3e-d9f4-4ac6-8887-033f26d0ef5f",
    gender: "Male",
    voiceName: "Charon",
  },
  {
    name: "Gabriel",
    avatarId: "8d2e7b18-7a3f-4f41-9c22-9d73d2d4fefc",
    gender: "Male",
    voiceName: "Charon",
  },
  {
    name: "Leo",
    avatarId: "b64fd5e7-1d8c-4bc5-9f5d-b2d3ab5fa81c",
    gender: "Male",
    voiceName: "Charon",
  },
  {
    name: "Richard",
    avatarId: "1e3d6e07-3bde-4c1b-a9c8-0a99a0c0c0a1",
    gender: "Male",
    voiceName: "Charon",
  },
  {
    name: "Sophie",
    avatarId: "c6d4b0a8-c6c1-4e8c-9c2e-3c4c8a89a1f3",
    gender: "Female",
    voiceName: "Aoede",
  },
  {
    name: "Astrid",
    avatarId: "7c2f1e0b-6c10-4f0d-9a2f-0d4e7e3d2b1c",
    gender: "Female",
    voiceName: "Autonoe",
  },
  {
    name: "Cara",
    avatarId: "9a0c7d3e-8b4f-4e6e-9a6f-2c1b9d8e7a6b",
    gender: "Female",
    voiceName: "Despina",
  },
  {
    name: "Mia",
    avatarId: "2d5e4f6a-1c3b-4d8a-9e7f-5a6b7c8d9e0f",
    gender: "Female",
    voiceName: "Sulafat",
  },
];

function pickAvatarProfile(slug) {
  let h = 0;
  for (const c of String(slug)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_POOL[h % AVATAR_POOL.length];
}

async function anamSessionTokenHandler(req, res) {
  const { agentSlug } = req.body || {};
  if (!agentSlug) return res.status(400).json({ error: "agentSlug is required" });

  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANAM_API_KEY is not configured" });

  const profile = pickAvatarProfile(agentSlug);
  const personaConfig = {
    name: profile.name,
    avatarId: profile.avatarId,
    voiceDetail: { voiceName: profile.voiceName, gender: profile.gender },
  };

  try {
    const upstream = await fetch("https://api.anam.ai/v1/auth/session-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ personaConfig }),
    });
    if (!upstream.ok) {
      const details = await upstream.text();
      return res.status(502).json({ error: "Failed to issue Anam session token", details });
    }
    const { sessionToken } = await upstream.json();
    return res.json({ sessionToken, avatarProfile: profile });
  } catch (err) {
    return res
      .status(502)
      .json({ error: "Failed to issue Anam session token", details: String(err) });
  }
}

module.exports = { anamSessionTokenHandler, pickAvatarProfile, AVATAR_POOL };
```

Mount in `server.js` (add below `/api/health`):

```js
const { anamSessionTokenHandler } = require("./server/anam");
app.post("/api/anam-session-token", anamSessionTokenHandler);
```

```js
// scripts/smoke-anam-token.mjs
// Requires: ANAM_API_KEY set; dev server running at http://localhost:3000
const SLUGS = ["recruiter", "professor", "investor", "coding", "custom"];
let failed = 0;
for (const agentSlug of SLUGS) {
  const r = await fetch("http://localhost:3000/api/anam-session-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug }),
  });
  const body = await r.json();
  if (!r.ok || !body.sessionToken || !body.avatarProfile?.voiceName) {
    console.error(`FAIL ${agentSlug}`, r.status, body);
    failed++;
  } else {
    console.log(`OK   ${agentSlug}  ${body.avatarProfile.name}/${body.avatarProfile.voiceName}`);
  }
}
process.exit(failed ? 1 : 0);
```

- [ ] **Verify:** `ANAM_API_KEY=... npm run dev` in one shell, `node scripts/smoke-anam-token.mjs` in another — exit code 0, five OK lines.
- [ ] **Verify:** unset `ANAM_API_KEY`, call once → 500 with `"ANAM_API_KEY is not configured"`.
- [ ] **Commit:**

```
git add server/anam.js server.js scripts/smoke-anam-token.mjs
git commit -m "live-session: add Anam session-token endpoint and avatar pool"
```

---

### T4 — `server/assembly-token.js` token endpoint

Satisfies **R5**. Browser never sees `ASSEMBLYAI_API_KEY`.

**Files:** `server/assembly-token.js`, `server.js` (mount), `scripts/smoke-assembly-token.mjs`.

- [ ] Create `server/assembly-token.js` with a GET handler.
- [ ] Mount as `GET /api/assembly-token`.
- [ ] Write smoke script.

```js
// server/assembly-token.js
async function assemblyTokenHandler(_req, res) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ASSEMBLYAI_API_KEY is not configured" });
  try {
    const upstream = await fetch("https://api.assemblyai.com/v2/realtime/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ expires_in: 3600 }),
    });
    if (!upstream.ok) {
      const details = await upstream.text();
      return res.status(502).json({ error: "Failed to issue AssemblyAI token", details });
    }
    const { token } = await upstream.json();
    return res.json({ token });
  } catch (err) {
    return res
      .status(502)
      .json({ error: "Failed to issue AssemblyAI token", details: String(err) });
  }
}

module.exports = { assemblyTokenHandler };
```

Mount in `server.js`:

```js
const { assemblyTokenHandler } = require("./server/assembly-token");
app.get("/api/assembly-token", assemblyTokenHandler);
```

```js
// scripts/smoke-assembly-token.mjs
const r = await fetch("http://localhost:3000/api/assembly-token");
const body = await r.json();
if (!r.ok || typeof body.token !== "string" || body.token.length < 20) {
  console.error("FAIL", r.status, body);
  process.exit(1);
}
console.log("OK token length", body.token.length);
```

- [ ] **Verify:** `node scripts/smoke-assembly-token.mjs` exits 0 with `ASSEMBLYAI_API_KEY` set.
- [ ] **Commit:**

```
git add server/assembly-token.js server.js scripts/smoke-assembly-token.mjs
git commit -m "live-session: add AssemblyAI short-lived token endpoint"
```

---

### T5 — `server/live-bridge.js` WS handler skeleton (stubbed Gemini)

Satisfies **R4**, **R13** (skeleton). Canned stub transcript until T6 wires Gemini.

**Files:** `server/live-bridge.js`, `server.js` (wire in).

- [ ] Create `server/live-bridge.js` with per-connection state, message switch, cleanup.
- [ ] On `start_session`, schedule a 500ms stub `transcript` reply so end-to-end tests pass pre-Gemini.
- [ ] Call `attachLiveBridge(wss)` from `server.js`.

```js
// server/live-bridge.js
const { URL } = require("url");
const agents = require("../data/agents.json");
const { pickAvatarProfile } = require("./anam");

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function parseQuery(reqUrl) {
  const u = new URL(reqUrl, "http://localhost");
  return {
    sessionId: u.searchParams.get("sessionId") || "",
    agentSlug: u.searchParams.get("agentSlug") || "",
  };
}

function attachLiveBridge(wss) {
  wss.on("connection", (ws, req) => {
    const { sessionId, agentSlug } = parseQuery(req.url);
    const agent = agents.find((a) => a.slug === agentSlug);
    const profile = pickAvatarProfile(agentSlug);
    const state = { gemini: null, history: [], muted: false, ackIndex: 0 };

    console.log(`[live] open sessionId=${sessionId} agentSlug=${agentSlug}`);

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "start_session":
          if (!agent) {
            send(ws, { type: "error", message: `Unknown agent ${agentSlug}` });
            ws.close();
            return;
          }
          // T6 will replace this stub with openGemini(...).
          setTimeout(() => {
            const text = `[stub] Hello — you are speaking with ${profile.name}. Ready when you are.`;
            state.history.push({ role: "Agent", text });
            send(ws, { type: "transcript", role: "Agent", text });
            send(ws, { type: "transcript_ack", index: ++state.ackIndex });
          }, 500);
          break;
        case "user_transcript":
          if (state.muted) break;
          state.history.push({ role: "User", text: msg.text });
          send(ws, { type: "transcript_ack", index: ++state.ackIndex });
          // Forwarded to Gemini in T6.
          break;
        case "code_snapshot":
          // Forwarded as system note in T6.
          break;
        case "screen_frame":
          // Forwarded as inline image in T6.
          break;
        case "screen_share_state":
          console.log(`[live] screen_share active=${msg.active} surface=${msg.surface || ""}`);
          break;
        case "mute":
          state.muted = !!msg.muted;
          break;
        case "get_history":
          send(ws, { type: "history", history: state.history });
          break;
        default:
          break;
      }
    });

    ws.on("close", () => {
      console.log(`[live] close sessionId=${sessionId}`);
      state.gemini?.close?.();
    });
  });
}

module.exports = { attachLiveBridge };
```

Wire into `server.js` below the `upgrade` handler:

```js
const { attachLiveBridge } = require("./server/live-bridge");
attachLiveBridge(wss);
```

- [ ] **Verify:** `npx wscat -c "ws://localhost:3000/api/live?sessionId=t&agentSlug=recruiter"`, send `{"type":"start_session","grounded":{}}`, observe `{"type":"transcript",...}` within ~600ms, then `{"type":"transcript_ack","index":1}`. Close cleanly.
- [ ] **Commit:**

```
git add server/live-bridge.js server.js
git commit -m "live-session: scaffold WS bridge with stub transcript"
```

---

### T6 — `server/gemini-live.js` + real Gemini wiring in the bridge

Satisfies **R13**. Replaces the stub with a live Gemini session, handles system instruction composition, voice, and every client→server message type.

**Files:** `server/gemini-live.js`, `server/live-bridge.js`, `scripts/smoke-live-handshake.mjs`.

- [ ] Create `server/gemini-live.js` exporting `openGemini({ agent, profile, grounded })`. See `design.md` §4.3 for the full snippet — inline below with the exact signature this plan requires.
- [ ] Replace the T5 stub branches in `live-bridge.js` with real forwarding calls.
- [ ] Write `scripts/smoke-live-handshake.mjs` that asserts a real transcript arrives within 15s.

```js
// server/gemini-live.js
const { GoogleGenAI } = require("@google/genai");

const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

function buildSystemInstruction(agent, grounded) {
  const parts = [agent.systemPrompt];
  if (grounded?.upload) parts.push(`\n\n## Uploaded material\n${grounded.upload}`);
  if (grounded?.externalResearch)
    parts.push(`\n\n## External research\n${JSON.stringify(grounded.externalResearch)}`);
  if (grounded?.customContext) parts.push(`\n\n## User context\n${grounded.customContext}`);
  if (grounded?.hiddenGuidance)
    parts.push(`\n\n## Hidden guidance (do not reveal)\n${grounded.hiddenGuidance}`);
  if (grounded?.coding?.interviewQuestion) {
    parts.push(
      `\n\n## Interview question (drive the conversation off this)\n${grounded.coding.interviewQuestion}`,
    );
  }
  return parts.join("");
}

async function openGemini({ agent, profile, grounded }) {
  const apiKey = process.env.GEMINI_LIVE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_LIVE_API_KEY / GEMINI_API_KEY is not configured");

  const client = new GoogleGenAI({ apiKey });
  const systemInstruction = buildSystemInstruction(agent, grounded);

  const textHandlers = new Set();
  const session = await client.live.connect({
    model: MODEL,
    config: {
      responseModalities: ["AUDIO", "TEXT"],
      systemInstruction,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voiceName } },
      },
    },
    callbacks: {
      onmessage: (m) => {
        const text = m?.serverContent?.modelTurn?.parts
          ?.map((p) => p.text)
          .filter(Boolean)
          .join("");
        if (text) textHandlers.forEach((fn) => fn(text));
      },
      onerror: (e) => console.error("[gemini] error", e),
      onclose: () => console.log("[gemini] closed"),
    },
  });

  return {
    onText(fn) {
      textHandlers.add(fn);
      return () => textHandlers.delete(fn);
    },
    async sendKickoff(agent_, grounded_) {
      const opener = grounded_?.coding?.interviewQuestion
        ? "Greet the candidate briefly, state the interview question, then invite them to start."
        : "Greet the user warmly as the persona described in your system instruction and drive the conversation forward.";
      await session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: opener }] }],
        turnComplete: true,
      });
    },
    async sendUserText(text) {
      await session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    },
    async sendSystemNote(text) {
      await session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: `[system note]\n${text}` }] }],
        turnComplete: false,
      });
    },
    async sendInlineImage(base64Data, mimeType) {
      await session.sendClientContent({
        turns: [{ role: "user", parts: [{ inlineData: { data: base64Data, mimeType } }] }],
        turnComplete: false,
      });
    },
    close() {
      try {
        session.close();
      } catch {}
    },
  };
}

module.exports = { openGemini };
```

Update `server/live-bridge.js` — replace the body of each switch branch:

```js
const { openGemini } = require("./gemini-live");

// ... inside connection handler, replace the switch(msg.type) cases:

case "start_session": {
  if (!agent) { send(ws, { type: "error", message: `Unknown agent ${agentSlug}` }); ws.close(); return; }
  try {
    state.gemini = await openGemini({ agent, profile, grounded: msg.grounded || {} });
    state.gemini.onText((text) => {
      state.history.push({ role: "Agent", text });
      send(ws, { type: "transcript", role: "Agent", text });
      send(ws, { type: "transcript_ack", index: ++state.ackIndex });
    });
    await state.gemini.sendKickoff(agent, msg.grounded || {});
  } catch (err) {
    console.error("[live] start_session failed", err);
    send(ws, { type: "error", message: String(err.message || err) });
    ws.close();
  }
  break;
}
case "user_transcript": {
  if (state.muted || !state.gemini) break;
  state.history.push({ role: "User", text: msg.text });
  send(ws, { type: "transcript_ack", index: ++state.ackIndex });
  await state.gemini.sendUserText(msg.text);
  break;
}
case "code_snapshot": {
  if (!state.gemini) break;
  await state.gemini.sendSystemNote(
    `User's current code (do not echo verbatim):\n\`\`\`${msg.language}\n${msg.snapshot}\n\`\`\``
  );
  break;
}
case "screen_frame": {
  if (!state.gemini) break;
  await state.gemini.sendInlineImage(msg.data, msg.mimeType || "image/jpeg");
  break;
}
```

```js
// scripts/smoke-live-handshake.mjs
import WebSocket from "ws";

const WS_URL = "ws://localhost:3000/api/live?sessionId=smoke&agentSlug=professor";
const TIMEOUT_MS = 15000;

const ws = new WebSocket(WS_URL);
let gotTranscript = false;

const timer = setTimeout(() => {
  console.error("FAIL no transcript within", TIMEOUT_MS, "ms");
  try {
    ws.close();
  } catch {}
  process.exit(1);
}, TIMEOUT_MS);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "start_session", grounded: {} }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "transcript" && m.role === "Agent" && m.text) {
    console.log("OK transcript:", m.text.slice(0, 80));
    gotTranscript = true;
    clearTimeout(timer);
    ws.close();
  } else if (m.type === "error") {
    console.error("FAIL server error:", m.message);
    clearTimeout(timer);
    ws.close();
    process.exit(1);
  }
});
ws.on("close", () => process.exit(gotTranscript ? 0 : 1));
ws.on("error", (e) => {
  console.error("FAIL ws error", e);
  process.exit(1);
});
```

- [ ] **Verify:** with `GEMINI_API_KEY` set and dev server running, `node scripts/smoke-live-handshake.mjs` exits 0 within 15s with a real transcript line.
- [ ] **Commit:**

```
git add server/gemini-live.js server/live-bridge.js scripts/smoke-live-handshake.mjs
git commit -m "live-session: wire Gemini Live into the WS bridge"
```

---

### T7 — Replace `app/session/[slug]/page.js` stub with the page wrapper

Satisfies **R1** (entry surface). Thin page, no logic.

**Files:** `app/session/[slug]/page.js`.

- [ ] Read `searchParams` for `threadId` / `sessionId`.
- [ ] Forward to `<SessionPage/>`.
- [ ] Keep file under 30 lines per `structure.md`.

```js
// app/session/[slug]/page.js
import SessionPage from "@/components/session-page";

export default function Page({ params, searchParams }) {
  return (
    <SessionPage
      slug={params.slug}
      threadId={searchParams?.threadId || ""}
      sessionId={searchParams?.sessionId || ""}
    />
  );
}
```

- [ ] **Verify:** navigating to `/session/recruiter?threadId=x&sessionId=y` no longer shows the stub text. (`<SessionPage/>` is scaffolded in T8.)
- [ ] **Commit:**

```
git add app/session/[slug]/page.js
git commit -m "live-session: replace session route stub with SessionPage entry"
```

---

### T8 — `SessionPage` scaffold + `usePhaseMachine` + mic permission overlay

Satisfies **R1**, **R16** (phase machine scaffolding).

**Files:** `components/session-page.js`, `components/session/mic-permission-overlay.js`, `components/session/error-overlay.js`, `app/globals.css` (append).

- [ ] Implement `usePhaseMachine` reducer with the five phases and legal transitions from `design.md` §2.
- [ ] Implement `useMicStream` which calls `getUserMedia`; expose `stream`, `retry`, `release`.
- [ ] Render `<MicPermissionOverlay>` in `preflight` and `<ErrorOverlay>` in `error`.
- [ ] Other phases render a placeholder until later tasks (`prep` → "Preparing…" text, `live` → empty stage).

```js
// components/session-page.js
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MicPermissionOverlay from "@/components/session/mic-permission-overlay";
import ErrorOverlay from "@/components/session/error-overlay";

const PHASES = ["preflight", "prep", "live", "ended", "error"];

function phaseReducer(state, action) {
  switch (action.type) {
    case "MIC_GRANTED":
      return state.phase === "preflight" ? { ...state, phase: "prep" } : state;
    case "PREP_DONE":
      return state.phase === "prep" ? { ...state, phase: "live" } : state;
    case "END":
      return state.phase === "live" ? { ...state, phase: "ended" } : state;
    case "FAIL":
      return { ...state, phase: "error", errorMessage: action.message };
    case "RESET":
      return { phase: "preflight", errorMessage: null };
    default:
      return state;
  }
}

export default function SessionPage({ slug, threadId, sessionId }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(phaseReducer, { phase: "preflight", errorMessage: null });
  const micStreamRef = useRef(null);
  const [micReady, setMicReady] = useState(false);

  const requestMic = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = s;
      setMicReady(true);
      dispatch({ type: "MIC_GRANTED" });
    } catch {
      dispatch({
        type: "FAIL",
        message: "Microphone access is required. Please grant permission and refresh.",
      });
    }
  }, []);

  const releaseAll = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setMicReady(false);
  }, []);

  const handleRetry = useCallback(() => {
    releaseAll();
    dispatch({ type: "RESET" });
  }, [releaseAll]);

  const handleExit = useCallback(() => {
    releaseAll();
    router.push(`/agents/${slug}/threads/${threadId}`);
  }, [releaseAll, router, slug, threadId]);

  useEffect(() => () => releaseAll(), [releaseAll]);

  return (
    <div className="session-root">
      {state.phase === "preflight" && <MicPermissionOverlay onAllow={requestMic} />}
      {state.phase === "prep" && <div className="session-prep-stub">Preparing session…</div>}
      {state.phase === "live" && (
        <div className="session-live-stub">Live phase placeholder (T9+).</div>
      )}
      {state.phase === "ended" && <div className="session-ended-stub">Session ended.</div>}
      {state.phase === "error" && (
        <ErrorOverlay message={state.errorMessage} onRetry={handleRetry} onExit={handleExit} />
      )}
    </div>
  );
}
```

```js
// components/session/mic-permission-overlay.js
"use client";
export default function MicPermissionOverlay({ onAllow }) {
  return (
    <div className="session-overlay">
      <div className="session-overlay-card">
        <h2>Allow microphone</h2>
        <p>Spark needs your microphone to run the rehearsal.</p>
        <button className="session-primary" onClick={onAllow}>
          Allow microphone
        </button>
      </div>
    </div>
  );
}
```

```js
// components/session/error-overlay.js
"use client";
export default function ErrorOverlay({ message, onRetry, onExit }) {
  return (
    <div className="session-overlay">
      <div className="session-overlay-card">
        <h2>Something went wrong</h2>
        <p>{message || "Unexpected error."}</p>
        <div className="session-overlay-actions">
          <button className="session-primary" onClick={onRetry}>
            Retry
          </button>
          <button className="session-secondary" onClick={onExit}>
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
```

Append to `app/globals.css`:

```css
.session-root {
  position: fixed;
  inset: 0;
  background: var(--bg);
  color: var(--text);
}
.session-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
  z-index: 50;
}
.session-overlay-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-6);
  max-width: 420px;
  box-shadow: var(--shadow);
}
.session-overlay-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.session-primary {
  background: var(--accent);
  color: #fff;
  padding: var(--space-3) var(--space-5);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
.session-secondary {
  background: transparent;
  color: var(--text);
  padding: var(--space-3) var(--space-5);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}
.session-prep-stub,
.session-live-stub,
.session-ended-stub {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--text-muted);
}
```

- [ ] **Verify:** `/session/recruiter?threadId=t1&sessionId=s1` shows the mic overlay. Click allow, deny in the browser → error overlay reads "Microphone access is required…"; Retry resets.
- [ ] **Commit:**

```
git add components/session-page.js components/session/mic-permission-overlay.js components/session/error-overlay.js app/globals.css
git commit -m "live-session: scaffold SessionPage with phase machine and mic overlay"
```

---

### T9 — Prep phase + `prep-overlay.js` + external-context fetch

Satisfies **R2**. Fires `/api/agent-external-context` for all non-professor agents; skips for professor; soft-fails to `live` with a toast.

**Files:** `components/session/prep-overlay.js`, `components/session-page.js`.

- [ ] Add `prep-overlay.js` with rotating status text.
- [ ] In `SessionPage`, when entering `prep`, `fetch('/api/agent-external-context')` with the grounding body; professor skips. Store into `researchPrep.result` via `patchAgent`.
- [ ] On success → dispatch `PREP_DONE`. On failure → dispatch `PREP_DONE` and `pushToast({ message: 'Could not fetch external context — continuing without it.', kind: 'info' })`.

```js
// components/session/prep-overlay.js
"use client";
import { useEffect, useState } from "react";

const STEPS = [
  "Reading your materials…",
  "Pulling context about the company…",
  "Assembling the agent's brief…",
  "Warming up the avatar…",
];

export default function PrepOverlay() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % STEPS.length), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="session-overlay">
      <div className="session-overlay-card">
        <h2>Preparing your session</h2>
        <p>{STEPS[i]}</p>
      </div>
    </div>
  );
}
```

Add inside `SessionPage` (after mic grant, before live phase):

```js
import { useAppState, useAppActions } from "@/components/app-provider";
import { getHttpBase } from "@/lib/client-config";
import PrepOverlay from "@/components/session/prep-overlay";
import agentsCatalog from "@/data/agents.json";

// inside component:
const { state } = useAppState();
const { patchAgent, pushToast } = useAppActions();
const agent = agentsCatalog.find((a) => a.slug === slug);

useEffect(() => {
  if (state.phase ? null : null); // placeholder to silence lint when empty
}, []);

useEffect(() => {
  if (state.phase !== undefined) return; // no-op
}, []);

useEffect(() => {
  // Only run on entering prep
  if (state.phase) return;
}, []);
```

(The snippet above is illustrative of the hook layout; the actual effect below is what matters.)

Replace the body of the prep-handling section in `session-page.js` — use this exact effect:

```js
useEffect(() => {
  if (state.phase !== undefined) {
    /* noop */
  }
}, []);

// --- real effect ---
useEffect(() => {
  if (state /* phaseState */ && false) return; // guard removed in actual code
}, []);
```

Final integrated snippet to drop into `session-page.js` (replacing the placeholder prep branch):

```js
// Inside SessionPage, below the mic effect:

useEffect(() => {
  if (statePhase() !== "prep") return;
  let cancelled = false;
  (async () => {
    if (slug === "professor") {
      dispatch({ type: "PREP_DONE" });
      return;
    }
    try {
      const slice = state.agents[slug] || {};
      const body = {
        agentSlug: slug,
        thread: (state.threads[slug] || []).find((t) => t.id === threadId) || null,
        customContext: slice.customContextText || "",
        companyUrl: slice.companyUrl || "",
        upload: slice.upload || null,
      };
      const r = await fetch(`${getHttpBase()}/api/agent-external-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const result = await r.json();
      if (cancelled) return;
      patchAgent(slug, { researchPrep: { status: "ready", result } });
      dispatch({ type: "PREP_DONE" });
    } catch {
      if (cancelled) return;
      patchAgent(slug, { researchPrep: { status: "ready", result: null } });
      pushToast({
        message: "Could not fetch external context — continuing without it.",
        kind: "info",
      });
      dispatch({ type: "PREP_DONE" });
    }
  })();
  return () => {
    cancelled = true;
  };
  // Use a small helper to read the current phase from the reducer
  function statePhase() {
    return state.__phase || null;
  }
}, [slug, threadId]);
```

Note: the reducer-state is local to `SessionPage`. The cleaner form is to gate this effect on `reducerState.phase === "prep"` by making `reducerState` a dependency. Use this simpler form in the implementation:

```js
useEffect(() => {
  if (reducerState.phase !== "prep") return;
  // ...fetch body as above, dispatching PREP_DONE or pushing toast...
}, [reducerState.phase, slug, threadId]);
```

Render the overlay:

```js
{
  reducerState.phase === "prep" && <PrepOverlay />;
}
```

- [ ] **Verify (professor skip):** `/session/professor?...` advances past prep immediately (no network call in Network tab).
- [ ] **Verify (non-professor soft-fail):** stop the server's `/api/agent-external-context` handler (or expect 404 before that spec lands) → toast appears, phase advances to `live`.
- [ ] **Commit:**

```
git add components/session/prep-overlay.js components/session-page.js
git commit -m "live-session: add prep phase with external-context fetch and toast fallback"
```

---

### T10 — `lib/ws-client.js` wrapper + `useLiveSocket` hook + `start_session` handshake

Satisfies **R4**, **R6** (transcript receipt).

**Files:** `lib/ws-client.js`, `components/session-page.js`.

- [ ] Create `lib/ws-client.js` — no reconnect, simple `on(type, fn)` router.
- [ ] Add `useLiveSocket({ sessionId, agentSlug })` hook inside `session-page.js` (or a new `lib/use-live-socket.js`). Opens WS on `live`, sends one `start_session` frame with full `grounded` payload, routes `transcript` events into `appendTranscript` and future dispatches. Handles `error` messages → `FAIL`. Handles unexpected `close` → `FAIL` with `"Connection lost"`.
- [ ] Extend AppProvider call sites: `appendTranscript(slug, sessionId, { role: "Agent", text, ts: Date.now() })`.

```js
// lib/ws-client.js
export function createWsClient(url) {
  const listeners = new Map();
  const ws = new WebSocket(url);
  let status = "idle";

  ws.addEventListener("open", () => {
    status = "open";
    emit("__open__", {});
  });
  ws.addEventListener("close", () => {
    status = "closed";
    emit("__close__", {});
  });
  ws.addEventListener("error", () => {
    status = "errored";
    emit("__error__", {});
  });
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      emit(msg.type, msg);
    } catch {}
  });

  function on(type, fn) {
    const arr = listeners.get(type) || [];
    arr.push(fn);
    listeners.set(type, arr);
    return () => {
      const next = (listeners.get(type) || []).filter((x) => x !== fn);
      listeners.set(type, next);
    };
  }
  function emit(type, payload) {
    (listeners.get(type) || []).forEach((fn) => fn(payload));
  }

  function send(obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }
  function close() {
    try {
      ws.close();
    } catch {}
  }
  function getStatus() {
    return status;
  }
  function bufferedAmount() {
    return ws.bufferedAmount;
  }

  return { on, send, close, getStatus, bufferedAmount };
}
```

Add in `session-page.js` (live phase effect):

```js
import { createWsClient } from "@/lib/ws-client";
import { getWsBase } from "@/lib/client-config";

useEffect(() => {
  if (reducerState.phase !== "live") return;
  const slice = state.agents[slug] || {};
  const thread = (state.threads[slug] || []).find((t) => t.id === threadId);
  const grounded = {
    upload: slice.upload?.contextText || null,
    externalResearch: slice.researchPrep?.result || null,
    customContext: slice.customContextText || null,
    hiddenGuidance: thread?.memory?.hiddenGuidance || null,
    coding: null, // filled in T13 for coding agent
  };

  const url = `${getWsBase()}/api/live?sessionId=${encodeURIComponent(sessionId)}&agentSlug=${encodeURIComponent(slug)}`;
  const ws = createWsClient(url);
  wsRef.current = ws;

  const offOpen = ws.on("__open__", () => ws.send({ type: "start_session", grounded }));
  const offTranscript = ws.on("transcript", (m) => {
    appendTranscript(slug, sessionId, { role: m.role, text: m.text, ts: Date.now() });
  });
  const offError = ws.on("error", (m) => {
    dispatch({ type: "FAIL", message: m.message || "Live session error." });
  });
  const offClose = ws.on("__close__", () => {
    if (reducerState.phase === "live") {
      dispatch({ type: "FAIL", message: "Connection lost" });
    }
  });

  return () => {
    offOpen();
    offTranscript();
    offError();
    offClose();
    ws.close();
  };
}, [reducerState.phase, slug, sessionId, threadId]);
```

Add a `wsRef = useRef(null)` at the top of `SessionPage`.

- [ ] **Verify:** hit `/session/recruiter?...` with the dev server up. Network → WS → first outgoing frame is `start_session` with all five grounded fields (some may be null). Incoming `transcript` events cause `state.sessions[slug][i].transcript` to grow in React DevTools.
- [ ] **Commit:**

```
git add lib/ws-client.js components/session-page.js
git commit -m "live-session: add WS client wrapper and start_session handshake"
```

---

### T11 — `lib/anam-client.js` + `<AvatarStage>` with Connecting shimmer

Satisfies **R3**.

**Files:** `lib/anam-client.js`, `components/session/avatar-stage.js`, `components/session-page.js`.

- [ ] Wrap `@anam-ai/js-sdk`: `createAnamStream({ sessionToken, videoEl })` returning `{ stop }`.
- [ ] Implement `<AvatarStage>` with a `<video ref>` and a `className="connecting"` shimmer overlay that hides on `onLoadedData`.
- [ ] In `SessionPage`, on `live` entry: POST `/api/anam-session-token`, instantiate Anam stream. On failure → `FAIL` with `"Avatar service unavailable"`.

```js
// lib/anam-client.js
import { createClient } from "@anam-ai/js-sdk";

export async function createAnamStream({ sessionToken, videoEl }) {
  const client = createClient(sessionToken);
  await client.streamToVideoElement(videoEl.id || "spark-avatar-video");
  return {
    stop() {
      try {
        client.stopStreaming();
      } catch {}
    },
  };
}
```

```js
// components/session/avatar-stage.js
"use client";
import { useEffect, useRef } from "react";

export default function AvatarStage({ onVideoRef }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && onVideoRef) onVideoRef(ref.current);
  }, [onVideoRef]);
  return (
    <div className="session-avatar-stage">
      <video
        id="spark-avatar-video"
        ref={ref}
        autoPlay
        playsInline
        muted={false}
        className="session-avatar-video"
      />
      <div className="session-avatar-shimmer" data-ready="false">
        Connecting…
      </div>
    </div>
  );
}
```

Append CSS:

```css
.session-avatar-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  background: #000;
  border-radius: var(--radius);
  overflow: hidden;
}
.session-avatar-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.session-avatar-shimmer {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04),
    rgba(255, 255, 255, 0.1),
    rgba(255, 255, 255, 0.04)
  );
  background-size: 200% 100%;
  animation: sparkShimmer 1.4s infinite;
}
.session-avatar-shimmer[data-ready="true"] {
  display: none;
}
@keyframes sparkShimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
```

Inside `SessionPage`, on `live` entry (separate effect):

```js
import { createAnamStream } from "@/lib/anam-client";

const videoElRef = useRef(null);
const anamRef = useRef(null);

useEffect(() => {
  if (reducerState.phase !== "live") return;
  let cancelled = false;
  (async () => {
    try {
      const r = await fetch(`${getHttpBase()}/api/anam-session-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: slug }),
      });
      if (!r.ok) throw new Error("token");
      const { sessionToken } = await r.json();
      if (cancelled || !videoElRef.current) return;
      const stream = await createAnamStream({ sessionToken, videoEl: videoElRef.current });
      anamRef.current = stream;
      videoElRef.current.addEventListener(
        "loadeddata",
        () => {
          const s = document.querySelector(".session-avatar-shimmer");
          if (s) s.dataset.ready = "true";
        },
        { once: true },
      );
    } catch {
      if (!cancelled) dispatch({ type: "FAIL", message: "Avatar service unavailable" });
    }
  })();
  return () => {
    cancelled = true;
    anamRef.current?.stop();
    anamRef.current = null;
  };
}, [reducerState.phase, slug]);
```

Render in the `live` branch:

```js
{
  reducerState.phase === "live" && (
    <div className="session-stage-grid">
      <AvatarStage onVideoRef={(el) => (videoElRef.current = el)} />
      {/* TranscriptLog, ControlsBar, side panel come in later tasks. */}
    </div>
  );
}
```

- [ ] **Verify:** with `ANAM_API_KEY` set, avatar video renders within 3s, shimmer disappears on first frame.
- [ ] **Verify:** unset `ANAM_API_KEY` → Error overlay "Avatar service unavailable".
- [ ] **Commit:**

```
git add lib/anam-client.js components/session/avatar-stage.js components/session-page.js app/globals.css
git commit -m "live-session: render Anam avatar with connecting shimmer"
```

---

### T12 — `<TranscriptLog>` with auto-scroll + Jump-to-latest pill

Satisfies **R6**.

**Files:** `components/session/transcript-log.js`, `components/session-page.js`, `app/globals.css` (append).

- [ ] Render entries from `state.sessions[slug][i].transcript`.
- [ ] Auto-scroll on new entries unless user has scrolled >40px from the bottom; then show pill.

```js
// components/session/transcript-log.js
"use client";
import { useEffect, useRef, useState } from "react";

export default function TranscriptLog({ entries }) {
  const scrollerRef = useRef(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (distanceFromBottom < 40) {
      el.scrollTop = el.scrollHeight;
    } else {
      setStuck(true);
    }
  }, [entries.length]);

  function jumpToLatest() {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setStuck(false);
  }

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (distanceFromBottom < 40) setStuck(false);
  }

  return (
    <div className="session-transcript">
      <div className="session-transcript-scroll" ref={scrollerRef} onScroll={onScroll}>
        {entries.map((e, i) => (
          <div
            key={i}
            className={`session-transcript-row session-transcript-${String(e.role).toLowerCase()}`}
          >
            <span className="session-transcript-role">{e.role}</span>
            <span className="session-transcript-text">{e.text}</span>
          </div>
        ))}
      </div>
      {stuck && (
        <button className="session-transcript-jump" onClick={jumpToLatest}>
          Jump to latest
        </button>
      )}
    </div>
  );
}
```

Append CSS:

```css
.session-transcript {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.session-transcript-scroll {
  overflow-y: auto;
  padding: var(--space-4);
  flex: 1;
}
.session-transcript-row {
  margin-bottom: var(--space-3);
}
.session-transcript-role {
  display: inline-block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-right: var(--space-2);
}
.session-transcript-text {
  color: var(--text);
}
.session-transcript-jump {
  position: absolute;
  bottom: var(--space-3);
  left: 50%;
  transform: translateX(-50%);
  padding: var(--space-2) var(--space-4);
  background: var(--accent);
  color: #fff;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
```

Render in `SessionPage` (live branch, side column):

```js
const session = (state.sessions[slug] || []).find((s) => s.id === sessionId);
const entries = session?.transcript || [];

// inside live branch:
<TranscriptLog entries={entries} />;
```

- [ ] **Verify:** agent transcript messages stream in and auto-scroll; scrolling up shows the pill; clicking resumes auto-scroll.
- [ ] **Commit:**

```
git add components/session/transcript-log.js components/session-page.js app/globals.css
git commit -m "live-session: add transcript log with auto-scroll and jump-to-latest"
```

---

### T13 — `<ControlsBar>` with mute, end, elapsed timer

Satisfies **R7**, **R8**, **R9**.

**Files:** `components/session/controls-bar.js`, `components/session-page.js`.

- [ ] `<ControlsBar>` props: `{ elapsed, muted, onMute, onEnd, canShare, shareActive, onShareToggle }`.
- [ ] Implement `useElapsedTimer(isLive)` returning `"MM:SS"`.
- [ ] End button triggers teardown sequence: stop AssemblyAI, close WS, stop Anam, stop mic, stop screen share, then `patchSession` + `patchAgent` + navigate.

```js
// components/session/controls-bar.js
"use client";
export default function ControlsBar({
  elapsed,
  muted,
  onMute,
  onEnd,
  canShare,
  shareActive,
  onShareToggle,
}) {
  return (
    <div className="session-controls">
      <span className="session-controls-timer">{elapsed}</span>
      <button className="session-controls-btn" onClick={onMute}>
        {muted ? "Unmute" : "Mute"}
      </button>
      {canShare && (
        <button className="session-controls-btn" onClick={onShareToggle}>
          {shareActive ? "Stop sharing" : "Share screen"}
        </button>
      )}
      <button className="session-controls-btn danger" onClick={onEnd}>
        End session
      </button>
    </div>
  );
}
```

In `session-page.js`, add the timer hook and end-handler:

```js
function useElapsedTimer(isLive) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const start = Date.now();
    const t = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isLive]);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return { label: `${mm}:${ss}`, sec };
}

const elapsed = useElapsedTimer(reducerState.phase === "live");

const disposeAll = useCallback(() => {
  try {
    transcriberRef.current?.close();
  } catch {}
  try {
    wsRef.current?.close();
  } catch {}
  try {
    anamRef.current?.stop();
  } catch {}
  screenStreamRef.current?.getTracks().forEach((t) => t.stop());
  screenStreamRef.current = null;
  micStreamRef.current?.getTracks().forEach((t) => t.stop());
  micStreamRef.current = null;
}, []);

const handleMute = useCallback(() => {
  const next = !muted;
  setMuted(next);
  wsRef.current?.send({ type: "mute", muted: next });
  patchAgent(slug, { session: { ...state.agents[slug]?.session, muted: next } });
}, [muted, slug, state, patchAgent]);

const handleEnd = useCallback(() => {
  dispatch({ type: "END" });
}, []);

// Effect: when phase becomes "ended", finalize and navigate.
useEffect(() => {
  if (reducerState.phase !== "ended") return;
  disposeAll();
  const durationLabel = elapsed.label;
  const endedAt = new Date().toISOString();
  const codingPatch = codingStateRef.current ? { coding: codingStateRef.current } : {};
  patchSession(slug, sessionId, { endedAt, durationLabel, ...codingPatch });
  patchAgent(slug, {
    session: {
      status: "idle",
      muted: false,
      lastEndedAt: endedAt,
      lastDurationLabel: durationLabel,
    },
  });
  router.push(`/agents/${slug}/sessions/${sessionId}`);
}, [reducerState.phase]);
```

- [ ] **Verify:** timer counts up once per second starting at `00:00`. Mute toggles the button label and sends `{type:"mute",muted}` in the WS tab. End navigates to `/agents/[slug]/sessions/[sessionId]` and DevTools → Application → Media shows no active tracks.
- [ ] **Commit:**

```
git add components/session/controls-bar.js components/session-page.js
git commit -m "live-session: add controls bar with mute, end, and elapsed timer"
```

---

### T14 — `lib/assemblyai-client.js` + mic transcription wired to WS

Satisfies **R5**, **R7**.

**Files:** `lib/assemblyai-client.js`, `components/session-page.js`.

- [ ] Fetch `/api/assembly-token`, open `RealtimeTranscriber` at 16kHz, stream `micStream` PCM.
- [ ] On `FinalTranscript`: call `appendTranscript({ role: "User", text, ts })` and `ws.send({ type: "user_transcript", role: "User", text })`.
- [ ] Tear down on mute; rebuild on unmute.

```js
// lib/assemblyai-client.js
import { RealtimeService } from "assemblyai";

export async function startTranscriber({ token, micStream, onFinal }) {
  const tx = new RealtimeService({ token, sampleRate: 16000 });
  tx.on("transcript", (t) => {
    if (t.message_type === "FinalTranscript" && t.text) onFinal(t.text);
  });
  tx.on("error", (e) => console.error("[assembly] error", e));
  await tx.connect();
  tx.stream(micStream);
  return {
    async close() {
      try {
        await tx.close();
      } catch {}
    },
  };
}
```

Inside `SessionPage`:

```js
const transcriberRef = useRef(null);

useEffect(() => {
  if (reducerState.phase !== "live" || !micStreamRef.current || muted) return;
  let cancelled = false;
  (async () => {
    try {
      const r = await fetch(`${getHttpBase()}/api/assembly-token`);
      if (!r.ok) throw new Error("token");
      const { token } = await r.json();
      if (cancelled) return;
      const tx = await startTranscriber({
        token,
        micStream: micStreamRef.current,
        onFinal: (text) => {
          appendTranscript(slug, sessionId, { role: "User", text, ts: Date.now() });
          wsRef.current?.send({ type: "user_transcript", role: "User", text });
        },
      });
      transcriberRef.current = tx;
    } catch {
      pushToast({ message: "Transcription unavailable.", kind: "info" });
    }
  })();
  return () => {
    cancelled = true;
    transcriberRef.current?.close();
    transcriberRef.current = null;
  };
}, [reducerState.phase, muted]);
```

- [ ] **Verify:** speak into the mic → user lines appear in the transcript within ~1s of finishing a sentence; the agent reply references them. Mute → no new user lines; unmute resumes.
- [ ] **Commit:**

```
git add lib/assemblyai-client.js components/session-page.js
git commit -m "live-session: add AssemblyAI realtime transcription wired to WS"
```

---

### T15 — `<ScreenSharePanel>` + `lib/screen-share.js` sampler + PiP handle

Satisfies **R10**.

**Files:** `lib/screen-share.js`, `components/session/screen-share-panel.js`, `components/session/pip-handle.js`, `components/session-page.js`.

- [ ] `lib/screen-share.js` exports `startScreenShare()` that calls `getDisplayMedia`, returns `{ stream, track }`.
- [ ] Implement a 500ms JPEG sampler at 1280×720, `toDataURL("image/jpeg", 0.6)`.
- [ ] Back-pressure: skip tick if `ws.bufferedAmount > 2_000_000`.
- [ ] On `track.ended`, call `onStop`.
- [ ] Start PiP on a hidden `<video>` so mute/end stay reachable.

```js
// lib/screen-share.js
export async function startScreenShare() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 8 },
    audio: false,
  });
  return { stream, track: stream.getVideoTracks()[0] };
}

export function startFrameSampler({
  videoEl,
  onFrame,
  isBlocked,
  intervalMs = 500,
  width = 1280,
  height = 720,
  quality = 0.6,
}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const timer = setInterval(() => {
    if (isBlocked()) return;
    if (!videoEl || videoEl.readyState < 2) return;
    ctx.drawImage(videoEl, 0, 0, width, height);
    const url = canvas.toDataURL("image/jpeg", quality);
    const data = url.slice(url.indexOf(",") + 1);
    onFrame(data);
  }, intervalMs);
  return () => clearInterval(timer);
}
```

```js
// components/session/screen-share-panel.js
"use client";
import { useEffect, useRef } from "react";

export default function ScreenSharePanel({ stream, active, onStop }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);
  if (!active) return <div className="session-share-empty">Screen not shared.</div>;
  return (
    <div className="session-share-panel">
      <video ref={videoRef} autoPlay muted playsInline className="session-share-preview" />
      <button className="session-controls-btn danger" onClick={onStop}>
        Stop sharing
      </button>
    </div>
  );
}
```

```js
// components/session/pip-handle.js
"use client";
import { useEffect, useRef } from "react";

export default function PipHandle({ active }) {
  const ref = useRef(null);
  useEffect(() => {
    async function enter() {
      if (!active || !ref.current) return;
      try {
        await ref.current.requestPictureInPicture();
      } catch {}
    }
    async function exit() {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
      } catch {}
    }
    if (active) enter();
    else exit();
    return () => {
      exit();
    };
  }, [active]);
  return <video ref={ref} className="session-pip-handle" muted playsInline autoPlay />;
}
```

Append CSS:

```css
.session-share-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.session-share-preview {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.session-share-empty {
  color: var(--text-muted);
  padding: var(--space-4);
}
.session-pip-handle {
  position: fixed;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
```

In `SessionPage`:

```js
import { startScreenShare, startFrameSampler } from "@/lib/screen-share";

const screenStreamRef = useRef(null);
const [shareActive, setShareActive] = useState(false);
const shareVideoRef = useRef(null);
const stopSamplerRef = useRef(null);

const handleShareToggle = useCallback(async () => {
  if (shareActive) {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    stopSamplerRef.current?.();
    stopSamplerRef.current = null;
    setShareActive(false);
    wsRef.current?.send({ type: "screen_share_state", active: false });
    return;
  }
  try {
    const { stream, track } = await startScreenShare();
    screenStreamRef.current = stream;
    setShareActive(true);
    const surface = track.getSettings?.().displaySurface || "monitor";
    wsRef.current?.send({ type: "screen_share_state", active: true, surface });
    track.addEventListener("ended", () => {
      screenStreamRef.current = null;
      stopSamplerRef.current?.();
      stopSamplerRef.current = null;
      setShareActive(false);
      wsRef.current?.send({ type: "screen_share_state", active: false });
    });
    // Attach to hidden video for sampler
    const tempVideo = document.createElement("video");
    tempVideo.srcObject = stream;
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    await tempVideo.play();
    stopSamplerRef.current = startFrameSampler({
      videoEl: tempVideo,
      onFrame: (data) =>
        wsRef.current?.send({ type: "screen_frame", data, mimeType: "image/jpeg" }),
      isBlocked: () => (wsRef.current?.bufferedAmount?.() || 0) > 2_000_000,
    });
  } catch {
    pushToast({ message: "Screen share cancelled.", kind: "info" });
  }
}, [shareActive]);
```

Render inside the live branch:

```js
{
  slug !== "coding" && (
    <ScreenSharePanel
      stream={screenStreamRef.current}
      active={shareActive}
      onStop={handleShareToggle}
    />
  );
}
<PipHandle active={shareActive} />;
```

- [ ] **Verify:** click Share screen, pick a tab, tab away. Frames arrive in the server WS at ~2/s (`screen_frame` in Network). Native Stop flips UI back. PiP handle opens and tracks mute/end reachability. Recruiter referenced visible content.
- [ ] **Commit:**

```
git add lib/screen-share.js components/session/screen-share-panel.js components/session/pip-handle.js components/session-page.js app/globals.css
git commit -m "live-session: add screen share with 500ms sampler and PiP handle"
```

---

### T16 — `<CodeEditorPanel>` with language picker + question markdown (coding agent only)

Satisfies **R11**.

**Files:** `components/session/code-editor-panel.js`, `components/session-page.js`.

- [ ] Render markdown of the interview question on the left, CodeMirror on the right.
- [ ] `LANG_MAP` from `design.md` §9. Default language = `agent.codingLanguages[0]` (lowercased).
- [ ] Debounce editor changes 600ms → send `{type:"code_snapshot", snapshot, language}`.
- [ ] Language change → immediate `code_snapshot` with new language.
- [ ] Store latest `{ language, finalCode, interviewQuestion }` in `codingStateRef` so T13's end-handler can persist it.

```js
// components/session/code-editor-panel.js
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql } from "@codemirror/lang-sql";

const LANG_MAP = {
  javascript: javascript(),
  python: python(),
  java: java(),
  cpp: cpp(),
  sql: sql(),
  pseudocode: [],
};

export default function CodeEditorPanel({
  question,
  languages,
  onSnapshot,
  onLanguageChange,
  initialLanguage,
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const [code, setCode] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function handleChange(value) {
    setCode(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSnapshot({ snapshot: value, language }), 600);
  }

  function handleLangChange(e) {
    const next = e.target.value;
    setLanguage(next);
    onLanguageChange({ language: next, code });
    onSnapshot({ snapshot: code, language: next });
  }

  const extensions = useMemo(() => [LANG_MAP[language] || []], [language]);

  return (
    <div className="session-coding">
      <div className="session-coding-question">
        <h3>{question?.title || "Interview question"}</h3>
        <pre className="session-coding-markdown">{question?.markdown || ""}</pre>
      </div>
      <div className="session-coding-editor">
        <select value={language} onChange={handleLangChange} className="session-controls-btn">
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <CodeMirror value={code} height="100%" extensions={extensions} onChange={handleChange} />
      </div>
    </div>
  );
}
```

Append CSS:

```css
.session-coding {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  height: 100%;
}
.session-coding-question,
.session-coding-editor {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4);
  overflow: auto;
}
.session-coding-markdown {
  white-space: pre-wrap;
  font-family: var(--font-mono);
  color: var(--text-muted);
}
```

In `SessionPage`:

```js
const codingStateRef = useRef(null);

const codingQuestion = useMemo(() => {
  if (slug !== "coding") return null;
  const slice = state.agents[slug] || {};
  return slice.researchPrep?.result?.codingQuestion || agent?.codingQuestionBank?.[0] || null;
}, [slug, state]);

// When entering live, seed codingStateRef
useEffect(() => {
  if (slug !== "coding" || reducerState.phase !== "live" || !codingQuestion) return;
  const initialLanguage = (agent.codingLanguages?.[0] || "javascript").toLowerCase();
  codingStateRef.current = {
    language: initialLanguage,
    finalCode: "",
    interviewQuestion: codingQuestion.markdown || codingQuestion.title || "",
  };
}, [slug, reducerState.phase, codingQuestion]);

// Render, replacing the <ScreenSharePanel> branch for coding:
{
  slug === "coding" ? (
    <CodeEditorPanel
      question={codingQuestion}
      languages={(agent?.codingLanguages || []).map((l) => l.toLowerCase())}
      initialLanguage={(agent?.codingLanguages?.[0] || "javascript").toLowerCase()}
      onSnapshot={({ snapshot, language }) => {
        codingStateRef.current = {
          ...(codingStateRef.current || {}),
          language,
          finalCode: snapshot,
          interviewQuestion:
            codingStateRef.current?.interviewQuestion || codingQuestion?.markdown || "",
        };
        wsRef.current?.send({ type: "code_snapshot", snapshot, language });
      }}
      onLanguageChange={({ language }) => {
        codingStateRef.current = { ...(codingStateRef.current || {}), language };
      }}
    />
  ) : (
    <ScreenSharePanel
      stream={screenStreamRef.current}
      active={shareActive}
      onStop={handleShareToggle}
    />
  );
}
```

Also ensure the live-WS effect sets `grounded.coding` for the coding agent:

```js
if (slug === "coding" && codingQuestion) {
  grounded.coding = {
    interviewQuestion: codingQuestion.markdown || codingQuestion.title,
    language: (agent.codingLanguages?.[0] || "javascript").toLowerCase(),
  };
}
```

- [ ] **Verify:** start a coding session. Type Python code. Debounced `code_snapshot` arrives every ~600ms while typing. Change language → immediate `code_snapshot` with new language. End session → re-open `/agents/coding/sessions/...` → session record has `coding.finalCode`, `coding.language`, `coding.interviewQuestion`.
- [ ] **Commit:**

```
git add components/session/code-editor-panel.js components/session-page.js app/globals.css
git commit -m "live-session: add coding workspace with language picker and debounced snapshots"
```

---

### T17 — `<ControlsBar>` wired for non-coding share toggle + grounding payload trim

Satisfies **R4** (grounded payload), **R10** (controls).

**Files:** `components/session-page.js`.

- [ ] Pass `canShare={slug !== "coding"}`, `shareActive`, `onShareToggle` to the `<ControlsBar>`.
- [ ] Cap the grounded payload: if `JSON.stringify(grounded) > 64_000`, truncate `externalResearch` to the first 2000 chars and `console.warn`.

```js
function trimGrounded(g) {
  let s = JSON.stringify(g);
  if (s.length <= 64_000) return g;
  console.warn("[live] grounded payload over 64KB, truncating externalResearch");
  const er = g.externalResearch ? JSON.stringify(g.externalResearch).slice(0, 2000) : null;
  return { ...g, externalResearch: er };
}

// In the open handler:
ws.send({ type: "start_session", grounded: trimGrounded(grounded) });
```

Controls render:

```js
{
  reducerState.phase === "live" && (
    <ControlsBar
      elapsed={elapsed.label}
      muted={muted}
      onMute={handleMute}
      onEnd={handleEnd}
      canShare={slug !== "coding"}
      shareActive={shareActive}
      onShareToggle={handleShareToggle}
    />
  );
}
```

- [ ] **Verify:** Network → WS → first outgoing frame for a recruiter session with a long research blob is ≤64KB. Coding session shows no Share button.
- [ ] **Commit:**

```
git add components/session-page.js
git commit -m "live-session: wire controls share toggle and cap grounded payload at 64KB"
```

---

### T18 — Wire post-session cleanup + navigate to session detail

Satisfies **R8** (final transition), **R11** (coding persistence).

**Files:** `components/session-page.js`.

- [ ] Confirm the `ended`-phase effect from T13 persists `endedAt`, `durationLabel`, `transcript` (already streamed via `appendTranscript`), and coding (if set).
- [ ] Unmount-during-live should trigger the same dispose path; add a cleanup effect that runs `disposeAll()` unconditionally on unmount.

```js
useEffect(() => () => disposeAll(), [disposeAll]);
```

Also set `state.agents[slug].session.status = "live"` when entering live, and `"ended"` on end, via `patchAgent`.

- [ ] **Verify:** click End → URL becomes `/agents/[slug]/sessions/[sessionId]`. Mid-session navigate-away: no orphan tracks (DevTools → Application → Media is empty).
- [ ] **Commit:**

```
git add components/session-page.js
git commit -m "live-session: finalize session record and release resources on end"
```

---

### T19 — Error-path coverage (WS close, Gemini error, Anam death)

Satisfies **R16**.

**Files:** `components/session-page.js`.

- [ ] Centralize `disposeAll()` so it runs before every `FAIL` dispatch.
- [ ] Wire `ws.on("__error__")` and `ws.on("error")` (server-emitted) into `FAIL`.
- [ ] On Retry from error: reset phase and re-run preflight. Exit routes back to thread page.

```js
function failWith(message) {
  disposeAll();
  dispatch({ type: "FAIL", message });
}

// Replace all dispatch({type:"FAIL",...}) calls with failWith(...).
```

- [ ] **Verify:** kill the dev server mid-session → overlay reads "Connection lost"; Retry restarts from preflight; Exit routes to `/agents/[slug]/threads/[threadId]`.
- [ ] **Commit:**

```
git add components/session-page.js
git commit -m "live-session: centralize teardown and wire all failure paths to error overlay"
```

---

### T20 — Smoke run `smoke-live-handshake.mjs` with real Gemini

Satisfies **R13** (verification).

**Files:** none (runs existing script).

- [ ] Start dev server with `GEMINI_API_KEY` set.
- [ ] `node scripts/smoke-live-handshake.mjs` → exit 0.
- [ ] Repeat for each agent slug by editing the script's `WS_URL` (or parameterize it; out-of-scope here).

- [ ] **Verify:** script exits 0.
- [ ] **Commit:** no code change — skip if no diff.

---

### T21 — Manual QA pass per agent (preflight → prep → live → ended → error)

Satisfies **R1–R16**. Full manual matrix.

For each agent (recruiter, professor, investor, coding, custom):

- [ ] **Preflight:** open `/session/{slug}?threadId=...&sessionId=...` → mic overlay appears. Deny → error overlay shows correct message; Retry returns to mic overlay.
- [ ] **Prep (non-professor):** allow mic → PrepOverlay shows with rotating status. Wait for `/api/agent-external-context` resolve or fail → advance to `live`.
- [ ] **Prep (professor):** allow mic → advances directly to `live`.
- [ ] **Live:** avatar renders within 3s; transcript log shows agent's opening line; speak → user line appears; agent replies reference user speech.
- [ ] **Screen share (non-coding):** click Share, pick a tab, walk through it → agent references on-screen content. Stop via native bar → UI flips back. PiP surface opens.
- [ ] **Coding editor:** interview question renders, language picker defaults to JavaScript (or first in `codingLanguages`), typing triggers debounced snapshots, language change triggers immediate snapshot.
- [ ] **Mute:** toggle → no new user lines; unmute resumes.
- [ ] **End:** click End → navigates to `/agents/[slug]/sessions/[sessionId]`; session record has transcript and (for coding) `coding` object.
- [ ] **Error:** kill server → overlay "Connection lost"; Retry → preflight; Exit → thread page.

No commit required unless fixes surface.

---

## Contract handoff

This plan extends the AppProvider state shape defined in `agents-and-threads/design.md` §4. Other plans may consume these fields.

### Added to `state.agents[slug].session`

```js
state.agents[slug].session = {
  status: "idle" | "preflight" | "prep" | "live" | "ended" | "error",
  muted: boolean,
  lastEndedAt: string | null, // ISO, set on end or error
  lastDurationLabel: string | null, // "MM:SS", set on end or error
};
```

### Added to `state.sessions[slug][i]`

```js
state.sessions[slug][i].transcript = [
  { role: "User" | "Agent", text: string, ts: number }, // appended via appendTranscript()
];

// Coding agent only:
state.sessions[slug][i].coding = {
  language: "javascript" | "python" | "java" | "cpp" | "sql" | "pseudocode",
  finalCode: string,
  interviewQuestion: string,
};

state.sessions[slug][i].endedAt = string | null; // ISO, written on end
state.sessions[slug][i].durationLabel = string | null; // "MM:SS", written on end
```

### AppProvider actions this plan relies on

- `appendTranscript(slug, sessionId, { role, text, ts })` — role is `"User" | "Agent"` (upstream agents-and-threads used lowercase; this plan assumes the provider normalizes casing or accepts the values given).
- `patchSession(slug, sessionId, { endedAt, durationLabel, coding? })` — finalization.
- `patchAgent(slug, { session, researchPrep })` — lifecycle writes.
- `pushToast({ message, kind })` — soft-failure surface.

### Environment variables this plan introduces

- `NEXT_PUBLIC_BACKEND_HTTP_URL`, `NEXT_PUBLIC_BACKEND_WS_URL` (public).
- `ANAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `GEMINI_LIVE_API_KEY` (server-only; fallback to `GEMINI_API_KEY`).

Downstream consumers:

- **`evaluation-engine`** reads `sessions[slug][i].transcript`, `.coding`, `.endedAt`, `.durationLabel` to trigger its auto-evaluation effect.
- **`research-and-resources`** writes `state.agents[slug].researchPrep.result` which this plan consumes in `prep` and forwards as `grounded.externalResearch`.
- **`session-comparison`** has no direct dependency; it uses whatever this plan wrote to `sessions[slug]`.
