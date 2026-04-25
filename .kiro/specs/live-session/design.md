# Design — Live Session

## 1. Overview

The live-session feature turns a thread's "Start Session" click into a full-screen rehearsal at `/session/[slug]`. It owns the realtime leg of the product: mic capture, Gemini Live voice loop, Anam avatar video, user transcription via AssemblyAI, screen share, and (for the coding agent) a CodeMirror editor driven by a prefetched interview question. The feature starts in a guarded `preflight` phase and ends by writing a complete transcript (+ optional `coding`) into the session record, after which the AppProvider's auto-effect triggers the evaluation spec.

No database exists. All persistence is the AppProvider's debounced localStorage mirror.

---

## 2. State machine

```
 ┌────────────┐  grant    ┌───────┐   prep done    ┌──────┐  user-ends   ┌───────┐
 │  preflight │──────────▶│ prep  │───────────────▶│ live │─────────────▶│ ended │─▶ navigate to session detail
 └────────────┘           └───────┘                └──────┘              └───────┘
       │                     │ fetch fails (soft)     │ ws-drop / anam-fail / gemini-fail
       │ deny / getUM reject │   (continue)           │
       ▼                     ▼                        ▼
   ┌────────────────────────── error ──────────────────────────┐
   │   Retry → preflight     Exit → /agents/[slug]/threads/... │
   └────────────────────────────────────────────────────────────┘
```

Legal transitions (all others throw in dev):
- `preflight → prep` on mic granted
- `preflight → error` on mic denied
- `prep → live` on research resolved (or skipped for `professor`)
- `prep → error` on token fetch hard-fail (not research soft-fail)
- `live → ended` on explicit user End
- `live → error` on WS close / Gemini error / Anam stream death
- `error → preflight` on Retry
- any → `ended` on unmount cleanup (navigation away mid-session)

---

## 3. Frontend architecture

### 3.1 Page entry

```
// app/session/[slug]/page.js
import SessionPage from "@/components/session-page";
export default function Page({ params }) {
  return <SessionPage slug={params.slug} />;
}
```

Under ~30 lines, no logic — per `structure.md`.

### 3.2 `components/session-page.js` breakdown

```
SessionPage (orchestrator)
├── usePhaseMachine()              // reducer: preflight|prep|live|ended|error
├── useMicStream()                 // getUserMedia, track lifecycle
├── useAnamClient(token, videoRef) // @anam-ai/js-sdk lifecycle
├── useLiveSocket(sessionId, slug) // ws open/send/recv; exposes sendMessage, onEvent
├── useAssemblyAiTranscriber(mic, muted, onFinal)
├── useElapsedTimer(isLive)        // returns "MM:SS"
│
├── <PreflightOverlay />                       // phase === 'preflight'
├── <PrepOverlay statusText/>                  // phase === 'prep'
├── <ErrorOverlay message onRetry onExit/>     // phase === 'error'
│
└── <LiveStage>                                // phase === 'live'
    ├── <AvatarPanel videoRef loading/>
    ├── <TranscriptPanel entries autoscroll/>
    ├── <ControlsBar
    │     elapsed muted onMute onEnd
    │     canShare={!isCoding}
    │     shareActive onShareToggle />
    ├── {isCoding
    │     ? <CodingWorkspace question language code
    │         onChange onLanguageChange />
    │     : <ScreenSharePreview stream active/>}
    └── <PictureInPictureHandle videoRef/>      // invisible, PiP-only
```

### 3.3 Sub-components

- **`TranscriptPanel`** — virtualized list of `{role:"User"|"Agent", text, ts}`. Auto-scroll unless user scrolled up (>40px from bottom). Sticky "Jump to latest" pill.
- **`ScreenSharePreview`** — shows a `<video>` with `srcObject = screenStream`, plus a small "Stop sharing" overlay button.
- **`CodingWorkspace`** — two-pane: left = markdown-rendered interview question, right = CodeMirror editor with language dropdown.
- **`ControlsBar`** — mute, end, elapsed, share toggle.
- **`AvatarPanel`** — main 16:9 `<video>` target for Anam.

