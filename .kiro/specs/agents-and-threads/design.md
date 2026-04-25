# Design — agents-and-threads

## 1. Overview

This feature is the skeleton of Spark. It owns the public-facing marketing surface (`/`), the agent directory (`/agents`), the agent detail page (`/agents/[slug]`), and the thread workspace (`/agents/[slug]/threads/[threadId]`). It also defines and exports the canonical client state machine (`AppProvider`), the shared visual chrome (`Shell`), the theme system in `app/globals.css`, and the five-agent catalog in `data/agents.json`. Every other Spark spec — `live-session`, `evaluation-engine`, `research-and-resources`, `session-comparison` — extends slices of the state shape declared here but does not redefine the top-level contract.

The feature is greenfield, client-heavy, and has no server dependency of its own: the server is only reached once a user clicks "Start session", which is out of scope for this spec.

## 2. Architecture

```
                            ┌───────────────────────────┐
                            │      app/layout.js        │
                            │   (mounts AppProvider)    │
                            └─────────────┬─────────────┘
                                          │
                            ┌─────────────▼─────────────┐
                            │       AppProvider         │
                            │  - state (useReducer)     │
                            │  - localStorage mirror    │
                            │  - exposes hooks          │
                            │     useAppState()         │
                            │     useAppActions()       │
                            └─────────────┬─────────────┘
                                          │
            ┌─────────────┬────────────────┼───────────────┬────────────────┐
            │             │                │               │                │
     ┌──────▼─────┐ ┌─────▼──────┐ ┌───────▼──────┐ ┌──────▼───────┐ ┌──────▼─────┐
     │LandingPage │ │ AgentsPage │ │AgentDetailPg │ │ThreadDetailPg│ │  SessionPg │
     │  app/page  │ │app/agents/ │ │app/agents/   │ │app/agents/   │ │ (out of    │
     │            │ │   page     │ │   [slug]/    │ │   [slug]/    │ │  scope)    │
     │            │ │            │ │    page      │ │  threads/..  │ │            │
     └──────┬─────┘ └─────┬──────┘ └───────┬──────┘ └──────┬───────┘ └──────┬─────┘
            │             │                │               │                │
            └─────────────┴────────────────┼───────────────┴────────────────┘
                                           │
                                 ┌─────────▼──────────┐
                                 │       Shell        │
                                 │  header + toasts   │
                                 └────────────────────┘

                          Shared libraries:
                           lib/agents.js   → slug lookup, re-exports data/agents.json
                           lib/ids.js      → generateId(type)
                           lib/format.js   → formatDuration, formatDateTime
```

The provider is mounted once at the root layout. Every page reads state via `useAppState()` and writes via `useAppActions()`; no page calls `localStorage` directly. The `Shell` component renders the global chrome and wraps `children` — each page returns `<Shell>…</Shell>`.

## 3. Components and Interfaces

### `AppProvider` — `components/app-provider.js`

- **Purpose:** Single top-level state container. Owns the canonical shape, the reducer, the localStorage sync effect, and the hooks the rest of the app consumes.
- **Props:** `{ children }`.
- **Key behaviors:**
  - Uses `useReducer(reducer, defaultState, lazyInit)` where `lazyInit` returns the merge of `defaultState` and any valid persisted snapshot.
  - Defines an action-type enum and a single reducer switch (`SET_THEME`, `PUSH_TOAST`, `DISMISS_TOAST`, `PATCH_AGENT`, `CREATE_THREAD`, `DELETE_THREAD`, `PATCH_THREAD`, `CREATE_SESSION`, `DELETE_SESSION`, `PATCH_SESSION`, `APPEND_TRANSCRIPT`, `HYDRATE`).
  - Wraps each mutator as a stable callback and memoizes the action bag with `useMemo`.
  - Runs a debounced (200 ms) `useEffect` that writes `JSON.stringify(state)` to `localStorage.setItem('spark-state-v1', …)`.
  - Runs a `useEffect` that sets `document.documentElement.dataset.theme = state.theme`.
  - Reserves refs for future specs: `jobsRef = useRef(new Map())` (jobKey → AbortController) and `autoTriggerRef = useRef(new Set())`. These refs are declared here so other specs can attach without restructuring.

### `Shell` — `components/shell.js`

- **Purpose:** Consistent header + toast host + content frame.
- **Props:** `{ children }`.
- **Key behaviors:**
  - Renders `<header>` with the "Spark" brand linking to `/` and a theme toggle button that calls `setTheme(state.theme === 'dark' ? 'light' : 'dark')`.
  - Renders `<main>` with the children.
  - Renders a `<div className="toast-host">` that maps `state.toasts` into toast items. Each toast auto-dismisses in 4000 ms via a `useEffect` inside a `<Toast>` subcomponent.

### `LandingPage` — `components/landing-page.js`

- **Purpose:** Marketing page at `/`.
- **Props:** none.
- **Key behaviors:**
  - Hero section: product name, tagline "Rehearse the room before you walk in.", and a primary button using `next/link` to `/agents`.
  - Three-step flow: three `<article>` cards labeled "Prep", "Rehearse", "Review" with short copy.
  - Secondary CTA at the bottom re-using the same "View agents" link.

### `AgentsPage` — `components/agents-page.js`

- **Purpose:** Directory at `/agents`.
- **Props:** none.
- **Key behaviors:**
  - Reads the catalog by importing `agents` from `lib/agents.js`.
  - Renders a CSS-grid of five cards. Each card is a `<Link>` to `/agents/${slug}`.
  - Card shows `name`, `role` (as pill), `duration` (as pill), and `description`.

