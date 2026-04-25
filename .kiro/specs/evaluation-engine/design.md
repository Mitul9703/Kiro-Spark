# Design — Evaluation Engine

## 1. Overview

The evaluation engine runs after a live session ends. It has two server endpoints, one frontend orchestration path inside `AppProvider`, and two UI cards. Per-session evaluation produces a rubric-scored report with resource briefs; thread evaluation (triggered once ≥2 sessions exist) produces trajectory analysis plus `hiddenGuidance`, an internal string the next live session will silently inject into the agent's system prompt. All Gemini calls go to `gemini-2.5-flash` via `@google/genai` with an explicit structured-JSON instruction; the key-fallback chain is `GEMINI_EVALUATION_API_KEY → GEMINI_API_KEY`.

Everything is stateless on the server. All persistence lives in `AppProvider` → localStorage (`spark-state-v1`).

## 2. Backend architecture — `server/evaluation.js`

### Module shape

```
// server/evaluation.js
import { GoogleGenAI } from '@google/genai';
import { getAgentConfig } from '../lib/agents.js';

export async function evaluateSession(req, res) { ... }
export async function evaluateThread(req, res) { ... }

// Internal helpers
function resolveGeminiKey()          // GEMINI_EVALUATION_API_KEY || GEMINI_API_KEY
function buildSessionPrompt(...)     // string
function buildThreadPrompt(...)      // string
function normalizeSessionResult(raw, agentConfig)   // { score, summary, metrics, ... }
function normalizeThreadResult(raw, agentConfig)    // { summary, trajectory, ... }
function clamp(n, lo, hi)
function safeDefaults(agentConfig)   // { score:0, summary:'', metrics:[...zeros], ... }
```

Both handlers follow the same five-step flow:

1. Validate request shape; 400 on bad input.
2. Resolve the agent config via `getAgentConfig(agentSlug)`.
3. Build the prompt string.
4. Call `ai.models.generateContent({ model:'gemini-2.5-flash', contents:[...], config:{ responseMimeType:'application/json', temperature:0.35 } })`.
5. Parse → normalize → respond. On any exception, respond 200 with safe defaults and an `error` field (Req 1.6).

### Prompt construction — session

````
SYSTEM:
You are Spark's session evaluator. Produce a rigorous, grounded evaluation of
a rehearsal session. Output STRICT JSON matching the schema below. Do not
include any prose outside the JSON.

AGENT EVALUATION PROMPT:
<agentConfig.evaluationPrompt>

RUBRIC (evaluate in this exact order):
1. <criteria[0].label> — <criteria[0].description> (weight: <criteria[0].weight>)
2. <criteria[1].label> — ...
...

UPLOADED CONTEXT:
<upload.contextText or "(none)">

CUSTOM CONTEXT:
<customContext or "(none)">

INTERVIEW QUESTION (coding agent only):
<coding.interviewQuestion.markdown>

FINAL CODE (coding agent only):
```<coding.language>
<coding.finalCode>
````

SESSION METADATA:

- durationLabel: <durationLabel>
- startedAt: <startedAt>
- endedAt: <endedAt>

TRANSCRIPT:
User: <turn 0 text>
Agent: <turn 1 text>
User: <turn 2 text>
...

OUTPUT JSON SCHEMA:
{
"score": <integer 0-100, weighted average of metric values>,
"summary": "<2-4 sentence overall narrative>",
"metrics": [
{ "label": "<exact rubric label>", "value": <0-100>, "justification": "<1-2 sentences grounded in transcript>" },
...one per rubric entry, in rubric order...
],
"strengths": ["<up to 4 short bullets>"],
"improvements": ["<up to 4 short bullets>"],
"recommendations": ["<up to 4 concrete next steps>"],
"resourceBriefs": [
{
"id": "brief-<index>",
"topic": "<short topic tied to the weakest metric>",
"improvement": "<specific skill to build>",
"whyThisMatters": "<1-2 sentences>",
"searchPhrases": ["<3-5 google-style queries>"],
"resourceTypes": ["article","video","exercise"]
}
...between 0 and 4 entries, derived from the TWO lowest-scoring metrics...
]
}

```

