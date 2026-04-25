# SimCoach

**Kiro Spark Challenge · Education track · The "Agency" Guardrail**

A live rehearsal venue for the moments where a person has to perform — a thesis defense, a recruiter screen, an investor pitch, a coding interview. One Next.js app, a streaming voice-and-video pipeline, panels of AI personas built to behave like real audiences, and a structured post-session evaluation that points at exactly which sentence to fix.

The AI never writes the pitch, the answer, or the code. It is the room the learner walks into so the version of them that walks out is sharper.

---

## Why this exists

The Education frame for this hackathon calls for the **Agency Guardrail**: the AI must be the scaffolding, not the solution. It must empower a learner to do something they couldn't do before, *without doing it for them*.

Most AI study tools collapse the gap between "the learner doesn't know" and "here is the answer," which short-circuits the part of learning where agency actually grows — saying the thing out loud, getting pushed back on, finding the missing word, trying again. SimCoach is a literal scaffold. The user does the talking, the user writes the code, the user defends the thesis. The AI is the audience that asks the next question and the rubric that says *the third sentence of your answer was vague — here is the moment, here is why*.

---

## The idea: a venue, not a chatbot

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Professor│   │ Recruiter│   │ Investor │   │ Investor │   │  Coding  │   │  Custom  │
│  Panel   │   │   Loop   │   │   Room   │   │  Panel   │   │  Round   │   │  Agent   │
└────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘
     │              │              │              │              │              │
     └──────────────┴──────────────┴──────┬───────┴──────────────┴──────────────┘
                                          │
                          one runtime, one rubric pipeline,
                          one set of grounding rules