### `AgentDetailPage` — `components/agent-detail-page.js`

- **Props:** `{ slug }`.
- **Key behaviors:**
  - Resolves the agent from `lib/agents.js`. If unknown, renders a "not found" panel.
  - Displays `name`, `longDescription`, `scenario`.
  - Displays `evaluationCriteria` with the first three items visible and the rest collapsed behind a "Show more" button that flips a local `useState` boolean.
  - Thread-creation form: a text input (controlled) plus a "Create thread" button. On submit, call `createThread(slug, title.trim())` then clear the input.
  - Thread list: reads `state.threads[slug] || []`, sorts by `updatedAt` desc, renders rows with title, formatted `createdAt`, session count (`sessionIds.length`), and a delete button. Clicking a row (except the delete button) routes to `/agents/${slug}/threads/${thread.id}`.

### `ThreadDetailPage` — `components/thread-detail-page.js`

- **Props:** `{ slug, threadId }`.
- **Key behaviors:**
  - Resolves thread from `state.threads[slug]`. If unknown, shows not-found.
  - Renders a pre-session form bound to `state.agents[slug]`:
    - `sessionName` input (required).
    - `companyUrl` input (optional).
    - `customContextText` textarea (optional) labeled with `agent.contextFieldLabel` / `agent.contextFieldDescription`.
    - PDF upload trigger button (placeholder that dispatches to the upload flow — owned by: research-and-resources).
  - "Start session" button is disabled when `sessionName` is empty/whitespace. On click:
    1. `patchThread(slug, threadId, { updatedAt: now })`.
    2. `createSession(slug, threadId, { sessionName, customContext, upload: state.agents[slug].upload })`.
    3. `router.push(\`/session/${slug}?threadId=${threadId}&sessionId=${sessionId}\`)`.
  - Sessions history list filtered to `threadId`. Each row displays `sessionName`, formatted `startedAt`, `durationLabel` (or "—" if live session has not ended), and delete button. Row navigates to `/agents/${slug}/sessions/${sessionId}`.

## 4. Data Models

The following JSDoc typedefs fully describe the slices owned by this spec. Slices owned by other specs appear here only as typed placeholders with `null` or `{}` defaults.

```js
/**
 * @typedef {'dark' | 'light'} Theme
 *
 * @typedef {Object} Toast
 * @property {string} id          // toast-<ts>-<rand8>
 * @property {string} message
 * @property {'info'|'success'|'error'} kind
 *
 * @typedef {Object} UploadSlice
 * @property {'idle'|'uploading'|'processing'|'ready'|'failed'} status
 * @property {string|null} fileName
 * @property {string} contextText
 * @property {string|null} previewUrl
 * @property {string|null} error
 *
 * @typedef {Object} SessionLifecycle         // owned by: live-session
 * @property {'idle'|'connecting'|'live'|'ending'|'ended'} status
 * @property {boolean} muted
 * @property {string|null} lastEndedAt
 * @property {string|null} lastDurationLabel
 *
 * @typedef {Object} AgentSlice
 * @property {UploadSlice} upload
 * @property {string} sessionName            // pre-session form buffer
 * @property {string} threadName             // thread-creation form buffer
 * @property {string} customContextText
 * @property {string} companyUrl
 * @property {Object|null} researchPrep      // owned by: research-and-resources
 * @property {string|null} selectedThreadId
 * @property {SessionLifecycle} session      // owned by: live-session
 * @property {Object|null} evaluation        // owned by: evaluation-engine
 * @property {number} rating
 *
 * @typedef {Object} ThreadRecord
 * @property {string} id                     // thread-<ts>-<rand8>
 * @property {string} agentSlug
 * @property {string} title
 * @property {string} createdAt              // ISO
 * @property {string} updatedAt              // ISO
 * @property {string[]} sessionIds
 * @property {Object|null} evaluation        // owned by: evaluation-engine
 * @property {Object|null} memory            // owned by: evaluation-engine (hidden guidance)
 *
 * @typedef {Object} TranscriptEntry
 * @property {'user'|'agent'|'system'} role
 * @property {string} text
 *
 * @typedef {Object} SessionUploadSnapshot
 * @property {string|null} fileName
 * @property {string} contextText
 * @property {string|null} previewUrl
 *
 * @typedef {Object} SessionRecord
 * @property {string} id                     // session-<ts>-<rand8>
 * @property {string} agentSlug
 * @property {string} threadId
 * @property {string} sessionName
 * @property {string} startedAt              // ISO
 * @property {string|null} endedAt
 * @property {string|null} durationLabel     // "MM:SS"
 * @property {TranscriptEntry[]} transcript
 * @property {SessionUploadSnapshot|null} upload
 * @property {Object|null} externalResearch  // owned by: research-and-resources
 * @property {Object|null} coding            // owned by: live-session
 * @property {string} customContext
 * @property {Object|null} evaluation        // owned by: evaluation-engine
 * @property {Object|null} resources         // owned by: research-and-resources
 * @property {Object|null} comparison        // owned by: session-comparison
 *
 * @typedef {Object} AppState
 * @property {Theme} theme
 * @property {Toast[]} toasts
 * @property {Record<string, AgentSlice>} agents
 * @property {Record<string, ThreadRecord[]>} threads
 * @property {Record<string, SessionRecord[]>} sessions
 */
```

Default factory:

```js
const defaultAgentSlice = () => ({
  upload: { status: "idle", fileName: null, contextText: "", previewUrl: null, error: null },
  sessionName: "",
  threadName: "",
  customContextText: "",
  companyUrl: "",
  researchPrep: null,
  selectedThreadId: null,
  session: { status: "idle", muted: false, lastEndedAt: null, lastDurationLabel: null },
  evaluation: null,
  rating: 0,
});

const defaultState = {
  theme: "dark",
  toasts: [],
  agents: {},
  threads: {},
  sessions: {},
};
```

Mutator signatures:

```js
setTheme(theme: Theme): void
pushToast({ message: string, kind?: 'info'|'success'|'error' }): string  // returns id
dismissToast(id: string): void
patchAgent(slug: string, patch: Partial<AgentSlice>): void
createThread(slug: string, title: string): string                        // returns threadId
deleteThread(slug: string, threadId: string): void
patchThread(slug: string, threadId: string, patch: Partial<ThreadRecord>): void
createSession(slug: string, threadId: string, partial: Partial<SessionRecord>): string  // returns sessionId
deleteSession(slug: string, sessionId: string): void
patchSession(slug: string, sessionId: string, patch: Partial<SessionRecord>): void
appendTranscript(slug: string, sessionId: string, entry: TranscriptEntry): void
```

## 5. Agent Catalog

All five entries live in `data/agents.json`. `data/agents.js` is the default-export wrapper:

```js
import agents from "./agents.json";
export default agents;
```

### 5.1 Recruiter — `recruiter`

- **name:** "Recruiter Loop"
- **role:** "Behavioral interviewer"
- **duration:** "20–25 min"
- **description:** "A recruiter running a behavioral loop for a role you name."
- **longDescription:** "Recruiter Loop simulates the first round of a structured behavioral interview. The agent asks you to introduce yourself, probes two or three of your past experiences with STAR-style follow-ups, and checks that your motivations line up with the role you are targeting."
- **scenario:** "You are on a video call with a senior recruiter at the company whose URL you shared. They have your resume in front of them. They have 25 minutes and a checklist: confirm fit, surface two concrete impact stories, and leave time for your questions."
- **focus:** `["communication clarity","impact storytelling","ownership signals","role fit"]`
- **flow:** `["Warm intro and rapport","Resume walkthrough","Two STAR deep-dives","Motivation and role fit","Candidate questions"]`
- **previewMetrics:**
  ```json
  [
    {
      "label": "Communication clarity",
      "value": 82,
      "justification": "Answers were structured; occasional filler words in the second story."
    },
    {
      "label": "Impact storytelling",
      "value": 74,
      "justification": "Strong situation framing; impact numbers missing in the migration example."
    },
    {
      "label": "Ownership signals",
      "value": 80,
      "justification": "Used 'I' appropriately and named specific decisions."
    },
    {
      "label": "Role fit",
      "value": 78,
      "justification": "Motivation tied back to product, weaker on team-level fit."
    }
  ]
  ```
- **evaluationCriteria:**
  ```json
  [
    {
      "label": "Communication clarity",
      "description": "Pacing, structure, and conciseness of spoken answers."
    },
    {
      "label": "Impact storytelling",
      "description": "Concrete outcomes, numbers, and the candidate's specific contribution."
    },
    {
      "label": "Ownership signals",
      "description": "Uses first-person appropriately; names decisions, not just outcomes."
    },
    {
      "label": "Role fit",
      "description": "Motivation and skills align with the posted role and team."
    },
    {
      "label": "Question quality",
      "description": "Candidate questions show research and curiosity."
    }
  ]
  ```
- **systemPrompt:**

  > You are a senior technical recruiter conducting a first-round behavioral screen for the company referenced in the user's shared materials. Your style is warm, crisp, and direct. The call is 20 to 25 minutes. You have the candidate's resume and the company's current job posting in your context. Open by introducing yourself by a realistic name and role, confirm the candidate can hear you, and ask them to walk you through their background in about two minutes. Then drive a structured behavioral loop: ask for a specific past situation relevant to the role, and follow up with STAR probes — "what was the situation", "what was your task", "what exactly did you do", "what was the result, in numbers if you can". Do not let the candidate drift into generalities; if they say "we" repeatedly, ask what they personally did. Aim to cover two deep-dive stories. Transition to motivation and role fit: ask why this company and why this role now. Reserve the last four minutes for the candidate's questions and answer them honestly from the context you have. Never award the role on the call. Never discuss compensation unless the candidate asks directly. If the candidate shares their screen, glance at it and reference what you see by name. Speak one thought at a time; keep your turns under 25 seconds so the candidate has room to respond. If the candidate goes quiet for more than six seconds, prompt gently. End with a clear statement of next steps in the process.

- **evaluationPrompt:**

  > You are an impartial interview coach reviewing the transcript of a 20–25 minute recruiter screen. The candidate's objective was to demonstrate communication clarity, impact storytelling, ownership, and role fit for the company and role named in the context. Return a strict JSON object with: `overallScore` (0–100), `metrics` (array of four objects, one per focus area, each with `label`, `value` 0–100, and a one-sentence `justification` grounded in a quoted moment from the transcript), `strengths` (two to three bullet strings), `improvements` (two to three bullet strings, each paired with the rubric item it addresses), `recommendations` (three bullet strings with concrete practice drills — e.g., "rerun the migration story with two numeric outcomes"), and `summary` (one paragraph, no more than 80 words). Penalize vague "we did" answers in the Ownership metric. Penalize missing numeric outcomes in Impact storytelling. Reward concise openings and strong candidate-asked questions. Do not invent details not present in the transcript. If the transcript is shorter than 800 characters, lower `overallScore` by 20 points and mark the session as under-length in `summary`. Output valid JSON only, no prose outside the JSON.