### JSON normalization — session

`normalizeSessionResult(raw, agentConfig)` does, in order:

1. Coerce `raw` to an object; if parsing threw, return safe defaults with `error: 'JSON parse failed'`.
2. Build `metrics` by walking `agentConfig.evaluationCriteria` in order, matching by `label` (case-insensitive trim). Missing → `{ label, value:0, justification:'No assessment returned.' }`. Clamp value to [0,100].
3. Recompute the overall `score` as `round( Σ metric.value * criterion.weight / Σ weight )` — this overrides whatever the model returned (Req 6.5).
4. Clamp `strengths`, `improvements`, `recommendations` to the first 4 non-empty strings.
5. Clamp `resourceBriefs` to the first 4 well-formed entries (id/topic/improvement required; other fields coerced to `[]`/`""`).
6. Coerce `summary` to a non-null string.

## 3. Per-agent evaluation prompts

Every agent in `data/agents.json` carries its own `evaluationPrompt` and `evaluationCriteria`. The evaluator reads these verbatim and splices them into the prompt above. The agent config is owned by the `agents-and-threads` spec; here we only document the contract.

### Worked example — Recruiter agent

`data/agents.json["recruiter"].evaluationPrompt` (example value):

> "You are evaluating a candidate's performance in a behavioral recruiter screen. Judge impact stories using STAR-like structure, role fit for the target company, clarity of communication under pressure, and self-awareness about tradeoffs. Penalize vague claims without evidence; reward specific quantitative outcomes."

`data/agents.json["recruiter"].evaluationCriteria` (example):

```

[
{ "label": "Impact & Evidence", "description": "Specific, quantified outcomes.", "weight": 0.30 },
{ "label": "Structured Storytelling", "description": "Clear situation/task/action/result flow.", "weight": 0.25 },
{ "label": "Role Fit & Motivation", "description": "Alignment with target role and company.", "weight": 0.25 },
{ "label": "Communication Poise", "description": "Clarity, concision, composure.", "weight": 0.20 }
]

```

Resulting prompt (abbrev) for a recruiter session about a Stripe loop:

```

AGENT EVALUATION PROMPT:
You are evaluating a candidate's performance in a behavioral recruiter screen...

RUBRIC (evaluate in this exact order):

1. Impact & Evidence — Specific, quantified outcomes. (weight: 0.30)
2. Structured Storytelling — Clear situation/task/action/result flow. (weight: 0.25)
3. Role Fit & Motivation — Alignment with target role and company. (weight: 0.25)
4. Communication Poise — Clarity, concision, composure. (weight: 0.20)

UPLOADED CONTEXT:
(Resume: 4 years at Square on payments reliability; led X; reduced Y by 37%...)

CUSTOM CONTEXT:
Targeting Stripe, Payments Infrastructure team.

TRANSCRIPT:
User: Hi, thanks for taking the time...
Agent: Walk me through a time you had to make a tradeoff...
...

```

Gemini returns JSON; the normalizer recomputes the weighted score as
`0.30*V1 + 0.25*V2 + 0.25*V3 + 0.20*V4` and overwrites whatever Gemini wrote as `score`.

## 4. Score normalization rules

| Scenario | Rule |
|---|---|
| `score` is string numeric (`"82"`) | `Number()` → clamp [0,100] |
| `score` is `NaN`, `null`, missing | Recompute from metrics |
| `score` disagrees with metrics | Always recompute (weighted) |
| `metric.value` missing | `0` |
| `metric.value` negative / > 100 | clamp |
| Model returns extra metrics | discard |
| Model omits a metric | fill with `value:0, justification:'No assessment returned.'` |
| Model reorders metrics | re-sort to rubric order (match by label) |
| `strengths` / `improvements` / `recommendations` > 4 | truncate to first 4 |
| `summary` missing | `""` |
| `resourceBriefs` malformed | drop that brief, keep the rest |