### 3.4 Hooks contract

```
useLiveSocket({ sessionId, agentSlug }) → {
  status: "idle"|"open"|"closed"|"errored",
  send(msg),                   // JSON.stringify under the hood
  on(type, handler),           // returns unsubscribe
  close(),
}

useAssemblyAiTranscriber({ stream, muted, onFinal }) → {
  status: "idle"|"listening"|"paused"|"errored",
  restart(),
}

useAnamClient({ token, profile, videoRef }) → {
  status: "idle"|"connecting"|"streaming"|"errored",
  stop(),
}
```

---

## 4. Backend architecture

### 4.1 `server.js` (bootstrap)

```js
const http = require("http");
const express = require("express");
const next = require("next");
const { WebSocketServer } = require("ws");
const { attachLiveBridge } = require("./server/live-bridge");
const { anamSessionTokenHandler } = require("./server/anam");

const app = next({ dev: process.env.NODE_ENV !== "production" });
const handle = app.getRequestHandler();

await app.prepare();
const expressApp = express();
expressApp.use(express.json({ limit: "15mb" }));
expressApp.post("/api/anam-session-token", anamSessionTokenHandler);
// ...other routes from other specs
expressApp.all("*", (req, res) => handle(req, res));

const server = http.createServer(expressApp);
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://x");
  if (pathname === "/api/live") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});
attachLiveBridge(wss);
server.listen(process.env.PORT || 3000, process.env.HOST || "0.0.0.0");
```

### 4.2 `server/live-bridge.js` lifecycle

```
attachLiveBridge(wss):
  wss.on("connection", async (ws, req) => {
    const { sessionId, agentSlug } = parseQuery(req.url);
    const agent = getAgent(agentSlug);
    const profile = pickAvatarProfile(agentSlug);  // same fn as anam.js
    const state = {
      gemini: null,
      history: [],
      muted: false,
      closed: false,
    };

    ws.on("message", async (raw) => {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case "start_session":
          state.gemini = await openGemini({ agent, profile, grounded: msg.grounded });
          state.gemini.onText((text) => {
            state.history.push({ role: "Agent", text });
            send(ws, { type: "transcript", role: "Agent", text });
          });
          await state.gemini.sendKickoff(agent, msg.grounded);
          break;
        case "user_transcript":
          if (state.muted) return;
          state.history.push({ role: "User", text: msg.text });
          await state.gemini.sendUserText(msg.text);
          break;
        case "code_snapshot":
          await state.gemini.sendSystemNote(
            `User's current code (do not echo verbatim):\n\`\`\`${msg.language}\n${msg.snapshot}\n\`\`\``
          );
          break;
        case "screen_frame":
          await state.gemini.sendInlineImage(msg.data, msg.mimeType);
          break;
        case "screen_share_state":
          console.log(`[live] share=${msg.active} surface=${msg.surface}`);
          break;
        case "mute":
          state.muted = !!msg.muted;
          break;
        case "get_history":
          send(ws, { type: "history", history: state.history });
          break;
      }
    });

    ws.on("close", () => {
      state.closed = true;
      state.gemini?.close();
    });
  });
```

### 4.3 Gemini Live session config

```js
import { GoogleGenAI } from "@google/genai";

