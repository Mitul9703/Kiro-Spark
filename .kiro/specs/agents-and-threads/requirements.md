# Requirements — agents-and-threads

## Introduction

The **agents-and-threads** feature is the foundation of Spark. It delivers the landing page, the agent directory, the per-agent detail page, and the thread workspace where a user organizes practice goals and launches sessions. It also owns the canonical client state container (`AppProvider`), the application shell (header, theme toggle, toast host), the agent catalog with five role-specific agents (Recruiter, Professor, Investor, Coding, Custom), and the localStorage persistence layer that survives reloads. This feature is for the solo user preparing for a high-stakes communication event who needs a place to land, pick a scenario, name an objective, and step into a live rehearsal — with everything they do remembered on their own machine.

---

### Requirement 1 — Landing page orients the user

**User Story:** As a first-time visitor, I want a landing page that explains Spark in seconds, so that I decide whether to continue.

**Acceptance Criteria:**

1. WHEN the user navigates to `/` THEN the system SHALL render the `LandingPage` component inside the shell.
2. WHEN the landing page mounts THEN the system SHALL display a hero section with the product name "Spark", a one-sentence tagline, and a primary call-to-action button labeled "View agents".
3. WHEN the landing page mounts THEN the system SHALL display a three-step flow section with cards labeled "Prep", "Rehearse", and "Review" in that order, each with a short description.
4. WHEN the user clicks the "View agents" button THEN the system SHALL navigate to `/agents`.
5. WHEN the landing page mounts THEN the system SHALL display the header with the brand and the theme toggle.
6. IF the viewport width is below 720px THEN the system SHALL stack the three-step cards vertically.

---

### Requirement 2 — Agents directory lists all five agents

**User Story:** As a user, I want to browse every available agent, so that I can pick the one that matches my upcoming event.

**Acceptance Criteria:**

1. WHEN the user navigates to `/agents` THEN the system SHALL render a grid of exactly five cards, one per agent defined in `data/agents.json`.
2. WHEN a card renders THEN the system SHALL display the agent `name`, `role`, `duration`, and `description`.
3. WHEN the user clicks anywhere on a card THEN the system SHALL navigate to `/agents/<slug>`.
4. IF the agent catalog fails to load THEN the system SHALL render a message "Unable to load agents" and no cards.
5. WHEN the viewport width is at least 960px THEN the system SHALL render the grid with three columns; below 960px it SHALL collapse to two and then one column.

---

### Requirement 3 — Agent detail shows scenario and rubric

**User Story:** As a user, I want to read the agent's scenario and evaluation criteria, so that I know what I am about to be tested on.

**Acceptance Criteria:**

1. WHEN the user navigates to `/agents/<slug>` for a known slug THEN the system SHALL render the `AgentDetailPage` with the agent's `name`, `longDescription`, and `scenario`.
2. WHEN the agent detail page mounts THEN the system SHALL render the `evaluationCriteria` list with each item's label and description.
3. WHEN the `evaluationCriteria` list has more than three items THEN the system SHALL collapse items beyond the third behind a "Show more" expander.
4. IF the slug in the URL does not match any entry in `data/agents.json` THEN the system SHALL render an "Agent not found" message and a link back to `/agents`.
5. WHEN the agent detail page mounts THEN the system SHALL also render the thread-creation form and the list of existing threads for that agent.

---

### Requirement 4 — Thread creation and deletion

**User Story:** As a user, I want to create named threads under an agent, so that I can group multiple rehearsal sessions toward one goal.

**Acceptance Criteria:**

1. WHEN the user types a non-empty title into the thread-creation input and clicks "Create thread" THEN the system SHALL call `createThread(slug, title)` and append the new thread to `state.threads[slug]`.
2. IF the thread title is empty or whitespace-only THEN the system SHALL disable the "Create thread" button.
3. WHEN a thread is created THEN the system SHALL generate an ID of the form `thread-<timestamp>-<random8hex>`, set `createdAt`/`updatedAt` to the current ISO time, and initialize `sessionIds` to an empty array.
4. WHEN the user clicks the delete icon on a thread row THEN the system SHALL call `deleteThread(slug, threadId)` and remove the thread from state along with every session whose `threadId` matches.
5. WHEN a thread is deleted THEN the system SHALL push a toast with message "Thread deleted" of kind `info`.
6. WHEN the existing threads list renders THEN each row SHALL display the thread title, formatted `createdAt`, session count, and a delete button.

---

### Requirement 5 — Thread detail hosts the pre-session form

**User Story:** As a user, I want a pre-session form inside a thread, so that I can set context and start a new session.

**Acceptance Criteria:**