- **mockEvaluation:** same shape as the real evaluator returns (four metrics listed above, `overallScore: 79`, two strengths, two improvements, three recommendations, short summary). Used for SSR/preview.
- **contextFieldLabel:** "Role or team you are interviewing for"
- **contextFieldDescription:** "Paste the job title, seniority, and a line about the team if the posting is vague."
- **screenShareTitle:** "Show your resume or portfolio"
- **screenShareHelperText:** "The recruiter can glance at anything you put on screen — resume, portfolio, or a project writeup."
- **screenShareEmptyText:** "No screen shared yet. Click share to walk them through a tab."
- **screenShareInstruction:** "When you share, point with your cursor to the bullet you are narrating."

### 5.2 Professor — `professor`

- **name:** "Academic Defense"
- **role:** "Academic examiner"
- **duration:** "25–30 min"
- **description:** "A skeptical professor defending your thesis or a technical concept."
- **longDescription:** "Academic Defense puts you across a table from a tenured examiner. The agent presses on definitions, evidence, edge cases, and your personal contribution, in the style of a qualifying exam or thesis defense."
- **scenario:** "You are in a small seminar room. An examiner with deep knowledge of your field has read your abstract or the concept you named. They have thirty minutes, a notepad, and a habit of saying 'define your terms' whenever you move too fast."
- **focus:** `["conceptual clarity","evidence & rigor","depth of understanding","composure"]`
- **flow:** `["Positioning the topic","Definition probes","Evidence and method","Edge-case pressure","Your contribution"]`
- **previewMetrics:**
  ```json
  [
    {
      "label": "Conceptual clarity",
      "value": 76,
      "justification": "Defined the core term precisely; the second definition wavered."
    },
    {
      "label": "Evidence & rigor",
      "value": 68,
      "justification": "Two citations given; one was misattributed."
    },
    {
      "label": "Depth of understanding",
      "value": 72,
      "justification": "Handled the first edge case; conflated two methods in the second."
    },
    {
      "label": "Composure",
      "value": 84,
      "justification": "Paused, restated, answered — no defensiveness."
    }
  ]
  ```
- **evaluationCriteria:**
  ```json
  [
    {
      "label": "Conceptual clarity",
      "description": "Terms are defined precisely and used consistently."
    },
    {
      "label": "Evidence & rigor",
      "description": "Claims are supported with methods, citations, or reasoning."
    },
    {
      "label": "Depth of understanding",
      "description": "Handles edge cases, tradeoffs, and counter-examples."
    },
    { "label": "Composure", "description": "Pauses, thinks, and responds without defensiveness." },
    {
      "label": "Contribution framing",
      "description": "Articulates what is novel and why it matters."
    }
  ]
  ```
- **systemPrompt:**

  > You are a tenured faculty examiner conducting a rigorous oral defense of the topic or thesis the user named in their context. You have spent twenty years on this subject. Your style is calm, precise, and politely skeptical. The session is 25 to 30 minutes. Begin by asking the candidate to state their central claim and their contribution in two sentences. Then drive four movements. First, probe definitions: every time the candidate introduces a term of art, ask them to define it; if the definition is fuzzy, offer a tighter one and ask whether they accept it. Second, ask for evidence: "what is the strongest study that supports this", "what is the weakest", "what would falsify your claim". Third, present an edge case or a counter-example and ask how their framework handles it. Fourth, ask them to name their specific contribution and to distinguish it from the nearest adjacent work. Do not let the candidate pivot to personal narrative. If they say "I feel", redirect to "what is the evidence". Reward precise language. Push back on hand-waving phrases like "kind of" or "basically". If the candidate asks you a question, answer briefly and return the floor to them. Your tone is never hostile, but you never let an imprecise answer pass uncorrected. Keep turns under 20 seconds to leave room for thinking. End with a single-sentence summary of what the candidate defended well and one area to tighten.

- **evaluationPrompt:**

  > You are an external examiner scoring an oral defense transcript against four criteria: conceptual clarity, evidence and rigor, depth of understanding, and composure. Return a strict JSON object with: `overallScore` (0–100), `metrics` (array of four objects with `label`, `value`, and `justification` each quoting one specific exchange from the transcript), `strengths` (two bullets), `improvements` (two to three bullets, each naming a specific moment and a fix), `recommendations` (three drill suggestions, e.g., "rehearse the definition of X in under 15 words"), and `summary` (80 words max). Penalize filler phrases such as "kind of" and "basically" in the clarity metric. Penalize any uncited numeric claim in evidence and rigor. Reward visible pauses followed by structured answers in composure. Never invent a claim the candidate did not make. If the candidate failed to state a central claim in their first turn, deduct 10 points from `overallScore` and flag this in `summary`. Output valid JSON only.

- **mockEvaluation:** Four metrics above, `overallScore: 75`, strengths, improvements, recommendations, summary. Used for previews.
- **contextFieldLabel:** "Thesis statement or concept you are defending"
- **contextFieldDescription:** "Paste your abstract, a paragraph describing the concept, or the sub-field you want probed."
- **screenShareTitle:** "Share a figure or a slide"
- **screenShareHelperText:** "Show one figure, one table, or one slide at a time — the examiner will reference it by name."
- **screenShareEmptyText:** "No figure shared. You can defend verbally or share when prompted."
- **screenShareInstruction:** "When a figure is on screen, narrate what the x-axis and y-axis represent before the examiner asks."