```

| Room | Who it simulates | What it teaches |
| ---- | ---------------- | --------------- |
| **Professor Panel** | A skeptical-but-fair faculty reviewer | Defending a thesis, capstone, or research with structure and evidence |
| **Recruiter Loop** | A first-round recruiter screen | Behavioral storytelling, role fit, impact framing |
| **Investor Room** | A single seed-stage investor | Market logic, traction, conviction under pushback |
| **Investor Panel** | Three personas at once — a Believer, a Skeptic, an Operator — who interrupt and disagree with *each other* | Multi-stakeholder persuasion, panel composure |
| **Coding Round** | A measured technical interviewer | Think-aloud reasoning, complexity, code communication |
| **Custom Agent** | A general audience tuned by your context | Demos, oral exams, leadership updates |

---

## System overview

```
                    ┌─────────────────────────────────────┐
                    │   localStorage (simcoach-state-v1)  │
                    │   threads · sessions · evaluations  │
                    │   thread.memory.hiddenGuidance      │
                    └─────────────────┬───────────────────┘
                                      │
                                      ▼
                          ┌─────────────────────┐
                          │  Next.js 15 App     │
                          │  /atrium  lobby     │
                          │  /agents  catalog   │
                          │  /stage   pre-room  │
                          │  /theater live room │
                          │  /session results   │
                          └──────────┬──────────┘
                                     │
                                     ▼
                  ┌──────────────────────────────────┐
                  │  Express + ws  (server.js)       │
                  │  /api/*   HTTP routes            │
                  │  /api/live  WebSocket bridge     │
                  └────┬────────────┬────────────────┘
                       │            │
                       ▼            ▼
   ┌──────────────────────┐    ┌────────────────────────────┐
   │ Pre-session grounding│    │ Live session pipeline      │
   │  pdf-parse           │    │  Gemini 2.5 Flash native   │
   │  Gemini cleanup      │    │      audio (voice in/out)  │
   │  Firecrawl + Gemini  │    │  AssemblyAI (mic STT)      │
   │  ReAct (LangChain)   │    │  Anam.ai (avatar lip-sync) │
   │  Question finder     │    │  Screen-share frames       │
   └──────────────────────┘    │  CodeMirror (coding round) │
                               └────────────────────────────┘
                       │            │
                       └─────┬──────┘
                             ▼
                  ┌─────────────────────────┐
                  │ Post-session pipeline   │
                  │  Gemini 2.5 Flash eval  │
                  │  Gemini compare         │
                  │  Gemini thread review   │
                  │  Firecrawl curation     │
                  └─────────────────────────┘
```

One Node process hosts both the Next.js frontend and the entire `/api/*` surface plus the WebSocket bridge. State lives client-side in `localStorage` under `simcoach-state-v1` — no backend database, no auth.

---

## A session, technically

### 1. Grounding before a single word is spoken

Before the agent talks, the learner can attach material:

- **PDF.** `pdf-parse` extracts the text on the server, then a `gemini-2.5-flash` cleanup pass removes layout artifacts and returns a usable context block.
- **Company URL.** A LangChain ReAct agent backed by `@langchain/google-genai` and Firecrawl search/scrape produces a markdown research brief. For the Coding Round it also mines a candidate interview question matched to the company's stack.
- **Free-form notes** (rubric expectations, audience profile, role spec).

All three are folded into the agent's system prompt as grounding. Every prompt in `data/agents.js` constrains the agent to *only* ask about claims, projects, methods, or screen elements explicitly present in this context, the live conversation, or the visible screen. Inventing experiences, metrics, or hidden UI state is forbidden.

### 2. Live session

`/api/anam-session-token` issues an Anam token with a randomly-chosen avatar profile. A WebSocket opens at `/api/live` and the server bridges three streams in parallel:

```
  microphone ─────────────► AssemblyAI streaming STT ─► on-screen transcript
  microphone + screen frames ─► gemini-2.5-flash-native-audio-preview-12-2025
                                              │
                              spoken audio out ▼
                                              Anam.ai (lip-sync) ─► avatar tile
```

The Coding Round overlays a CodeMirror 6 editor with packs for JavaScript, Python, Java, C++, and SQL. Code snapshots stream into the model's context so the interviewer can probe *the candidate's code* — but the prompt forbids reading code aloud, quoting it back, or replying with code blocks. The interviewer asks *why this data structure*, not *here is the data structure to use*.

### 3. Investor Panel: three streams, one room

Investor Panel runs three concurrent Anam streams against three independent Gemini Live sessions, one per persona (Believer, Skeptic, Operator). Each persona prompt ends every turn with exactly one tag:

```
  [PASS]                  → the founder should respond next
  [FOLLOW-UP: <name>]     → another persona jumps in
```

The server arbitrates whose stream goes hot next on those tags. Personas reference each other by name, agree, disagree, and build on each other; no role labels leak through. `ANAM_API_KEYS` is a comma-separated list so the three avatars can render in parallel without rate-limiting each other.

### 4. Post-session evaluation

`End session` triggers three Gemini passes against the structured JSON schemas defined in `server.js`:

| Pass | Endpoint | Output |
| ---- | -------- | ------ |
| Per-session evaluation | `/api/evaluate-session` | Score, per-rubric metric scores **with justifications grounded in transcript moments**, strengths, improvements, recommendations, resource briefs |
| Resource curation | `/api/session-resources` | Firecrawl-discovered articles, talks, and exemplars matched to the weak rubric dimensions |
| Thread-level review | `/api/evaluate-thread` | Trend analysis across all sessions in the thread; writes `thread.memory.hiddenGuidance` for the next session |

A separate route, `/api/compare-sessions`, lets the learner pick a baseline session and ask Gemini to diff the two: what improved, what regressed, what stayed flat.

The evaluator system prompt requires every justification to cite a real moment from the transcript. Generic praise is rejected; specific criticism is rewarded. The output never tells the learner *what to say* — only what to fix.

### 5. Hidden guidance, not visible nagging

Thread-level review writes its conclusions into `thread.memory.hiddenGuidance`, which is folded into the *next* session's system prompt. The next agent asks sharper follow-ups in the learner's weak areas. The learner experiences a tougher audience, not a feedback list with arrows.

---

## What's interesting under the hood

- **One process, three transports.** A single Node entry point (`server.js`) serves Next.js HTML, REST `/api/*`, and the `/api/live` WebSocket. Hot reload covers the React tree; server changes restart the whole process.
- **Three concurrent avatars in one tab.** Three Anam streams plus three Gemini Live sessions, arbitrated by tagged turn terminators emitted by each persona prompt. The personas reference each other by name and the prompt forbids any role-label leakage.
- **Screen-share as passive context, not action surface.** Frames flow into Gemini as visual grounding. Every system prompt explicitly forbids the agent from claiming to click, navigate, or read hidden DOM. The AI can only react to what is visibly on screen.
- **Per-task Gemini keys.** Each Gemini-backed route reads its own optional key (`GEMINI_LIVE_API_KEY`, `GEMINI_EVALUATION_API_KEY`, `GEMINI_RESOURCE_CURATION_API_KEY`, `GEMINI_UPLOAD_PREP_API_KEY`, `GEMINI_QUESTION_FINDER_API_KEY`) with a single `GEMINI_API_KEY` fallback. Lets us isolate quota and cost per pipeline stage without forking code.
- **Structured output as the rubric contract.** Every evaluation, comparison, and resource pass is constrained to a JSON schema. Per-rubric metrics, justifications, and resource briefs are typed rows, not free-form prose. Rendering never runs raw model text through the UI.
- **Spec-driven with Kiro IDE.** Every feature lives as a `.kiro/specs/<feature>/{requirements,design,tasks}.md` triplet — `agents-and-threads`, `evaluation-engine`, `live-session`, `research-and-resources`, `session-comparison`, `sim-coach` — alongside `.kiro/steering/{product,tech,structure}.md`. We used Kiro for every feature, not just a token spec.
- **The Agency Guardrail is enforced in prompts, not docs.** The Coding Round system prompt literally says *"never read code aloud, never quote code verbatim, never answer with code blocks, markdown fences, or line-by-line code narration."* The grounding rules across every agent forbid invention. The evaluator returns moments-and-resources, not rewrites. The guardrail is load-bearing source code.

---

## Tech stack

| Layer | Choice |
| ----- | ------ |
| IDE | **Kiro IDE** (spec-driven, `.kiro/specs/*`, `.kiro/steering/*`) |
| Framework | Next.js 15 App Router, React 19 |
| Server | Express 5 mounted under a Next.js custom server, `ws` for `/api/live` |
| Live audio (in + out) | `gemini-2.5-flash-native-audio-preview-12-2025` via `@google/genai` |
| Avatar | Anam.ai (`@anam-ai/js-sdk`), audio passthrough lip-sync |
| Mic transcription | AssemblyAI streaming STT |
| Evaluation, comparison, resource curation, PDF cleanup, question finder | `gemini-2.5-flash` with structured `responseSchema` |
| External research | Firecrawl + LangChain ReAct agent (`langchain`, `@langchain/google-genai`) |
| PDF ingestion | `pdf-parse` + Gemini cleanup |
| Code editor | CodeMirror 6 with JavaScript, Python, Java, C++, SQL packs |
| 3D / motion | `@react-three/fiber`, `@react-three/drei`, `motion` |
| UI primitives | Radix UI, Tailwind 4, `class-variance-authority`, `lucide-react` |
| State | `localStorage` under `simcoach-state-v1` |

---

## Competing across the four signals

The Kiro Spark Challenge scores submissions on four prize signals: **Build, Collaboration, Impact, Story.** Here is how SimCoach is positioned against each.

### Build

A working live-voice pipeline is hard to fake: Gemini Live native audio, AssemblyAI streaming STT, Anam avatar lip-sync, and screen-share frames all running through one WebSocket against one Node process. Six rooms ship with full system prompts, per-room rubrics, and grounding rules. The Investor Panel runs three concurrent avatars with tag-based turn arbitration — substantially harder than a single chat agent. Every Gemini-backed endpoint uses structured JSON schemas, so the UI never renders raw model output.

### Collaboration

The Investor Panel is collaboration on the AI side: three personas with distinct agendas reacting to each other in real time, not a chorus. The development side is collaboration with **Kiro IDE**: every feature lives as a `requirements.md`, `design.md`, `tasks.md` triplet under `.kiro/specs/`, plus product/tech/structure steering docs. Specs and source ship together; the spec is the contract.

### Impact

The Education frame asks for impact through **agency**, not automation. SimCoach measures itself by the gap between sessions in a thread, not by whether the AI produced anything. A learner can rehearse a defense five times, see specific moments improve in the comparison view, and walk into the real room with concrete feedback they earned themselves. The product is unusable as a homework cheat — and that is the point. Drop-in scenarios: capstone defenses, internship interview prep, demo-day rehearsals, oral exams, conference talks.

### Story

The story is in the rooms. A first-time founder facing three investors who interrupt each other. A grad student watching a faculty reviewer probe an assumption they hadn't named yet. A new grad whose Coding Round interviewer asks *why* their data structure choice — not *here is the right one*. The narrative every learner walks out with is *I got better at this thing*, not *the AI did this thing for me*.

---

## Repository layout

```
app/                    Next.js App Router
  agents/               Agent catalog and per-agent thread page
  atrium/               Lobby venue (feature-flagged via NEXT_PUBLIC_ATRIUM)
  stage/                Pre-session staging room
  theater/              Live session room
  session/              Post-session results
components/
  atrium/ stage/ theater/ cockpit/ lobby/   Venue components
  primitives/                                Reusable design atoms
  ui/                                        Radix-backed primitives
data/agents.js          The full agent catalog — prompts, rubrics, panel personas
lib/                    agents, motion, icons, client config, stage helpers
server.js               Express + Next + ws bootstrap, every /api/* handler
.kiro/
  specs/<feature>/      requirements.md · design.md · tasks.md per feature
  steering/             product.md · tech.md · structure.md
docs/
  api.md                Live HTTP and WebSocket contract
  dev.md                Local development quickstart
scripts/                Per-endpoint smoke tests
```