## 5. Thread evaluation

### Trigger

Fires automatically when a session completes and `sessions[slug].filter(s => s.threadId === t.id && s.evaluation.status === 'completed').length >= 2`. Re-fires on every subsequent session completion so `memory.hiddenGuidance` stays current.

### Prompt construction

```

SYSTEM:
You are Spark's thread evaluator. You read N prior session evaluations from a
single user in a single practice thread and produce a trajectory report plus
hidden guidance that will silently steer the next session's live agent. Output
STRICT JSON only.

AGENT: <agentConfig.name> (<agentSlug>)
THREAD: "<thread.title>" (created <thread.createdAt>)

PRIOR SESSIONS (oldest first):
Session 1 — <session.startedAt> — overall <s.evaluation.result.score>
Metrics: - Impact & Evidence: 62 — "vague on Q2 numbers" - Structured Storytelling: 74 — ...
...
Summary: <s.evaluation.result.summary>
Session 2 — ...
...

TASK:
Analyze the trajectory. Produce:

- summary: a 3-5 sentence narrative covering progress.
- trajectory: one of "improving" | "stable" | "declining".
- comments: 2-4 observations about what's shifting.
- strengths: recurring strengths (up to 4).
- focusAreas: recurring weaknesses to attack (up to 4).
- nextSessionFocus: a single sentence telling the user what to rehearse next.
- metricTrends: one row per rubric metric with trend ∈ {improving,stable,declining} and a one-sentence comment.
- hiddenGuidance: ONE paragraph (~4-6 sentences) written as if addressed to the
  next Spark agent persona. It is NEVER shown to the user inside the visible
  summary. It must steer the agent to probe the user's recurring weaknesses
  WITHOUT breaking realism — do not mention "Spark", "evaluation", "previous
  sessions", or "the user's scores". Phrase it as persona guidance, e.g.
  "Push harder on quantitative outcomes when the candidate tells impact
  stories; if they gloss over numbers, ask a pointed follow-up."

OUTPUT JSON SCHEMA:
{
"summary": "...",
"trajectory": "improving",
"comments": ["..."],
"strengths": ["..."],
"focusAreas": ["..."],
"nextSessionFocus": "...",
"metricTrends": [{ "label":"...", "trend":"improving", "comment":"..." }],
"hiddenGuidance": "..."
}

```

### Hidden guidance philosophy

`hiddenGuidance` is steering, not scripting. Three rules are baked into the prompt:

1. **Persona-voice, not meta-voice.** The paragraph reads like notes to a recruiter/professor/etc, not like feedback to the user.
2. **Target recurring weaknesses.** It names the 1-2 rubric metrics that stay low across sessions and tells the agent how to press.
3. **Preserve realism.** It must never mention Spark, prior sessions, scores, or the evaluation system — otherwise the live session breaks the fourth wall.

## 6. Frontend integration — AppProvider

### State shape extensions

Added to the provider owned by `agents-and-threads`:

```

state.sessions[slug][i].evaluation = {
status: 'idle' | 'processing' | 'completed' | 'failed',
startedAt?: number,
completedAt?: number,
failedAt?: number,
result?: { score, summary, metrics, strengths, improvements, recommendations, resourceBriefs },
error?: string
}

state.threads[slug][j].evaluation = { status, startedAt?, completedAt?, failedAt?, result?, error? }

state.threads[slug][j].memory = {
hiddenGuidance: string,
summary: string,
focusAreas: string[],
updatedAt: number
}

```

### Auto-trigger effect

Lives inside `AppProvider`. Runs on every state change but guarded by the job-map so it only fires once per session:

```

useEffect(() => {
for (const slug of Object.keys(state.sessions)) {
for (const s of state.sessions[slug]) {
const key = `evaluation:${s.id}`;
const hasTranscript = Array.isArray(s.transcript) && s.transcript.length > 0;
if (s.evaluation?.status === 'idle' && hasTranscript && !jobs.current.has(key)) {
const ctrl = new AbortController();
jobs.current.set(key, ctrl);
startEvaluation(s.id);
fetch('/api/evaluate-session', { method:'POST', signal:ctrl.signal, body:JSON.stringify({...}), headers:{'content-type':'application/json'} })
.then(r => r.json())
.then(body => {
if (body.error || !body.evaluation) throw new Error(body.error || 'Missing evaluation');
completeEvaluation(s.id, body.evaluation);
maybeAutoTriggerThread(slug, s.threadId);
})
.catch(err => {
if (err.name === 'AbortError') return;
failEvaluation(s.id, err.message);
})
.finally(() => jobs.current.delete(key));
}
}
}
}, [state.sessions]);

```

A twin loop handles `state.threads[slug][j].evaluation.status === 'idle'` with `key = evaluation-thread:${threadId}`.

### Abort on unmount

```

useEffect(() => () => {
for (const ctrl of jobs.current.values()) ctrl.abort();
jobs.current.clear();
}, []);

```

### Status state machine

```

idle ──auto-trigger──▶ processing ──success──▶ completed
│
└──error──▶ failed ──retry button──▶ idle

```

## 7. UI components

### `SessionDetailPage` evaluation card (wireframe)

```

┌──────────────────────────────────────────────────────────────┐
│ [back] Session — Recruiter Loop — 12m 34s — Apr 24, 14:03 │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────┐ Summary │
│ │ 82 │ You delivered clear STAR-style stories... │
│ │ /100 │ (summary paragraph) │
│ └──────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Rubric │
│ Impact & Evidence ██████████░░░ 78 "Strong on Q2"│
│ Structured Storytelling ███████████░░ 84 "..." │
│ Role Fit & Motivation ████████████░ 86 "..." │
│ Communication Poise ███████████░░ 80 "..." │
├──────────────────────────────────────────────────────────────┤
│ Strengths │ Improvements │ Recommendations │
│ • ... │ • ... │ • ... │
│ • ... │ • ... │ • ... │
├──────────────────────────────────────────────────────────────┤
│ Resource briefs │
│ [card: Quantifying impact] [card: Handling tradeoffs] │
├──────────────────────────────────────────────────────────────┤
│ Transcript (scrollable) │
│ User: Hi, thanks for taking... │
│ Agent: Walk me through a time... │
└──────────────────────────────────────────────────────────────┘

```

Processing state swaps the score card for a centered spinner + "Generating evaluation…". Failed state swaps it for an error banner + "Retry evaluation" button.

### `ThreadDetailPage` evaluation card (wireframe)

```

┌──────────────────────────────────────────────────────────────┐
│ Thread progress — 3 sessions │
│ Trajectory: [improving] │
│ Summary: Across three sessions you've tightened your... │
├──────────────────────────────────────────────────────────────┤
│ Metric trends │
│ Impact & Evidence ▲ improving "Numbers sharper" │
│ Structured Storytelling ■ stable "Flow consistent" │
│ Role Fit & Motivation ▲ improving "..." │
│ Communication Poise ▼ declining "Faster = less poise"│
├──────────────────────────────────────────────────────────────┤
│ Recurring strengths │ Focus areas │
│ • ... │ • ... │
├──────────────────────────────────────────────────────────────┤
│ Next session focus: "Rehearse one impact story..." │
├──────────────────────────────────────────────────────────────┤
│ ▸ Hidden memory — used to steer next session [collapsed] │
└──────────────────────────────────────────────────────────────┘

```

Expanding the `<details>` reveals `memory.hiddenGuidance` with an "internal — not shown to user during session" label.

## 8. Contract changes

### Additions to `AppProvider` state

Owned by `agents-and-threads`, extended here:

```

state.sessions[slug][i].evaluation // see §6
state.threads[slug][j].evaluation // see §6
state.threads[slug][j].memory // see §6

```

### New mutators on `useAppActions()`