### 5.3 Investor — `investor`

- **name:** "Investor Pitch"
- **role:** "Seed/Series A investor"
- **duration:** "15–20 min"
- **description:** "A sharp investor pushing on market, traction, and conviction."
- **longDescription:** "Investor Pitch simulates a first meeting with a check-writing investor. The agent listens to your three-minute pitch, then drives hard on market clarity, traction evidence, differentiation, and the conviction behind your why-now."
- **scenario:** "You are in the partner's office on Zoom. They have your deck open. They have twenty minutes and a filter: is the market big, is the traction real, why you, why now. They will interrupt. They will ask for the number."
- **focus:** `["market clarity","traction evidence","differentiation","conviction"]`
- **flow:** `["60-second hook","Three-minute pitch","Market probe","Traction probe","Differentiation","Why now / why you","Asks"]`
- **previewMetrics:**
  ```json
  [
    {
      "label": "Market clarity",
      "value": 70,
      "justification": "Bottom-up TAM stated; top-down check missing."
    },
    {
      "label": "Traction evidence",
      "value": 66,
      "justification": "MRR mentioned; retention cohorts not shown."
    },
    {
      "label": "Differentiation",
      "value": 78,
      "justification": "Clear wedge vs. the two named incumbents."
    },
    {
      "label": "Conviction",
      "value": 82,
      "justification": "Strong why-now tied to a regulatory change."
    }
  ]
  ```
- **evaluationCriteria:**
  ```json
  [
    {
      "label": "Market clarity",
      "description": "Top-down and bottom-up sizing are both present and realistic."
    },
    {
      "label": "Traction evidence",
      "description": "Specific metrics, cohorts, and growth rates; no vanity numbers."
    },
    {
      "label": "Differentiation",
      "description": "Clear wedge versus named incumbents or substitutes."
    },
    { "label": "Conviction", "description": "Why now, why this team, stated with specifics." },
    {
      "label": "Ask clarity",
      "description": "Round size, use of funds, and milestones are explicit."
    }
  ]
  ```
- **systemPrompt:**

  > You are a partner at an early-stage venture fund doing a first meeting with the founder whose company is referenced in the shared deck and URL. You write checks between $250k and $3M. Your style is direct and time-boxed. You interrupt. You ask for the number. The meeting is 15 to 20 minutes. Start by asking for the 60-second hook: "what does your company do, for whom, and why now, in one minute". Then give them three minutes uninterrupted to pitch, timing it in your head. After the pitch, drive four probes. Market: push for both top-down and bottom-up sizing; reject "everybody" as a customer; ask who churned first and why. Traction: ask for the last 90 days of specific numbers — MRR, weekly actives, retention cohort at week 8; reject vanity metrics like cumulative signups. Differentiation: ask them to name the two closest competitors and why they win against each one, specifically. Why now and why you: one sentence each, backed by a signal the founder personally saw. Close with the ask: round size, valuation expectation if offered, and the three milestones this round buys. Your tone is respectful and fast. Do not give advice mid-pitch; save observations for the end. If the founder waves their hands, say "give me the number". If they say a metric, ask what the denominator is. Keep your turns under 15 seconds unless you are summarizing.

- **evaluationPrompt:**

  > You are a deal partner writing an internal memo after a 20-minute founder meeting. Score the transcript against four criteria: market clarity, traction evidence, differentiation, and conviction. Return a strict JSON object with `overallScore` (0–100), `metrics` (four entries, each with `label`, `value`, and a `justification` quoting one founder line from the transcript), `strengths` (two bullets), `improvements` (two to three bullets, each naming a specific missing number or claim), `recommendations` (three drill suggestions — e.g., "rehearse the 60-second hook until you can deliver it in 50 seconds without hedges"), and `summary` (80 words max). Penalize any use of vanity metrics (cumulative signups, total addressable visits) in traction. Penalize unqualified superlatives ("we are the only", "everyone needs this") in differentiation. Reward specific dates, numeric deltas, and founder-observed signals in conviction. Do not invent numbers. If the founder failed to state an ask by the end of the transcript, deduct 15 points and note this in `summary`. Output valid JSON only.

- **mockEvaluation:** Four metrics as above, `overallScore: 74`, strengths, improvements, recommendations, summary.
- **contextFieldLabel:** "Company one-liner and stage"
- **contextFieldDescription:** "A single sentence describing what you do plus your current stage (pre-seed, seed, Series A) and any raised-to-date figure."
- **screenShareTitle:** "Share your deck"
- **screenShareHelperText:** "Walk through two or three slides — the investor will stop you on whichever one is least clear."
- **screenShareEmptyText:** "No deck shared. You can pitch verbally, but visuals help."
- **screenShareInstruction:** "Advance slides only after you have named the number on the current one."

### 5.4 Coding — `coding`

