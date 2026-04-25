# API Reference

Live HTTP and WebSocket surface served from `server.js`. All routes live on the same Node process that also hosts Next.js — there is no separate API service.

Contracts below match the canonical implementation on `origin/main`. Every endpoint returns JSON; on failure an `{error, details?}` shape with a 4xx/5xx status. Successful responses always include `ok: true` (except `GET /api/health`).

## Required environment

| Var | Used by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | every Gemini-backed route | Fallback for the per-task keys below |
| `GEMINI_LIVE_API_KEY` | `WS /api/live` | Falls back to `GEMINI_API_KEY` |
| `GEMINI_EVALUATION_API_KEY` | `/api/evaluate-session`, `/api/evaluate-thread`, `/api/compare-sessions` | Fallback as above |
| `GEMINI_RESOURCE_CURATION_API_KEY` | `/api/session-resources` | Fallback as above |
| `GEMINI_UPLOAD_PREP_API_KEY` | `/api/upload-deck` | Fallback as above |
| `GEMINI_QUESTION_FINDER_API_KEY` | coding-agent research path | Fallback as above |
| `ANAM_API_KEY` | `/api/anam-session-token` | No fallback — route returns 500 if missing |
| `ASSEMBLYAI_API_KEY` | `WS /api/live` server-side mic transcription | No fallback |
| `FIRECRAWL_API_KEY` | `/api/agent-external-context`, `/api/session-resources` | `/api/session-resources` returns 400 if missing; external-context returns `research:null` |

## Routes

### `GET /api/health`

Liveness probe.

```http
GET /api/health
```

```json
{ "ok": true, "hasDeck": false }
```

---

### `POST /api/anam-session-token`

Issues a short-lived Anam session token plus the chosen avatar profile (random per call). The browser passes the token to `@anam-ai/js-sdk` to render the avatar with audio passthrough lip-sync.

```http
POST /api/anam-session-token
Content-Type: application/json

{ "agentSlug": "recruiter" }
```

```json
{
  "ok": true,
  "sessionToken": "...",
  "avatarProfile": {
    "name": "Sophie",
    "avatarId": "6dbc1e47-7768-403e-878a-94d7fcc3677b",
    "gender": "Female",
    "voiceName": "Aoede"
  }
}
```

Errors: `500` if `ANAM_API_KEY` missing or Anam upstream rejects.

---

### `POST /api/upload-deck`

Multipart upload of a PDF. The route runs `pdf-parse` server-side, then sends the raw text through Gemini for cleanup and returns the cleaned context for use as session grounding.

```http
POST /api/upload-deck
Content-Type: multipart/form-data; boundary=...

--...
Content-Disposition: form-data; name="deck"; filename="resume.pdf"
Content-Type: application/pdf

<binary>
```

```json
{
  "ok": true,
  "fileName": "resume.pdf",
  "contextPreview": "<first 1000 chars>",
  "contextText": "<cleaned full text>"
}
```

Errors: `400` (no file, empty extraction), `500` (Gemini cleanup failure, parse failure).

---

### `POST /api/agent-external-context`

Pre-session research. For non-`professor` agents with a usable `companyUrl`, runs a LangChain ReAct-style pipeline backed by Firecrawl search/scrape and Gemini synthesis. Returns markdown research plus, for the coding agent, a candidate interview question.

```http
POST /api/agent-external-context
Content-Type: application/json

{
  "agentSlug": "recruiter",
  "companyUrl": "https://stripe.com",
  "customContext": "Specifically interested in payments infrastructure roles.",
  "upload": { "contextText": "..." }
}
```

```json
{
  "ok": true,
  "research": {
    "markdown": "# Stripe — recruiter brief\n...",
    "sourceUrl": "https://stripe.com",
    "companyName": "Stripe",
    "codingQuestion": null
  },
  "message": "External research fetched."
}
```

Special cases:
- `agentSlug === "professor"` → returns `{ research: null, message: "Professor agent does not use external research." }`.
- Missing/invalid `companyUrl` → returns `{ research: null, message: "No valid company URL was provided." }`.
- Missing `FIRECRAWL_API_KEY` → returns `research: null` with a message; never 5xx.
- For `coding`, `research.codingQuestion = { title, markdown, companyName, sourceUrl }`.