1. WHEN the user navigates to `/agents/<slug>/threads/<threadId>` for a known thread THEN the system SHALL render the `ThreadDetailPage` with the thread title, the session-name input (required), the optional company-URL input, the optional custom-context textarea, and a PDF upload trigger (owned by: research-and-resources).
2. IF the session-name input is empty or whitespace-only THEN the system SHALL disable the "Start session" button.
3. WHEN the user clicks "Start session" with a valid session name THEN the system SHALL create a session record via `createSession(slug, threadId, partial)` and navigate to `/session/<slug>?threadId=<threadId>&sessionId=<sessionId>`.
4. WHEN the thread detail page mounts THEN the system SHALL display a sessions-history list filtered by `threadId`, most recent first.
5. WHEN the user clicks a session row THEN the system SHALL navigate to `/agents/<slug>/sessions/<sessionId>`.
6. WHEN the user clicks the delete icon on a session row THEN the system SHALL call `deleteSession(slug, sessionId)` and also remove that `sessionId` from the thread's `sessionIds` list.
7. IF the thread ID does not exist in state THEN the system SHALL render a "Thread not found" message with a link back to the agent page.

---

### Requirement 6 — Session record shape is canonical

**User Story:** As a developer consuming state from this feature, I want a single documented session record shape, so that every other spec extends the same object.

**Acceptance Criteria:**

1. WHEN `createSession` is called THEN the system SHALL push to `state.sessions[slug]` an object containing `id`, `agentSlug`, `threadId`, `sessionName`, `startedAt`, `endedAt`, `durationLabel`, `transcript`, `upload`, `externalResearch`, `coding`, `customContext`, `evaluation`, `resources`, and `comparison`.
2. WHEN `createSession` initializes a record THEN `transcript` SHALL be `[]`, `endedAt`/`durationLabel` SHALL be `null`, and slices owned by other specs (`externalResearch`, `coding`, `evaluation`, `resources`, `comparison`) SHALL be `null` until those specs populate them.
3. WHEN `createSession` returns THEN the system SHALL also append the new `sessionId` to the owning thread's `sessionIds` array and update the thread's `updatedAt`.
4. IF the slug has no existing entry in `state.sessions` THEN the system SHALL initialize it to `[]` before appending.

---

### Requirement 7 — AppProvider is the single source of truth

**User Story:** As a developer building any page, I want one provider to read from and one set of mutators to write through, so that state stays consistent.

**Acceptance Criteria:**

1. WHEN any page mounts THEN it SHALL access state via `useAppState()` and mutators via `useAppActions()` from `components/app-provider.js`.
2. WHEN a mutator is called THEN the provider SHALL produce a new top-level state object (immutable update) and schedule a debounced write to localStorage.
3. WHEN the provider mounts THEN it SHALL expose these mutators: `setTheme`, `pushToast`, `dismissToast`, `patchAgent`, `createThread`, `deleteThread`, `patchThread`, `createSession`, `deleteSession`, `patchSession`, `appendTranscript`.
4. WHEN `patchAgent(slug, patch)` is called for a slug with no existing entry THEN the provider SHALL initialize the default agent slice before applying the patch.
5. IF a mutator is called with a slug or ID that does not exist THEN the provider SHALL log a warning via `console.warn` and leave state unchanged.

---

### Requirement 8 — Theme toggle switches light and dark

**User Story:** As a user, I want to switch between light and dark mode, so that the app matches my environment.

**Acceptance Criteria:**

1. WHEN the app first mounts with no persisted state THEN the system SHALL default `theme` to `dark`.
2. WHEN the user clicks the theme toggle in the header THEN the system SHALL call `setTheme` with the opposite value and immediately update the `data-theme` attribute on `<html>`.
3. WHEN the theme changes THEN the system SHALL persist the new value to localStorage under the `spark-state-v1` key.
4. WHEN the theme is `dark` THEN the CSS variables SHALL use the dark palette; when `light`, the light palette.
5. WHEN the page reloads THEN the system SHALL restore the last-used theme before first paint by reading `spark-state-v1` in a client-only effect.

---

### Requirement 9 — Toast system surfaces transient feedback

**User Story:** As a user, I want short notifications for small events, so that I know my action registered.

**Acceptance Criteria:**

1. WHEN `pushToast({message, kind})` is called THEN the system SHALL append a toast with a generated ID and kind one of `info|success|error` to `state.toasts`.
2. WHEN a toast is added THEN the shell SHALL render it in the toast host and auto-dismiss it after 4000ms.
3. WHEN the user clicks a toast's dismiss button THEN the system SHALL call `dismissToast(id)` and remove it from state.
4. WHEN more than three toasts are active at once THEN the system SHALL render them stacked top-to-bottom with newest at the bottom.
5. IF `pushToast` is called with a missing `message` THEN the system SHALL ignore the call.

---

### Requirement 10 — localStorage persistence round-trips state

**User Story:** As a user, I want the app to remember my threads and sessions between visits, so that I do not rebuild context each time.

