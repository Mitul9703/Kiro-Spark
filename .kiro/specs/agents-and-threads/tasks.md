# Tasks — agents-and-threads

Ordered, single-PR-sized tasks. Sub-bullets reference the exact files and functions touched. Requirement IDs refer to `requirements.md`.

- [ ] 1. Scaffold the Next.js 15 app and package.json
  - Create `package.json` with React 19, Next.js 15.3.1, npm scripts `dev`, `build`, `start`, `lint`.
  - Create `next.config.mjs` (empty default export).
  - Create `.gitignore` and `.env.example` (empty stubs — populated by other specs).
  - Create `app/layout.js` with `<html data-theme="dark">`, the body font stack, and the `<AppProvider>` wrapper (imported from `components/app-provider.js` which is implemented in a later task — leave a stub import for now).
  - Add `app/globals.css` with only the `:root` reset.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.1_

- [ ] 2. Add shared helpers in `lib/`
  - `lib/ids.js` → `export function generateId(type)` returning `${type}-${Date.now()}-${random8hex}` using `crypto.getRandomValues` on the client and `Math.random` fallback on the server.
  - `lib/format.js` → `formatDuration(ms)` returns `"MM:SS"`, guards non-finite/negative → `"00:00"`; `formatDateTime(iso)` uses `Intl.DateTimeFormat` with `{ month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }`, returns `""` on invalid input.
  - _Requirements: 4.3, 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 3. Author the full agent catalog in `data/`
  - `data/agents.json` — five entries (`recruiter`, `professor`, `investor`, `coding`, `custom`) with every field specified in Design §5. Prompts written in full prose, evaluation criteria with at least four rubric items each, preview metrics with `label/value/justification`.
  - `data/agents.js` — default-export wrapper: `import agents from './agents.json'; export default agents;`.
  - `lib/agents.js` — exports `agents` (array), `agentBySlug(slug)` (O(1) lookup via memoized map), and the `agentSlugs` constant `["recruiter","professor","investor","coding","custom"]`.
  - Add `scripts/smoke-agents-catalog.mjs` which loads `data/agents.json` and asserts all Requirement 11 invariants; non-zero exit on failure.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 4. Implement theme variables and typography in `app/globals.css`
  - Declare `:root` tokens (`--radius`, `--accent: #4285f4`, font stacks, spacing scale).
  - Declare `html[data-theme="dark"]` and `html[data-theme="light"]` palettes per Design §7.
  - Add base body styles (`background: var(--bg)`, `color: var(--text)`, `font-family: var(--font-body)`), focus ring, and reset for headings/buttons/anchors.
  - Add media queries at 960px and 720px documented in §7.
  - _Requirements: 8.4, 13.4_

- [ ] 5. Implement `AppProvider`
  - Create `components/app-provider.js` exporting `AppProvider`, `useAppState`, `useAppActions`.
  - Define `defaultState`, `defaultAgentSlice()`, action constants, and the reducer covering `HYDRATE`, `SET_THEME`, `PUSH_TOAST`, `DISMISS_TOAST`, `PATCH_AGENT`, `CREATE_THREAD`, `DELETE_THREAD`, `PATCH_THREAD`, `CREATE_SESSION`, `DELETE_SESSION`, `PATCH_SESSION`, `APPEND_TRANSCRIPT`.
  - `createSession` also pushes the new `sessionId` into the thread's `sessionIds` and bumps `updatedAt`.
  - `deleteThread` cascades: also removes all sessions for that `threadId`.
  - Warn and no-op on unknown slug/ID (per Requirement 7.5).
  - Reserve `jobsRef = useRef(new Map())` and `autoTriggerRef = useRef(new Set())` for other specs.
  - _Requirements: 4.1, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 9.1_

- [ ] 6. Wire localStorage persistence and theme mirror
  - Inside `AppProvider`: `useReducer(reducer, undefined, () => merge(defaultState, tryRestore()))` where `tryRestore` returns `{}` on the server or on parse error and logs via `console.warn`.
  - Version guard: only read from key `spark-state-v1`.
  - Debounced (200 ms) `useEffect` writes `localStorage.setItem('spark-state-v1', JSON.stringify(state))`; catch `QuotaExceededError` and push a warning toast.
  - `useEffect` mirrors `state.theme` onto `document.documentElement.dataset.theme`.
  - _Requirements: 8.2, 8.3, 8.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [ ] 7. Build the `Shell` component with header and toast host
  - `components/shell.js` renders `<header>` with `<Link href="/">Spark</Link>` (non-interactive on `/` — use `usePathname`) and a theme toggle button.
  - Main content area with max width 1120px and 24px horizontal padding.
  - Toast host: maps `state.toasts` into `<Toast>` subcomponents. Each `<Toast>` has a `useEffect` timer (4000 ms) calling `dismissToast(id)` and a manual dismiss button.
  - _Requirements: 8.2, 9.1, 9.2, 9.3, 9.4, 9.5, 13.1, 13.2, 13.3, 13.4, 13.5_