- **name:** "Coding Round"
- **role:** "Technical interviewer"
- **duration:** "35–45 min"
- **description:** "A company-relevant interview question, think-aloud coding, and live probing."
- **longDescription:** "Coding Round drops you into a live technical interview. The agent picks a real interview-grade question (ideally scraped to match the target company), watches you code in the in-browser editor, and presses on your reasoning, your edge cases, and your communication while coding."
- **scenario:** "You have 40 minutes and a shared editor. The interviewer gives you a problem, listens to your approach, lets you code, and will ask about complexity and edge cases as you go. They expect you to think out loud."
- **focus:** `["problem understanding","algorithmic reasoning","code clarity","communication while coding"]`
- **flow:** `["Problem statement","Clarifying questions","Approach + complexity","Code","Test + edge cases","Optimization discussion"]`
- **previewMetrics:**
  ```json
  [
    {
      "label": "Problem understanding",
      "value": 80,
      "justification": "Restated the problem in own words; missed one constraint on input size."
    },
    {
      "label": "Algorithmic reasoning",
      "value": 72,
      "justification": "Chose an O(n log n) approach; did not consider the O(n) hash solution until prompted."
    },
    {
      "label": "Code clarity",
      "value": 78,
      "justification": "Readable names; one off-by-one corrected after testing."
    },
    {
      "label": "Communication while coding",
      "value": 70,
      "justification": "Strong early narration; went silent during the implementation for ~2 minutes."
    }
  ]
  ```
- **evaluationCriteria:**
  ```json
  [
    {
      "label": "Problem understanding",
      "description": "Restates the problem, clarifies constraints, and names inputs/outputs explicitly."
    },
    {
      "label": "Algorithmic reasoning",
      "description": "Considers multiple approaches with time and space complexity before coding."
    },
    {
      "label": "Code clarity",
      "description": "Readable names, clean control flow, reasonable decomposition."
    },
    {
      "label": "Communication while coding",
      "description": "Narrates intent while typing; does not disappear into the keyboard."
    },
    {
      "label": "Testing and edge cases",
      "description": "Runs the code mentally or in the editor against normal, empty, and extreme inputs."
    }
  ]
  ```
- **systemPrompt:**

  > You are a senior engineer from the company referenced in the user's context conducting a 40-minute technical interview. You have one problem for them, drawn from the provided question or a close variant of it. Your style is calm, curious, and precise. Open by introducing yourself briefly, confirm the candidate has the editor open, and state the problem clearly. Read it once fully, then read the constraints. Give the candidate 60 to 90 seconds before expecting a response. Drive the interview in four phases. First, clarification: encourage the candidate to restate the problem in their own words and to ask about input ranges, duplicates, empty inputs, and whether they can mutate the input. Second, approach: require them to articulate at least two candidate approaches with big-O time and space before they touch the keyboard. If they jump straight to code, gently redirect: "before you type, what is the shape of the solution". Third, implementation: let them code. Ask them to narrate while typing. If they go silent for more than 30 seconds, ask "what are you thinking". Spot off-by-ones, mis-indexed loops, and unhandled empties and nudge by asking "what happens when the input is empty". Fourth, testing: ask them to dry-run on one nominal and one edge case. Close by asking for one optimization they did not implement. Never give the answer. Never grade on the call. Your turns stay under 15 seconds. If the candidate asks whether they can use a library, say yes unless it trivializes the problem.

- **evaluationPrompt:**

  > You are a hiring-committee reviewer scoring a technical interview transcript plus the final code submission. Score against four criteria: problem understanding, algorithmic reasoning, code clarity, and communication while coding. Return a strict JSON object with `overallScore` (0–100), `metrics` (four entries, each with `label`, `value`, and a `justification` that quotes a specific moment from the transcript or a specific line from the code), `strengths` (two bullets), `improvements` (two to three bullets, each naming a specific missed clarification, missed complexity analysis, or silent coding window), `recommendations` (three drill suggestions, e.g., "rerun this problem and say your big-O out loud before typing"), and `summary` (80 words max). Penalize jumping to code without stating complexity. Penalize unhandled edge cases in the final code. Reward explicit re-statement of the problem and proactive edge-case enumeration. Do not invent code the candidate did not write. If the final code fails on the stated constraints, deduct 20 points and mark this in `summary`. Output valid JSON only.

- **mockEvaluation:** Four metrics as above, `overallScore: 75`, strengths, improvements, recommendations, summary.
- **contextFieldLabel:** "Target company and problem area"
- **contextFieldDescription:** "Name the company you are interviewing for and (optionally) a domain like 'arrays', 'graphs', 'SQL', or 'concurrency' to focus the question."
- **screenShareTitle:** "Editor-driven round"
- **screenShareHelperText:** "No screen share is needed — you and the interviewer both see the in-browser editor."
- **screenShareEmptyText:** "Screen share is disabled for coding rounds; use the editor."
- **screenShareInstruction:** "Keep your editor in view; the interviewer references line numbers."
- **codingLanguages:** `["JavaScript","Python","Java","C++","SQL","Pseudocode"]`
- **codingQuestionBank:**
  ```json
  [
    {
      "title": "Two Sum — return indices of two numbers that add to target",
      "markdown": "Given an array of integers `nums` and an integer `target`, return the indices of the two numbers such that they add up to `target`. Assume exactly one solution and do not use the same element twice.\n\n**Constraints:** `2 <= nums.length <= 10^4`, `-10^9 <= nums[i], target <= 10^9`.",
      "companyName": "Generic",
      "sourceUrl": "https://leetcode.com/problems/two-sum/"
    },
    {
      "title": "Merge Intervals",
      "markdown": "Given an array of intervals `[start, end]`, merge all overlapping intervals and return the minimal set of non-overlapping intervals.\n\n**Constraints:** `1 <= intervals.length <= 10^4`, intervals may be unsorted.",
      "companyName": "Generic",
      "sourceUrl": "https://leetcode.com/problems/merge-intervals/"
    },
    {
      "title": "Longest Substring Without Repeating Characters",
      "markdown": "Given a string `s`, return the length of the longest substring without repeating characters.\n\n**Constraints:** `0 <= s.length <= 5 * 10^4`.",
      "companyName": "Generic",
      "sourceUrl": "https://leetcode.com/problems/longest-substring-without-repeating-characters/"
    }
  ]
  ```