**Acceptance Criteria:**

1. WHEN the provider detects a state change THEN the system SHALL debounce writes by 200ms and then write `JSON.stringify(state)` to `localStorage.setItem('spark-state-v1', ...)`.
2. WHEN the provider mounts on the client THEN the system SHALL read `spark-state-v1`, `JSON.parse` it, and merge it into the default state.
3. IF reading or parsing localStorage throws THEN the system SHALL catch the error, log via `console.warn`, and continue with the default state.
4. IF the restored state is missing top-level keys (e.g. `agents`, `threads`, `sessions`, `toasts`) THEN the system SHALL fill them from the default state.
5. WHEN the restored state has a version mismatch (key not `spark-state-v1`) THEN the system SHALL discard it.
6. WHEN the provider runs on the server (SSR) THEN the system SHALL NOT touch localStorage.

---

### Requirement 11 — Agent catalog is complete and concrete

**User Story:** As a user picking an agent, I want each agent to have a real scenario, a real rubric, and a real persona prompt, so that my rehearsal is believable.

**Acceptance Criteria:**

1. WHEN the app reads `data/agents.json` THEN the file SHALL contain exactly five entries with slugs `recruiter`, `professor`, `investor`, `coding`, `custom`.
2. WHEN any agent entry is read THEN it SHALL include non-empty values for `name`, `role`, `duration`, `description`, `longDescription`, `scenario`, `focus`, `flow`, `previewMetrics`, `evaluationCriteria`, `systemPrompt`, `evaluationPrompt`, `mockEvaluation`, `contextFieldLabel`, `contextFieldDescription`, `screenShareTitle`, `screenShareHelperText`, `screenShareEmptyText`, and `screenShareInstruction`.
3. WHEN the `coding` entry is read THEN it SHALL additionally include `codingLanguages` equal to `["JavaScript","Python","Java","C++","SQL","Pseudocode"]`, a non-empty `codingQuestionBank` array, and a non-empty `sessionKickoff` string.
4. IF any other agent entry contains `codingLanguages`, `codingQuestionBank`, or `sessionKickoff` THEN the schema SHALL reject it at load time via a console error.
5. WHEN `evaluationCriteria` is read THEN each agent SHALL list at least four rubric items drawn from its declared focus areas.

---

### Requirement 12 — Routing renders the correct pages

**User Story:** As a user, I want each URL to map to a single intent, so that links and the back button behave as expected.

**Acceptance Criteria:**

1. WHEN the URL is `/` THEN the system SHALL render `LandingPage`.
2. WHEN the URL is `/agents` THEN the system SHALL render `AgentsPage`.
3. WHEN the URL matches `/agents/[slug]` THEN the system SHALL render `AgentDetailPage` with `slug` from params.
4. WHEN the URL matches `/agents/[slug]/threads/[threadId]` THEN the system SHALL render `ThreadDetailPage` with both params.
5. IF a page receives an unknown `slug` or `threadId` THEN it SHALL render the not-found message specified in Requirements 3 and 5 respectively instead of crashing.
6. WHEN the user uses the browser back button from a detail page THEN the system SHALL return to the previously visited route without losing in-memory state.

---

### Requirement 13 — Shell is shared by every page

**User Story:** As a user, I want consistent navigation and feedback surfaces on every page, so that the product feels like one app.

**Acceptance Criteria:**

1. WHEN any route renders THEN the system SHALL wrap its content in the `Shell` component.
2. WHEN the shell renders THEN it SHALL display a header with a clickable "Spark" brand that navigates to `/` and a theme toggle button.
3. WHEN the shell renders THEN it SHALL mount a single toast host that reads from `state.toasts`.
4. WHEN the shell renders THEN it SHALL render its `children` in a main content area with max width 1120px and horizontal padding 24px.
5. IF the user is on `/` THEN the brand in the header SHALL be non-clickable (or a no-op click).

---

### Requirement 14 — ID and time helpers are shared

**User Story:** As a developer, I want one helper for IDs and one for time formatting, so that every surface uses the same format.

**Acceptance Criteria:**

1. WHEN any part of the provider needs a new ID THEN it SHALL call `generateId(type)` from `lib/ids.js` which returns `${type}-${Date.now()}-${random8hex}`.
2. WHEN the sessions history row renders a duration THEN it SHALL use `formatDuration(ms)` from `lib/format.js` which returns a string of the form `MM:SS`.
3. WHEN a thread row renders `createdAt` THEN it SHALL use `formatDateTime(iso)` from `lib/format.js` which returns a locale-friendly string like `Apr 24, 2026 · 3:14 PM`.
4. IF `formatDuration` is called with a non-finite or negative number THEN it SHALL return `00:00`.
5. IF `formatDateTime` is called with an invalid ISO string THEN it SHALL return an empty string.