Errors: `500` for unexpected failures.

---

### `POST /api/evaluate-session`

Runs Gemini structured-JSON evaluation against the agent's per-agent rubric. Server normalizes the result: clamps each score to `[0, 100]`, reorders metrics to match the agent's `evaluationCriteria`, slices arrays to ≤4, and renames metric `score` → `value`.

```http
POST /api/evaluate-session
Content-Type: application/json

{
  "agentSlug": "recruiter",
  "transcript": [
    { "role": "Agent", "text": "Walk me through your most recent project." },
    { "role": "User",  "text": "I led a team of three on a payments redesign..." }
  ],
  "upload":        { "contextText": "..." } | null,
  "coding":        { "language": "Python", "finalCode": "...", "interviewQuestion": { "markdown": "..." } } | null,
  "customContext": "",
  "durationLabel": "04:12",
  "startedAt":     "2026-04-24T17:00:00.000Z",
  "endedAt":       "2026-04-24T17:04:12.000Z"
}
```

```json
{
  "ok": true,
  "evaluation": {
    "score": 78,
    "summary": "...",
    "metrics": [
      { "label": "Communication clarity", "value": 82, "justification": "..." },
      { "label": "Impact storytelling",   "value": 74, "justification": "..." },
      { "label": "Ownership signals",     "value": 70, "justification": "..." },
      { "label": "Role fit",              "value": 80, "justification": "..." }
    ],
    "strengths":       ["...", "...", "...", "..."],
    "improvements":    ["...", "...", "...", "..."],
    "recommendations": ["...", "...", "...", "..."],
    "resourceBriefs":  [
      { "id": "brief-1", "topic": "...", "improvement": "...", "whyThisMatters": "...", "searchPhrases": ["..."], "resourceTypes": ["..."] }
    ]
  }
}
```