- **sessionKickoff:**
  > "Welcome. I have a 40-minute slot with you. I'll share one problem, you'll work in the editor, and I'd like you to think out loud. Before you type, tell me how you understand the problem and what approaches you're weighing. Ready? Here is the question."

### 5.5 Custom — `custom`

- **name:** "Custom Scenario"
- **role:** "Adaptable counterpart"
- **duration:** "15–30 min"
- **description:** "Describe any scenario in plain English and rehearse against it."
- **longDescription:** "Custom Scenario is the general-purpose agent. It adapts to whatever role and context you describe — a podcast host, a skeptical customer, a board member, a worried parent. It reads your context, picks an appropriate persona, and drives a realistic conversation within that frame."
- **scenario:** "You describe who you are talking to, what the conversation is, and what you want to rehearse. The agent inhabits that counterpart and runs the conversation from there."
- **focus:** `["clarity","specificity","audience handling","adaptability"]`
- **flow:** `["Scenario framing","Opening turn","Pressure and probes","Adaptation to your moves","Wrap-up"]`
- **previewMetrics:**
  ```json
  [
    {
      "label": "Clarity",
      "value": 78,
      "justification": "Opening statement was tight; middle section used one jargon term without unpacking."
    },
    {
      "label": "Specificity",
      "value": 72,
      "justification": "One concrete example; second point stayed general."
    },
    {
      "label": "Audience handling",
      "value": 80,
      "justification": "Adjusted tone when the counterpart expressed confusion."
    },
    {
      "label": "Adaptability",
      "value": 76,
      "justification": "Changed approach after the second pushback; recovered the thread well."
    }
  ]
  ```
- **evaluationCriteria:**
  ```json
  [
    {
      "label": "Clarity",
      "description": "Core message lands in under 30 seconds and stays consistent."
    },
    {
      "label": "Specificity",
      "description": "Claims are backed by specific examples, numbers, or observations."
    },
    {
      "label": "Audience handling",
      "description": "Tone and vocabulary match the counterpart named in the scenario."
    },
    {
      "label": "Adaptability",
      "description": "Responds to pushback by reframing rather than repeating."
    },
    {
      "label": "Close",
      "description": "Ends with a clear next step or a decision, not a trail-off."
    }
  ]
  ```
- **systemPrompt:**

  > You are an adaptable conversational counterpart. The user has described, in their context field and shared URL, exactly who they want you to be — a podcast host interviewing them about their startup, a skeptical enterprise buyer pressing on ROI, a conference Q&A attendee, a worried parent, a nonprofit board member, or anything else. Read their scenario carefully and inhabit that role fully. Your first move is to confirm the framing in one short sentence and then open the conversation as that character would. Stay in character throughout. Your persona's intent, stakes, and knowledge come from the user's context. If the context is thin, pick the most plausible version of the role and state your assumptions in one sentence before beginning. Drive the conversation with the arc implied by the scenario: a podcast host asks, listens, and probes; a skeptical buyer objects and asks for proof; a board member focuses on risk and governance. Adapt tone, vocabulary, and pacing to the role. Keep turns under 25 seconds to give the user space to respond. If the user drifts out of the frame, gently steer back. Close the session with something fitting for the scenario — a sign-off line from a host, a "we'll get back to you" from a buyer, a summary motion from a board chair. Never break character to give meta advice; the evaluation step will do that.

- **evaluationPrompt:**

  > You are a communications coach reviewing a transcript of a user-defined rehearsal. The four criteria are clarity, specificity, audience handling, and adaptability. The user's scenario description is included in the context. Return a strict JSON object with `overallScore` (0–100), `metrics` (four entries with `label`, `value`, `justification` grounded in a quoted moment), `strengths` (two bullets), `improvements` (two to three bullets, each naming the rubric item it addresses), `recommendations` (three drill suggestions shaped to the scenario — e.g., "run the same pitch against a hostile buyer variant"), and `summary` (80 words max). Calibrate the rubric to the scenario: a podcast warrants different audience handling than a board meeting. Penalize jargon that the described counterpart would not know. Reward visible reframes after pushback. Do not invent scenario elements not present in the context or the transcript. If the user drifted out of the described frame for more than 25% of the session, flag this in `summary` and deduct up to 10 points. Output valid JSON only.

- **mockEvaluation:** Four metrics as above, `overallScore: 76`, strengths, improvements, recommendations, summary.
- **contextFieldLabel:** "Describe the scenario"
- **contextFieldDescription:** "Who are you talking to? What is this conversation? What do you want to rehearse? Two or three sentences is enough."
- **screenShareTitle:** "Share anything relevant"
- **screenShareHelperText:** "If the scenario involves a slide, a document, or a screen, share it — the agent will reference what it sees."
- **screenShareEmptyText:** "No screen shared. Purely verbal is fine."
- **screenShareInstruction:** "If you share, tell the counterpart what they are looking at before expecting a reaction."

## 6. Routing & Navigation