- [ ] 8. Build the landing page
  - `components/landing-page.js` — hero with tagline and the primary "View agents" CTA; three-step flow cards; secondary bottom CTA.
  - `app/page.js` imports `LandingPage` and renders it inside `<Shell>`.
  - Styles added in `globals.css` (no component-local CSS).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 12.1_

- [ ] 9. Build the agents directory page
  - `components/agents-page.js` — imports `agents` from `lib/agents.js`, renders a grid of five `<Link>` cards; each card shows `name`, `role`, `duration`, `description`.
  - `app/agents/page.js` imports `AgentsPage` and renders it in `<Shell>`.
  - Responsive grid (3 / 2 / 1 columns).
  - Graceful empty state "Unable to load agents" if the import yields no entries.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 12.2_

- [ ] 10. Build the agent detail page (scenario + rubric)
  - `components/agent-detail-page.js` — accepts `{ slug }`; resolves via `agentBySlug`; renders `name`, `longDescription`, `scenario`, and the `evaluationCriteria` list with a "Show more" expander once there are >3 items.
  - Not-found branch renders "Agent not found" with a link back to `/agents`.
  - `app/agents/[slug]/page.js` forwards `params.slug` into the component inside `<Shell>`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 12.3_

- [ ] 11. Add thread creation and thread list to the agent detail page
  - Controlled text input bound to `state.agents[slug].threadName` via `patchAgent(slug, { threadName })`.
  - "Create thread" button disabled when `threadName.trim() === ''`; on click, `createThread(slug, title)`, reset `threadName` to `''`, push toast "Thread created".
  - Render `state.threads[slug]` sorted by `updatedAt` desc — each row shows title, `formatDateTime(createdAt)`, `sessionIds.length`, delete button calling `deleteThread` + toast "Thread deleted".
  - Clicking the row (excluding the delete button) routes to `/agents/${slug}/threads/${id}` via `useRouter().push`.
  - _Requirements: 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 12. Build the thread detail page skeleton and pre-session form
  - `components/thread-detail-page.js` — accepts `{ slug, threadId }`; resolves thread from `state.threads[slug]`; renders not-found branch if absent.
  - Controlled inputs bound through `patchAgent(slug, …)`:
    - `sessionName` (required),
    - `companyUrl` (optional),
    - `customContextText` (optional) labeled with `agent.contextFieldLabel` / `agent.contextFieldDescription`.
  - PDF upload trigger button rendered as a placeholder that calls a stub `handlePdfUpload()` (implementation owned by: research-and-resources).
  - "Start session" button disabled while `sessionName.trim() === ''`.
  - `app/agents/[slug]/threads/[threadId]/page.js` forwards params into the component inside `<Shell>`.
  - _Requirements: 5.1, 5.2, 5.7, 12.4, 12.5_

- [ ] 13. Implement "Start session" flow
  - On click: `patchThread(slug, threadId, { updatedAt: new Date().toISOString() })`, then `createSession(slug, threadId, { sessionName, customContext: customContextText, upload: state.agents[slug].upload })` which returns the new `sessionId`.
  - Then `router.push(\`/session/${slug}?threadId=${threadId}&sessionId=${sessionId}\`)`.
  - Clear the in-form `sessionName` buffer after a successful start.
  - _Requirements: 5.3, 6.1, 6.2, 6.3, 6.4_

- [ ] 14. Render the sessions history on the thread detail page
  - Read `state.sessions[slug]` filtered to `sessionId`s whose `threadId === threadId`, sorted by `startedAt` desc.
  - Each row: `sessionName`, `formatDateTime(startedAt)`, `durationLabel || "—"`, delete button.
  - Clicking a row routes to `/agents/${slug}/sessions/${sessionId}` (page owned by: evaluation-engine — it does not exist yet but the link is stable).
  - Delete button calls `deleteSession(slug, sessionId)` + toast "Session deleted"; also pulls `sessionId` out of the owning thread's `sessionIds` via `patchThread` (done inside the reducer for atomicity).
  - _Requirements: 5.4, 5.5, 5.6_

- [ ] 15. Wire the theme toggle end-to-end
  - Header toggle button in `Shell` flips `state.theme` via `setTheme`.
  - Verify `document.documentElement.dataset.theme` updates synchronously.
  - Verify reload restores the last theme; dark is default.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 16. Add placeholder routes for session-detail and live-session pages
  - `app/agents/[slug]/sessions/[sessionId]/page.js` — returns `<Shell><p>Session detail (owned by: evaluation-engine)</p></Shell>` so the URL resolves without crashing. The owning spec will replace the body.
  - `app/session/[slug]/page.js` — returns `<Shell><p>Live session (owned by: live-session)</p></Shell>` for the same reason.
  - _Requirements: 12.5_

- [ ] 17. QA pass and smoke run
  - Execute the ten manual QA flows from Design §10.
  - Run `node scripts/smoke-agents-catalog.mjs` and confirm green.
  - Test on 1440px, 1024px, 768px, and 600px viewport widths.
  - Run `eslint --fix` over `app/`, `components/`, `lib/`, `data/`.
  - _Requirements: 1.6, 2.5, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4, 11.5_