Note: metric scores are returned under `value` (server-renamed from the model's `score` field).

Errors: `400` (no transcript), `500` (Gemini failure or JSON parse error).

---

### `POST /api/session-resources`

For each `resourceBrief` returned by the evaluator, runs Firecrawl search → optional scrape → Gemini curation, returning up to 4 ranked items per brief.

```http
POST /api/session-resources
Content-Type: application/json

{
  "agentSlug": "recruiter",
  "resourceBriefs": [
    { "id": "brief-1", "topic": "...", "improvement": "...", "whyThisMatters": "...", "searchPhrases": ["..."], "resourceTypes": ["youtube", "article"] }
  ]
}
```

```json
{
  "ok": true,
  "topics": [
    {
      "id": "brief-1",
      "topic": "...",
      "improvement": "...",
      "whyThisMatters": "...",
      "items": [
        { "title": "...", "url": "https://...", "type": "video", "source": "youtube.com", "reason_relevant": "..." }
      ]
    }
  ]
}
```

Errors: `400` if `FIRECRAWL_API_KEY` is missing. The route accepts at most 2 briefs (extras silently dropped) and at most 4 items per brief.

---

### `POST /api/evaluate-thread`

Longitudinal analysis across all completed sessions in a thread. Uses Gemini structured JSON with a recency-weighted prompt and produces a trajectory report plus internal-only `hiddenGuidance` consumed by the next live session's system instruction.

```http
POST /api/evaluate-thread
Content-Type: application/json

{
  "agentSlug": "recruiter",
  "thread":   { "id": "thread-...", "title": "...", "createdAt": "...", "updatedAt": "..." },
  "sessions": [
    {
      "id":            "sess-A",
      "sessionName":   "...",
      "startedAt":     "...",
      "endedAt":       "...",
      "durationLabel": "10:00",
      "evaluation":    { "score": 72, "summary": "...", "metrics": [...], "strengths": [...], "improvements": [...] }
    }
  ]
}
```

The server reads `session.evaluation.{score, summary, metrics, strengths, improvements}` directly (NOT nested under `.result`).

```json
{
  "ok": true,
  "threadEvaluation": {
    "summary": "...",
    "trajectory": "improving",
    "comments": ["..."],
    "strengths": ["..."],
    "focusAreas": ["..."],
    "nextSessionFocus": "...",
    "metricTrends": [
      { "label": "Communication clarity", "trend": "improving", "comment": "..." }
    ],
    "hiddenGuidance": "<paragraph for next session's system instruction; never user-facing>"
  }
}
```

Errors: `400` if no sessions, `500` on Gemini parse failure.

---

### `POST /api/compare-sessions`

Two-session diff with mechanical metric deltas plus Gemini-generated per-metric insights.

```http
POST /api/compare-sessions
Content-Type: application/json

{
  "agentSlug": "recruiter",
  "currentSession":  { "id": "...", "endedAt": "...", "durationLabel": "...", "evaluation": { "score": 82, "summary": "...", "metrics": [...] } },
  "baselineSession": { "id": "...", "endedAt": "...", "durationLabel": "...", "evaluation": { "score": 64, "summary": "...", "metrics": [...] } }
}
```

The server reads `session.evaluation.{score, metrics, summary}` directly.

```json
{
  "ok": true,
  "comparison": {
    "trend": "improved",
    "summary": "...",
    "metrics": [
      {
        "label": "Communication clarity",
        "currentValue": 82,
        "baselineValue": 64,
        "delta": 18,
        "trend": "improved",
        "insight": "..."
      }
    ]
  }
}
```

Trend rules (mechanical): `delta > 4` → `improved`, `delta < -4` → `declined`, otherwise `similar`. Overall `trend` ∈ `improved | mixed | similar | declined`.

Errors: `400` if either evaluation is missing, `500` on Gemini failure.

---

## WebSocket: `WS /api/live`

Real-time bridge for the live session. The client opens a single connection per session.

URL: `ws://<host>/api/live?agent=<agentSlug>&voice=<voiceName>`

The server creates a per-connection Gemini Live session (model `gemini-2.5-flash-native-audio-preview-12-2025`) with the voice from the chosen Anam profile, plus a server-side AssemblyAI realtime transcriber for the user mic. Audio is bidirectional; transcripts are emitted as text.

### Client → server

| Type | Purpose |
|---|---|
| `session_context` | Initial grounding payload — composed system instruction (agent prompt + custom context + thread hidden guidance + research + upload context + screen-share instruction). Must be sent first. |
| `user_audio` | Binary 16 kHz PCM frames from the mic |
| `screen_frame` | Base64 JPEG snapshot during screen share |
| `screen_share_state` | `{ active, surface }` toggle |
| `code_snapshot` | `{ snapshot, language }` debounced editor content |
| `end_session` | User-initiated close |
| `get_history` | Request the in-memory transcript dump |
| `save_model_text` | Append a model-text chunk to the bridge's history (used for client-derived persistence) |

### Server → client

| Type | Purpose |
|---|---|
| `status` | Lifecycle hint (`connecting`, `live`, etc.) |
| `model_text` | Final agent text chunk for the transcript log |
| `user_transcription` | Final user-mic transcript chunk from AssemblyAI |
| `audio_chunk` | Base64 PCM audio frames forwarded from Gemini Live (the Anam SDK consumes these for lip-sync) |
| `turn_complete` | Boundary marker after a model turn |
| `live_closed` | Session has ended; close the WS |
| `history` | Reply to `get_history` |
| `error` | Anything that went wrong; payload is `{ message }` |

The bridge has no auto-reconnect — a dropped WS ends the session and the client transitions to the post-session evaluation flow.

---

## Smoke scripts

Per-endpoint smoke under `scripts/`:

```bash
node scripts/smoke-evaluate-session.mjs
node scripts/smoke-evaluate-thread.mjs
node scripts/smoke-compare-sessions.mjs
node scripts/smoke-session-resources.mjs
node scripts/smoke-upload-deck.mjs
node scripts/smoke-firecrawl.mjs
node scripts/smoke-all.mjs   # runs all of the above in parallel
```

Each script targets `http://localhost:3000` by default; override with `SPARK_HTTP_URL=http://host:port`.