async function openGemini({ agent, profile, grounded }) {
  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_LIVE_API_KEY || process.env.GEMINI_API_KEY,
  });
  const systemInstruction = [
    agent.systemPrompt,
    grounded.upload         && `\n\n## Uploaded material\n${grounded.upload}`,
    grounded.externalResearch && `\n\n## External research\n${JSON.stringify(grounded.externalResearch)}`,
    grounded.customContext  && `\n\n## User context\n${grounded.customContext}`,
    grounded.hiddenGuidance && `\n\n## Hidden guidance (do not reveal)\n${grounded.hiddenGuidance}`,
    grounded.coding?.interviewQuestion &&
      `\n\n## Interview question (drive the conversation off this)\n${grounded.coding.interviewQuestion}`,
  ].filter(Boolean).join("");

  const session = await client.live.connect({
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    config: {
      responseModalities: ["AUDIO", "TEXT"],
      systemInstruction,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voiceName } },
      },
    },
  });
  return wrapSession(session);
}
```

---

## 5. WS Protocol (exhaustive)

All messages are JSON strings over a single WS. No reconnection. Binary frames are not used — image data is base64 inside `screen_frame`.

### 5.1 Client → Server

| `type`                | Shape                                                                                                                                                | Semantics |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| `start_session`       | `{ type, grounded: { upload?:string, externalResearch?:object, customContext?:string, hiddenGuidance?:string, coding?:{ interviewQuestion, language } } }` | First frame only. Opens Gemini Live and sends kickoff prompt. |
| `user_transcript`     | `{ type, role:"User", text:string }`                                                                                                                 | Finalized AssemblyAI chunk. Ignored while muted. |
| `code_snapshot`       | `{ type, snapshot:string, language:string }`                                                                                                         | Coding agent only. Injected as system note. |
| `screen_frame`        | `{ type, data:string, mimeType:"image/jpeg" }`                                                                                                       | Base64 JPEG from canvas sampler. |
| `screen_share_state`  | `{ type, active:boolean, surface?:"monitor"|"window"|"browser" }`                                                                                    | Logged only. |
| `mute`                | `{ type, muted:boolean }`                                                                                                                            | Pauses user-input forwarding. |
| `get_history`         | `{ type }`                                                                                                                                           | Requests full history snapshot. |

### 5.2 Server → Client

| `type`             | Shape                                                       | Semantics |
|--------------------|-------------------------------------------------------------|-----------|
| `transcript`       | `{ type, role:"Agent", text:string }`                       | One per finalized Gemini text chunk. |
| `history`          | `{ type, history: Array<{role:"User"|"Agent", text}> }`     | Response to `get_history`. |
| `transcript_ack`   | `{ type, index:number }`                                    | Increments monotonically for every user/agent append. Client uses for ordering. |
| `error`            | `{ type, message:string }`                                  | Terminal. Client transitions to `error`. |

### 5.3 Example first exchange

```
→ { "type":"start_session","grounded":{ "upload":"Resume text…","externalResearch":{...},"customContext":"Apply for SDE II at Stripe" } }
← { "type":"transcript","role":"Agent","text":"Hi, thanks for joining. Walk me through your background." }
→ { "type":"user_transcript","role":"User","text":"Sure, I've been a backend engineer…" }
← { "type":"transcript","role":"Agent","text":"Tell me about a time you…" }
```

---

## 6. Anam integration

### 6.1 Token issuance flow

```
Browser  ──POST /api/anam-session-token { agentSlug } ──▶  server/anam.js
                                                           │
                                                           │ pickAvatarProfile(agentSlug)
                                                           │ POST https://api.anam.ai/v1/auth/session-token
                                                           │   Authorization: Bearer ${ANAM_API_KEY}
                                                           │   body: { personaConfig: { name, avatarId, voiceDetail: {...} } }
                                                           ▼
Browser  ◀── { sessionToken, avatarProfile } ────────────
   │
   └── new AnamClient({ sessionToken }).stream({ videoEl })
```

### 6.2 Avatar profile pool

```js
const AVATAR_POOL = [
  { name:"Kevin",   avatarId:"<anam-avatar-id-kevin>",   gender:"Male",   voiceName:"Charon"   },
  { name:"Gabriel", avatarId:"<anam-avatar-id-gabriel>", gender:"Male",   voiceName:"Charon"   },
  { name:"Leo",     avatarId:"<anam-avatar-id-leo>",     gender:"Male",   voiceName:"Charon"   },
  { name:"Richard", avatarId:"<anam-avatar-id-richard>", gender:"Male",   voiceName:"Charon"   },
  { name:"Sophie",  avatarId:"<anam-avatar-id-sophie>",  gender:"Female", voiceName:"Aoede"    },
  { name:"Astrid",  avatarId:"<anam-avatar-id-astrid>",  gender:"Female", voiceName:"Autonoe"  },
  { name:"Cara",    avatarId:"<anam-avatar-id-cara>",    gender:"Female", voiceName:"Despina"  },
  { name:"Mia",     avatarId:"<anam-avatar-id-mia>",     gender:"Female", voiceName:"Sulafat"  },
];