```

startEvaluation(sessionId)
completeEvaluation(sessionId, result)
failEvaluation(sessionId, errorMessage)

startThreadEvaluation(threadId)
completeThreadEvaluation(threadId, result)
failThreadEvaluation(threadId, errorMessage)

applyThreadMemory(threadId, { hiddenGuidance, summary, focusAreas })
retryEvaluation(sessionId) // sets status back to 'idle'
retryThreadEvaluation(threadId) // sets status back to 'idle'

```

Each mutator produces an immutable state update and the existing debounced localStorage sync handles persistence.

### New endpoints

```

POST /api/evaluate-session
POST /api/evaluate-thread

```

Both registered in `server.js`:

```

import { evaluateSession, evaluateThread } from './server/evaluation.js';
app.post('/api/evaluate-session', evaluateSession);
app.post('/api/evaluate-thread', evaluateThread);

```

## 9. Error handling

| Failure mode | Server response | Client behavior |
|---|---|---|
| Unknown `agentSlug` | 400 `{ error }` | `failEvaluation` with message |
| Missing Gemini key | 200 safe defaults + `error:'No Gemini API key'` | `failEvaluation` |
| Gemini throws (network, quota) | 200 safe defaults + `error:<e.message>` | `failEvaluation` |
| Gemini returns non-JSON | 200 safe defaults + `error:'JSON parse failed'` | `failEvaluation` |
| Gemini returns JSON missing fields | 200 with fields filled by `safeDefaults` merge | normal `completeEvaluation` |
| Thread evaluation with <2 sessions | 400 `{ error }` | auto-trigger guard prevents this; if user forces, failure shown |
| Browser fetch aborted (unmount) | — | caught as `AbortError`, no state change |
| Browser fetch rejected | — | `failEvaluation` |

Retry is always manual after `failed`. No automatic exponential backoff — the user clicks "Retry" which flips status to `idle` and re-enters auto-trigger.

## 10. Testing strategy

### Manual flow

1. Boot the app, load the recruiter agent, create a thread, attach a PDF, type custom context.
2. Start a session, speak for ~2 minutes (covers transcript population from the `live-session` spec).
3. End the session. Observe `session.evaluation.status` cycle `idle → processing → completed` within ~30s.
4. Open the session detail page. Verify score card, rubric bars, columns, resource briefs, transcript.
5. Start a second session, end it. Observe `thread.evaluation.status` cycle likewise and verify the thread card + hidden memory disclosure.
6. Induce a failure (disconnect network mid-eval). Observe `failed` state and click retry.

### Smoke scripts

`scripts/smoke-evaluate-session.mjs`:

```

#!/usr/bin/env node
import 'dotenv/config';
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const body = {
agentSlug: 'recruiter',
transcript: [
{ role: 'agent', text: 'Walk me through a recent impact story.' },
{ role: 'user', text: 'Last quarter I led a migration that cut p99 latency by 37%...' },
{ role: 'agent', text: 'What was the tradeoff?' },
{ role: 'user', text: 'We delayed the dashboard revamp by two weeks...' }
],
customContext: 'Targeting Stripe, Payments Infra.',
durationLabel: '4m 12s',
startedAt: Date.now() - 4\*60_000,
endedAt: Date.now()
};
const r = await fetch(`${BASE}/api/evaluate-session`, {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify(body)
});
if (!r.ok) { console.error('HTTP', r.status); process.exit(1); }
const json = await r.json();
if (!json.evaluation) { console.error('missing evaluation', json); process.exit(1); }
console.log(JSON.stringify(json.evaluation, null, 2));

```

`scripts/smoke-evaluate-thread.mjs` posts two pre-evaluated fixture sessions (with mock `evaluation.result` blocks) and asserts the response contains `threadEvaluation.hiddenGuidance` as a non-empty string.

Both scripts are runnable via `node scripts/smoke-evaluate-session.mjs` with `GEMINI_API_KEY` (or `GEMINI_EVALUATION_API_KEY`) set in the environment.
```