| Route                                 | Params                                 | Renders                                                                 |
| ------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `/`                                   | —                                      | `<LandingPage/>`                                                        |
| `/agents`                             | —                                      | `<AgentsPage/>`                                                         |
| `/agents/[slug]`                      | `slug`                                 | `<AgentDetailPage slug={slug}/>`                                        |
| `/agents/[slug]/threads/[threadId]`   | `slug`, `threadId`                     | `<ThreadDetailPage slug={slug} threadId={threadId}/>`                   |
| `/agents/[slug]/sessions/[sessionId]` | `slug`, `sessionId`                    | `<SessionDetailPage/>` (owned by: evaluation-engine) — placeholder here |
| `/session/[slug]`                     | `slug`, query: `threadId`, `sessionId` | `<SessionPage/>` (owned by: live-session) — placeholder here            |

Each `app/**/page.js` file is at most 30 lines: it imports the component from `components/`, forwards params, and returns `<Shell>…</Shell>`.

Navigation is handled with `next/link` for anchors and `useRouter()` from `next/navigation` inside event handlers (e.g., "Start session"). The shell brand uses `next/link` to `/`.

## 7. Theming & Styling

All styles live in `app/globals.css`. There is no Tailwind, no CSS modules. CSS variables drive theming via `[data-theme="dark"]` (default) and `[data-theme="light"]` selectors on `<html>`.

```css
:root {
  --radius: 14px;
  --accent: #4285f4; /* Google Blue */
  --font-body: "Google Sans Text", "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
  --font-mono: "SFMono-Regular", "IBM Plex Mono", "Fira Code", ui-monospace, monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
}

html[data-theme="dark"] {
  --bg: #0d1117;
  --surface: #161b22;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --border: #30363d;
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

html[data-theme="light"] {
  --bg: #f7f9fc;
  --surface: #ffffff;
  --text: #111418;
  --text-muted: #5a6472;
  --border: #dfe3ea;
  --shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}
```

Spacing is applied via `var(--space-N)`. Card radius is `var(--radius)`. Primary CTAs use `background: var(--accent); color: #fff`. Focus ring: 2px solid `var(--accent)` with 2px offset.

Breakpoints:

- `@media (max-width: 960px)` collapses the agents grid from 3→2 columns.
- `@media (max-width: 720px)` collapses to 1 column and stacks the landing-flow cards vertically.

## 8. Persistence

- **Key:** `spark-state-v1`. The `v1` suffix is the migration guard; any other key is ignored on restore.
- **Shape:** the full `AppState` object.
- **Write:** a `useEffect` with a 200 ms debounce. `JSON.stringify(state)` into the key. On `QuotaExceededError`, catch and push a toast "Local storage full — older sessions may be dropped." (Optional future: prune transcripts.)
- **Restore:** inside `useReducer`'s lazy initializer. On the server, return `defaultState`. On the client, `try { JSON.parse(localStorage.getItem('spark-state-v1')) } catch {}`. Merge into `defaultState` with key-by-key fallback so a missing `agents`/`threads`/`sessions`/`toasts` is repaired.
- **Migration guard:** if a future version exists (e.g., `spark-state-v2`), the v1 reader ignores it. When the shape breaks incompatibly, bump the key and write a migrator.

## 9. Error Handling

| Failure                                       | Response                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Unknown agent slug in URL                     | `AgentDetailPage` renders `<div className="not-found">Agent not found</div>` and a link back to `/agents`. No state mutation. |
| Unknown threadId in URL                       | `ThreadDetailPage` renders "Thread not found" and a link back to `/agents/<slug>`.                                            |
| Corrupt localStorage JSON                     | `catch` → `console.warn('spark-state-v1 corrupt, resetting')` → continue with `defaultState`.                                 |
| Missing top-level keys in restored state      | Each missing key is filled from `defaultState`; restore proceeds.                                                             |
| `pushToast` with empty message                | Ignored (no toast added).                                                                                                     |
| Mutator called with unknown slug/ID           | `console.warn` and no-op.                                                                                                     |
| Start-session clicked with empty session name | Button is disabled; no navigation occurs.                                                                                     |
| Catalog load failure                          | `AgentsPage` renders "Unable to load agents" once; inline fallback message.                                                   |
| QuotaExceededError on write                   | Catch, push a `warn` toast, keep in-memory state.                                                                             |

## 10. Testing Strategy

Spark has no automated test pyramid. Use manual QA plus a short smoke script.

**Manual QA flows:**

1. Fresh visit → `/` → click "View agents" → land on `/agents` with five cards → click Recruiter → see scenario, criteria, threads list (empty) → create a thread "FAANG recruiter screen" → thread appears in list.
2. Open the new thread → enter session name "First pass" → Start session → URL becomes `/session/recruiter?threadId=…&sessionId=…` (landing is owned by live-session).
3. Return to `/agents/recruiter/threads/<id>` → session appears in history.
4. Delete a thread → toast "Thread deleted" → thread gone, its sessions gone.
5. Reload the page → state persists.
6. Toggle theme → light/dark toggles, value persists across reload.
7. Corrupt `spark-state-v1` in DevTools → reload → app boots with default state, console warns once.
8. Visit `/agents/nope` → "Agent not found" page.
9. Visit `/agents/recruiter/threads/missing` → "Thread not found" page.
10. Open the agents page on a 600px-wide viewport → single column.

**Smoke script — `scripts/smoke-agents-catalog.mjs`:**

- `node scripts/smoke-agents-catalog.mjs` loads `data/agents.json`, asserts exactly five entries, asserts required keys on each, asserts `coding` has `codingLanguages`, `codingQuestionBank` (non-empty), and `sessionKickoff`, and asserts that no other agent carries those keys. Exit code non-zero on any failure.

Any future spec may add its own smoke script; this one is the minimum for this feature.