function pickAvatarProfile(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_POOL[h % AVATAR_POOL.length];
}
```

Rule: deterministic — same `agentSlug` always resolves to the same profile across sessions.

### 6.3 Voice mapping rule

- `gender === "Male"` → `voiceName = "Charon"`.
- `gender === "Female"` → one of `Aoede | Autonoe | Despina | Sulafat`, fixed per avatar entry above.

---

## 7. AssemblyAI integration

```js
import { AssemblyAI } from "assemblyai";

function useAssemblyAiTranscriber({ stream, muted, onFinal }) {
  // Token exchange: browser cannot hold ASSEMBLYAI_API_KEY directly;
  // a thin `/api/assembly-token` endpoint (owned by this spec) returns a short-lived token.
  // The AssemblyAI SDK opens its own WS against AssemblyAI.
  const clientRef = useRef(null);

  useEffect(() => {
    if (!stream || muted) return;
    let cancelled = false;
    (async () => {
      const { token } = await fetch("/api/assembly-token").then(r => r.json());
      const client = new AssemblyAI({ token });
      const tx = client.realtime.transcriber({ sampleRate: 16000 });
      tx.on("transcript", (t) => {
        if (t.message_type === "FinalTranscript" && t.text) onFinal(t.text);
      });
      await tx.connect();
      tx.streamAudio(stream);                    // sends PCM16 chunks
      if (cancelled) await tx.close();
      clientRef.current = tx;
    })();
    return () => { cancelled = true; clientRef.current?.close(); };
  }, [stream, muted]);
}
```

- Finalization: only `FinalTranscript` events fire `onFinal`. Partials are ignored to avoid flooding Gemini.
- Mute pauses by tearing down and re-creating the transcriber (cheaper than managing pause state in the SDK).

---

## 8. Screen share

- Acquisition: `navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false })`.
- Sampling: a `setInterval` at **500ms** draws `videoEl` → offscreen `<canvas>` at `1280×720`, calls `canvas.toDataURL("image/jpeg", 0.6)`, strips the `data:image/jpeg;base64,` prefix, sends `{ type:"screen_frame", data, mimeType:"image/jpeg" }`.
- Back-pressure: the sampler drops the next tick if the WS `bufferedAmount > 2MB`.
- PiP control surface: a separate hidden `<video>` (1×1 placeholder source, small overlay layer) calls `requestPictureInPicture()` on share start so the user can mute/end without returning to the Spark tab. Teardown on share stop.
- Stop detection: `track.addEventListener("ended", onStop)` covers the browser's native stop bar.

---

## 9. Code editor

```js
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql } from "@codemirror/lang-sql";

const LANG_MAP = {
  javascript: javascript(),
  python:     python(),
  java:       java(),
  cpp:        cpp(),
  sql:        sql(),
  pseudocode: [],   // plain text, no syntax extension
};

<CodeMirror
  value={code}
  height="100%"
  extensions={[LANG_MAP[language]]}
  onChange={(v) => { setCode(v); debouncedSend(v, language); }}
/>
```

- `debouncedSend` uses a 600ms trailing debounce.
- Language picker options = `agent.codingLanguages` (e.g. `["javascript","python","java","cpp","sql","pseudocode"]`), default = `agent.codingLanguages[0]`.
- Question source precedence: `state.agents[slug].researchPrep.result.codingQuestion` → `agent.codingQuestionBank[0]`.

---

## 10. Contract changes

Extends AppProvider state owned by `agents-and-threads`.

### 10.1 Per-agent session runtime

```js
state.agents[slug].session = {
  status: "idle" | "preflight" | "prep" | "live" | "ended" | "error",
  muted: false,
  lastEndedAt: null,           // ISO string
  lastDurationLabel: null,     // "MM:SS"
};
```

### 10.2 Per-session additions

```js
state.sessions[slug][i].transcript = [
  { role: "User" | "Agent", text: string, ts: number }
];

// coding agent only
state.sessions[slug][i].coding = {
  language: "javascript" | "python" | "java" | "cpp" | "sql" | "pseudocode",
  finalCode: string,
  interviewQuestion: string,
};
```

### 10.3 AppProvider API touched

- `appendTranscript(slug, sessionId, entry)` — push to transcript array, keep order.
- `finalizeSession(slug, sessionId, { endedAt, durationLabel, coding? })` — sets `endedAt`, mutates `agents[slug].session`, triggers evaluation auto-effect (implemented by evaluation-engine).

---

## 11. Error handling

| Failure                   | Detection                                      | User-visible                                              | Cleanup                                |
|---------------------------|------------------------------------------------|-----------------------------------------------------------|----------------------------------------|
| Mic denied                | `getUserMedia` rejection                       | Error overlay "Microphone access is required."            | No resources to release.               |
| Research fetch fails      | `/api/agent-external-context` non-2xx          | Toast, continue to `live` with null research              | None.                                  |
| Anam token missing key    | 500 with `ANAM_API_KEY is not configured`      | Error overlay "Avatar service unavailable."               | Release mic.                           |
| Anam stream dies          | Anam client `onError`                          | Error overlay "Lost avatar stream."                       | WS close, mic release, screen stop.    |
| WS closes unexpectedly    | `ws.onclose` before `ended`                    | Error overlay "Connection lost."                          | Mic release, screen stop, Anam stop.   |
| Gemini error              | Server emits `{type:"error"}` or disconnects  | Error overlay with server message                         | Same as WS close.                      |
| Screen share denied       | `getDisplayMedia` rejection                    | Toast "Screen share cancelled." — session continues       | No teardown needed.                    |
| AssemblyAI token fails    | `/api/assembly-token` non-2xx                  | Toast "Transcription unavailable."; session continues with agent voice only | None — retry allowed. |

---

## 12. Testing strategy

Per `tech.md`: no test pyramid. Manual QA flow + smoke scripts.

### 12.1 Manual QA matrix (per agent)

| Agent    | Flow                                                                 |
|----------|----------------------------------------------------------------------|
| recruiter| Create thread → upload resume PDF → paste company URL → start → share screen → have 2-turn exchange → end → verify transcript + screen frames mentioned in agent replies. |
| professor| Start (no research) → have a 2-turn Q&A → end → transcript written. |
| investor | Create thread → paste company site → start → share deck tab → agent asks about slide 3 → end. |
| coding   | Create thread → start → verify interview question renders → write solution in Python → end → `session.coding.finalCode` matches editor, `language === "python"`. |
| custom   | Paste a URL and custom prompt → start → agent reflects the prompt → end. |

Every run: DevTools → Network → confirm WS frames (`transcript`, `user_transcript`), no reconnection loops, Anam video plays within 3s.

### 12.2 Smoke scripts

- `scripts/smoke-anam-token.mjs` — POSTs `/api/anam-session-token` with `{ agentSlug:"recruiter" }` and asserts `sessionToken` and `avatarProfile.voiceName` are present.
- `scripts/smoke-live-ws.mjs` — opens a WS to `ws://localhost:3000/api/live?sessionId=smoke&agentSlug=professor`, sends `start_session` with empty `grounded`, waits up to 15s for at least one `transcript` message, then closes.
- `scripts/smoke-assembly-token.mjs` — GETs `/api/assembly-token`, asserts a short-lived string token is returned.

Exit codes: 0 on success, 1 on failure. Log the full request/response on failure.
