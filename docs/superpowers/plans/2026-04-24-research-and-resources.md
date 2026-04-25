# Research and Resources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three external-data flows — PDF upload + cleanup, pre-session external research, post-session resource discovery — and the front-end glue that triggers them at the right points.

**Architecture:** Three POST endpoints in `server/`: `upload.js` (multer + pdf-parse + Gemini cleanup), `external-context.js` (LangChain ReAct over Firecrawl tools, agent-slug-dispatched), `resources.js` (per-brief ReAct fan-out). All Firecrawl I/O goes through `server/firecrawl.js`. Frontend mutators run in AppProvider; "Start Session" awaits `runResearchPrep`; resources auto-trigger after evaluation completes.

**Tech Stack:** Express 5, multer 2, pdf-parse 2, @google/genai, langchain 1.3, @langchain/google-genai, @langchain/core, zod 4, plain JavaScript HTTP for Firecrawl.

---

## Prerequisites

This plan depends on the following being in place before work starts:

- **AppProvider state shape and mutators** from the `agents-and-threads` plan: the reducer, the `state.agents[slug]` / `state.threads[slug]` / `state.sessions[slug]` top-level keys, the `jobsRef = useRef(new Map())` for AbortControllers, and the `patchAgent` / `patchSession` / `pushToast` / `dismissToast` mutators. This plan extends that shape; it does not redefine it.
- **Thread detail page form and "Start Session" navigation** from the `agents-and-threads` plan: the file-input stub and the "Start Session" stub handler must already exist so this plan can replace them rather than write them from scratch.
- **Evaluation results from the `evaluation-engine` plan:** the auto-trigger effect reads `session.evaluation.status` and `session.evaluation.result.resourceBriefs`. If the evaluation plan has not shipped, the resources flow can still be smoke-tested via hand-crafted briefs posted directly to `/api/session-resources`.

Environment (all optional at boot; checked lazily at the call site — see `tech.md`):

- `GEMINI_API_KEY` — baseline Gemini key.
- `GEMINI_UPLOAD_PREP_API_KEY` — overrides for PDF cleanup.
- `GEMINI_QUESTION_FINDER_API_KEY` — overrides for coding-question ReAct.
- `GEMINI_RESOURCE_CURATION_API_KEY` — overrides for session-resources ReAct.
- `FIRECRAWL_API_KEY` — required for any web research/scrape; absence triggers graceful degradation.
- `NEXT_PUBLIC_BACKEND_HTTP_URL` — smoke scripts default to `http://localhost:3000`.

---

## File Map

New files:

- `server/firecrawl.js` — `searchWeb(query, { limit })` and `scrapeWebsite(url)` HTTP wrappers. POSTs to `https://api.firecrawl.dev/v1/search` and `https://api.firecrawl.dev/v2/scrape` with `Authorization: Bearer ${FIRECRAWL_API_KEY}`, 25 s `AbortSignal.timeout(25_000)` (wrapped in `AbortController` for compatibility), descriptive thrown errors on non-2xx.
- `server/upload.js` — multer config (PDF-only filter, 20 MB cap, `dest: 'uploads/'`), `pdf-parse`, Gemini cleanup using `GoogleGenAI` from `@google/genai` with the cleanup prompt in `design.md` §6, `finally`-unlink of the temp file.
- `server/external-context.js` — ReAct factory (`ChatGoogleGenerativeAI` + Zod-typed `searchWeb`/`scrapeWebsite` tools + `createAgent({ maxIterations: 6 })`), `extractCompanyName` helper, four strategy functions (`runCompanyResearch`, `runCodingQuestionResearch`, `runCustomResearch`, `professor` short-circuit), and the Express handler that dispatches on `agentSlug`.
- `server/resources.js` — ReAct factory for resource curation, per-brief `Promise.all` fan-out, JSON-parse of final assistant message (strip ```json fences first), up to 5 resources per brief.
- `scripts/fixtures/sample.pdf` — tiny (< 50 KB) test PDF committed to the repo so smoke scripts are self-contained.
- `scripts/smoke-firecrawl.mjs` — exercises `searchWeb` and `scrapeWebsite`.
- `scripts/smoke-upload-deck.mjs` — multipart POSTs the fixture and asserts `ok:true` and `contextText.length > 0`.
- `scripts/smoke-external-context.mjs` — runs all five agent slugs and asserts response shape.
- `scripts/smoke-session-resources.mjs` — posts two hand-crafted briefs and asserts `topics.length === 2` with `resources.length <= 5`.

Modified files:

- `server.js` — mount `POST /api/upload-deck`, `POST /api/agent-external-context`, `POST /api/session-resources`.
- `components/app-provider.js` — extend default state and reducer with `upload` / `researchPrep` under `state.agents[slug]` and `externalResearch` / `resources` under `state.sessions[slug][i]`. Add mutators `uploadDeck`, `clearUpload`, `runResearchPrep`, `fetchSessionResources`. Add the auto-trigger effect for resources. Reuse existing `jobsRef` and toast/localStorage wiring.
- `components/thread-detail-page.js` — wire the file input to `uploadDeck` / `clearUpload`, render upload status + error, gate "Start Session" on `runResearchPrep`.
- `components/session-detail-page.js` — render the Resources panel (topic cards, spinner while processing, "Find Resources" button when idle/failed).

---

## Tasks

Each task is sequenced so later tasks can be tested only after earlier tasks have shipped. Every task lists the requirement IDs from `requirements.md` that it satisfies and a concrete verification step.

### Task 1 — Firecrawl wrapper

- [ ] 1.1 Create `server/firecrawl.js`. Export `searchWeb(query, { limit = 5 } = {})` and `scrapeWebsite(url)`.
- [ ] 1.2 Both functions throw `new Error("FIRECRAWL_API_KEY is not set")` before any network call when `process.env.FIRECRAWL_API_KEY` is absent.
- [ ] 1.3 `searchWeb` POSTs to `https://api.firecrawl.dev/v1/search` with headers `{ Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' }` and body `JSON.stringify({ query, limit })`. On non-2xx, throw `new Error(\`Firecrawl search ${res.status}: ${(await res.text()).slice(0,200)}\`)`. Normalize `data.data || data.results`into`[{ title, url, snippet }]`.
- [ ] 1.4 `scrapeWebsite` POSTs to `https://api.firecrawl.dev/v2/scrape` with body `JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true })`. Same error shape. Return `{ markdown: data.data?.markdown ?? '', title: data.data?.metadata?.title ?? '' }`.
- [ ] 1.5 Wrap each `fetch` in an `AbortController` with `setTimeout(() => ctrl.abort(), 25_000)`; clear the timeout on completion. Pass `signal: ctrl.signal` to `fetch`.
- [ ] **Verify:** `node -e "import('./server/firecrawl.js').then(m => m.searchWeb('stripe company overview', {limit:2})).then(r => console.log(JSON.stringify(r, null, 2)))"` prints an array of `{title,url,snippet}`.
- [ ] **Requirements:** R6, R8.1.

### Task 2 — Firecrawl smoke script

- [ ] 2.1 Create `scripts/smoke-firecrawl.mjs` that `import 'dotenv/config'`, calls `searchWeb('openai company overview', { limit: 3 })`, prints results, then calls `scrapeWebsite('https://example.com')` and prints `markdown.slice(0, 300)` + `title`.
- [ ] 2.2 Assert both return truthy values; exit non-zero on failure.
- [ ] **Verify:** `node scripts/smoke-firecrawl.mjs` exits 0 and prints a non-empty markdown body.
- [ ] **Requirements:** R6.

### Task 3 — Upload handler (parse + cleanup pipe plumbing)

- [ ] 3.1 Create `server/upload.js`. Export both the `multer` instance and a `uploadDeckHandler(req, res)` async function.
- [ ] 3.2 Multer config: `multer({ dest: 'uploads/', limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf') })`.
- [ ] 3.3 Handler: if `!req.file`, respond `400 { error: 'No file uploaded' }`. Else `const buffer = await fs.promises.readFile(req.file.path)`; parse with `pdfParse(buffer)`; trim `parsed.text`; if empty, throw `new Error('PDF contained no extractable text')` and map to `500 { error: 'PDF parse failed', details: err.message }`.
- [ ] 3.4 Wrap the entire body in `try/catch/finally`. The `finally` block calls `await fs.promises.unlink(req.file.path).catch(e => console.error('unlink failed', e))` — it must NEVER override the primary response.
- [ ] **Verify:** import the module; confirm `multer` instance exposes `.single('deck')`.
- [ ] **Requirements:** R1.1, R1.2, R1.3, R2.1, R2.2.

### Task 4 — Gemini cleanup call

- [ ] 4.1 Inside the handler, resolve `const apiKey = process.env.GEMINI_UPLOAD_PREP_API_KEY ?? process.env.GEMINI_API_KEY`. If falsy, respond `503 { error: 'No Gemini API key available for upload cleanup' }` (still inside the try so `finally` runs).
- [ ] 4.2 `const ai = new GoogleGenAI({ apiKey });` then `const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [{ text: CLEANUP_PROMPT + rawText }] }] });`. Use the prompt verbatim from `design.md` §6.
- [ ] 4.3 `const cleanedText = (response.text ?? '').trim()`. If empty, throw `new Error('Gemini cleanup returned empty text')` → `500 { error: 'Gemini cleanup failed', details: err.message }`.
- [ ] 4.4 Respond `{ ok: true, fileName: req.file.originalname, contextPreview: cleanedText.slice(0, 1000), contextText: cleanedText }`.
- [ ] **Verify:** task 6 covers end-to-end.
- [ ] **Requirements:** R1.4, R1.5, R1.6, R8.2, R9.1.

### Task 5 — Mount upload route

- [ ] 5.1 In `server.js`, import the multer instance and handler: `import { upload, uploadDeckHandler } from './server/upload.js'`.
- [ ] 5.2 Register `app.post('/api/upload-deck', upload.single('deck'), uploadDeckHandler)`.
- [ ] 5.3 Ensure `uploads/` is listed in `.gitignore`.
- [ ] **Verify:** `curl -s http://localhost:3000/api/upload-deck -X POST` (no body) returns `400 {"error":"No file uploaded"}`.
- [ ] **Requirements:** R1.1.

### Task 6 — Upload smoke script + fixture

- [ ] 6.1 Add `scripts/fixtures/sample.pdf` (< 50 KB test PDF, e.g. a single page with lorem ipsum — download or generate).
- [ ] 6.2 Create `scripts/smoke-upload-deck.mjs`. Build a `FormData`, attach `fs.createReadStream('scripts/fixtures/sample.pdf')` as field `deck`, POST to `${NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:3000'}/api/upload-deck`.
- [ ] 6.3 Assert `res.status === 200`, `json.ok === true`, `json.contextText.length > 0`, and `json.contextPreview.length <= 1000`.
- [ ] **Verify:** `npm run dev` in one terminal, `node scripts/smoke-upload-deck.mjs` in another exits 0.
- [ ] **Requirements:** R1, R2.

### Task 7 — ReAct factory for external context

- [ ] 7.1 In `server/external-context.js`, import `createAgent` from `'langchain'`, `ChatGoogleGenerativeAI` from `'@langchain/google-genai'`, `tool` from `'@langchain/core/tools'`, `z` from `'zod'`, and `{ searchWeb, scrapeWebsite }` from `'./firecrawl.js'`.
- [ ] 7.2 Build `searchTool` with schema `z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).optional() })`. Inside the tool body, wrap the `searchWeb` call in `try/catch`; on catch, return `JSON.stringify({ error: e.message })` so the agent receives it as an observation and keeps looping.
- [ ] 7.3 Build `scrapeTool` with schema `z.object({ url: z.string().url() })`. Same try/catch. Truncate returned markdown to 6000 chars.
- [ ] 7.4 Export a `buildAgent({ apiKey, systemPrompt })` factory that constructs `ChatGoogleGenerativeAI({ apiKey, model: 'gemini-2.5-flash', temperature: 0.3 })` and `createAgent({ llm, tools: [searchTool, scrapeTool], maxIterations: 6 })`. Callers supply the system prompt at `invoke` time.
- [ ] **Verify:** covered by task 10.
- [ ] **Requirements:** R7.1, R7.3.

### Task 8 — `extractCompanyName` helper

- [ ] 8.1 In `server/external-context.js`, implement `extractCompanyName({ companyUrl, customContext })`:
  - If `companyUrl`, try `new URL(companyUrl).hostname.replace(/^www\./,'')`, split on `.`, drop last segment, capitalize. Swallow `TypeError` on invalid URL.
  - Else fall through to regex `/\b([A-Z][A-Za-z0-9&.\- ]{2,40})\b/` against `customContext`.
  - Return `null` if neither path yields a result.
- [ ] 8.2 Unit-check inline: `extractCompanyName({ companyUrl: 'https://stripe.com' })` → `'Stripe'`; `extractCompanyName({ companyUrl: 'bad' })` → `null` (falls through to customContext); `extractCompanyName({ customContext: 'interviewing at OpenAI tomorrow' })` → `'OpenAI'`.
- [ ] **Verify:** add a tiny assert block to `scripts/smoke-external-context.mjs` that imports the helper and runs these three cases.
- [ ] **Requirements:** R3.3, R3.4.

### Task 9 — Four strategy functions

- [ ] 9.1 `runCompanyResearch({ companyUrl, customContext, upload })`:
  - If `!process.env.FIRECRAWL_API_KEY`, return `{ ok: true, research: null, message: 'Web research disabled (FIRECRAWL_API_KEY missing).' }`.
  - `const companyName = extractCompanyName({ companyUrl, customContext })`.
  - If no `companyName` and no `customContext`, return `{ ok: true, research: null, message: 'No research signal provided.' }`.
  - Build agent with key `process.env.GEMINI_API_KEY` (throw 503 via a sentinel object if absent). System prompt from `design.md` §4 "Company research". User message includes `companyName`, `companyUrl`, `customContext`, and optional `upload.contextText` summary.
  - Invoke; parse the final assistant text as `markdown`; extract the first URL from the text as `sourceUrl` (simple regex match).
  - Return `{ ok: true, research: { markdown, sourceUrl, companyName } }`.
- [ ] 9.2 `runCodingQuestionResearch({ companyUrl, customContext })`:
  - Same Firecrawl-disabled short-circuit.
  - Key: `process.env.GEMINI_QUESTION_FINDER_API_KEY ?? process.env.GEMINI_API_KEY`. 503 if missing.
  - System prompt from `design.md` §4 "Coding question". User message includes `companyName` derived from inputs.
  - After invocation, take the final markdown. Derive a `codingQuestion` object: `title` = first `# ` line (trimmed, ≤120 chars), `markdown` = full response, `companyName`, `sourceUrl` = first URL mention or `null`.
  - Return `{ ok: true, research: { markdown, companyName, codingQuestion: { title, markdown, companyName, sourceUrl } } }`.
- [ ] 9.3 `runCustomResearch({ companyUrl, customContext, upload })`:
  - Same Firecrawl-disabled short-circuit.
  - If neither `companyUrl` nor `customContext`, return no-signal path.
  - Key: `process.env.GEMINI_API_KEY`. 503 if missing.
  - System prompt from `design.md` §4 "Custom research". User message forwards both inputs and `upload.contextText`.
  - Return `{ ok: true, research: { markdown, sourceUrl } }` (sourceUrl may be absent).
- [ ] 9.4 `professor` short-circuit is handled at the dispatcher level (task 10) — no separate function needed.
- [ ] **Requirements:** R3.2, R3.3, R3.4, R3.5, R9.2, R9.3, R10.1, R10.2, R8.2.

### Task 10 — Express handler + mount

- [ ] 10.1 Export `agentExternalContextHandler(req, res)` that:
  - Reads `{ agentSlug, companyUrl, customContext, upload }` from `req.body`.
  - Dispatches per `design.md` §2.2:
    - `professor` → `res.json({ ok: true, research: null, message: 'Professor agent does not use external research.' })`.
    - `recruiter` / `investor` → await `runCompanyResearch(...)`, forward result.
    - `coding` → await `runCodingQuestionResearch(...)`, forward.
    - `custom` → await `runCustomResearch(...)`, forward.
    - default → `res.status(400).json({ error: \`Unknown agentSlug: ${agentSlug}\` })`.
  - Catches 503-sentinel errors and maps to `res.status(503).json(...)`. All other throws → `res.status(500).json({ error: 'Agent failure', details: err.message })`.
- [ ] 10.2 In `server.js`, register `app.post('/api/agent-external-context', express.json({ limit: '1mb' }), agentExternalContextHandler)`.
- [ ] **Verify:** `curl -s -X POST http://localhost:3000/api/agent-external-context -H 'Content-Type: application/json' -d '{"agentSlug":"professor"}'` returns `{"ok":true,"research":null,"message":"Professor agent does not use external research."}`.
- [ ] **Requirements:** R3.1, R3.6, R4.4, R8.1, R8.2.

### Task 11 — External-context smoke script

- [ ] 11.1 Create `scripts/smoke-external-context.mjs`. For each of `['recruiter','professor','investor','coding','custom']`, POST `{ agentSlug, companyUrl: 'https://stripe.com', customContext: 'Series B FinTech platform' }`.
- [ ] 11.2 Assert: `professor` returns `research === null`. `recruiter` / `investor` return `research.markdown` (string, length > 100) and `research.companyName === 'Stripe'`. `coding` returns `research.codingQuestion.title` (string ≤ 120 chars) and `research.codingQuestion.markdown`. `custom` returns `research.markdown`.
- [ ] 11.3 Append the `extractCompanyName` unit-check from task 8.
- [ ] **Verify:** `node scripts/smoke-external-context.mjs` exits 0.
- [ ] **Requirements:** R3, R10.

### Task 12 — Resources ReAct + fan-out

- [ ] 12.1 In `server/resources.js`, reuse the same ReAct factory pattern (inline — not shared with `external-context.js` per `design.md` §4). Key: `process.env.GEMINI_RESOURCE_CURATION_API_KEY ?? process.env.GEMINI_API_KEY`. 503 if missing.
- [ ] 12.2 Implement `runResourceAgent(brief)` using the "Resource curation" system prompt from `design.md` §4. User message includes `topic`, `improvement`, `searchPhrases`, `resourceTypes`.
- [ ] 12.3 After invocation, extract the final message text, strip leading/trailing `json / ` fences, `JSON.parse`. On parse failure, `console.error` and return `[]`.
- [ ] 12.4 Validate each resource has `{ title, url, type, source, reason_relevant }` and slice to 5.
- [ ] 12.5 Export `sessionResourcesHandler(req, res)`:
  - Read `{ agentSlug, sessionId, resourceBriefs }`.
  - If `!Array.isArray(resourceBriefs) || resourceBriefs.length === 0`, respond `400 { error: 'resourceBriefs required' }`.
  - If `!process.env.FIRECRAWL_API_KEY`, respond `200 { topics: resourceBriefs.map((brief,i) => ({ id: \`topic-${i}\`, brief, resources: [] })), disabled: true }`.
  - Else `const results = await Promise.all(resourceBriefs.map(runResourceAgent))` → `res.json({ topics: resourceBriefs.map((brief,i) => ({ id: \`topic-${i}\`, brief, resources: results[i] })) })`.
- [ ] 12.6 Mount `app.post('/api/session-resources', express.json({ limit: '1mb' }), sessionResourcesHandler)` in `server.js`.
- [ ] **Verify:** covered by task 13.
- [ ] **Requirements:** R5.1, R5.2, R5.3, R5.4, R7, R8.3, R9.4.

### Task 13 — Resources smoke script

- [ ] 13.1 Create `scripts/smoke-session-resources.mjs`. POST two briefs: e.g. `{ topic: 'STAR storytelling', improvement: 'Quantify impact in the Result step', searchPhrases: ['STAR method examples', 'behavioral interview quantified impact'], resourceTypes: ['article','video'] }` and one for a coding topic.
- [ ] 13.2 Assert: `topics.length === 2`, every `topics[i].id === \`topic-${i}\``, every `topics[i].resources.length <= 5`, and when `disabled` is absent each resource has required keys.
- [ ] 13.3 Also assert the 400 path: POST with empty `resourceBriefs` → expect `400`.
- [ ] **Verify:** `node scripts/smoke-session-resources.mjs` exits 0.
- [ ] **Requirements:** R5, R8.3.

### Task 14 — AppProvider state + reducer extension

- [ ] 14.1 In `components/app-provider.js`, extend `defaultAgentSlice()` so each agent slice carries:
  ```js
  upload: { status: 'idle', fileName: null, contextText: null, previewUrl: null, error: null },
  researchPrep: { status: 'idle', result: null, error: null },
  ```
  (Replacing the `researchPrep: null` default declared in the `agents-and-threads` plan.)
- [ ] 14.2 Extend the session-record factory so every new session carries:
  ```js
  externalResearch: null,
  resources: {
    status: 'idle',
    briefs: [],
    topics: [],
    error: null,
    startedAt: null,
    completedAt: null,
  },
  ```
- [ ] 14.3 Add reducer action types: `UPLOAD/START`, `UPLOAD/COMPLETE`, `UPLOAD/FAIL`, `UPLOAD/CLEAR`, `RESEARCH_PREP/START`, `RESEARCH_PREP/COMPLETE`, `RESEARCH_PREP/FAIL`, `RESOURCES/START`, `RESOURCES/COMPLETE`, `RESOURCES/FAIL`. Each action carries `{ slug }` or `{ slug, sessionId }` plus a payload; the reducer merges onto the correct slice immutably.
- [ ] 14.4 Confirm the existing 200 ms localStorage debounce still serializes the extended shape (it does — it stringifies the whole state).
- [ ] **Verify:** open DevTools, inspect `localStorage['spark-state-v1']` after a page load; confirm the new keys are present with default values.
- [ ] **Requirements:** R12.1, R12.2, R13.

### Task 15 — Four mutators + auto-trigger effect

- [ ] 15.1 `uploadDeck(slug, file)`:
  - Build a `FormData` with field `deck`.
  - Dispatch `UPLOAD/START { slug, fileName: file.name }` → `status: 'uploading'`, set `previewUrl: URL.createObjectURL(file)`.
  - Register `jobsRef.current.set(\`upload:${slug}\`, ctrl)`where`ctrl = new AbortController()`.
  - `fetch('/api/upload-deck', { method: 'POST', body: form, signal: ctrl.signal })`.
  - On success: dispatch `UPLOAD/COMPLETE { slug, fileName, contextText, contextPreview }`.
  - On failure: dispatch `UPLOAD/FAIL { slug, error }` and `pushToast({ message, kind: 'error' })`.
  - Always `jobsRef.current.delete(\`upload:${slug}\`)`.
- [ ] 15.2 `clearUpload(slug)`:
  - Read current `previewUrl` from state; if set, `URL.revokeObjectURL(previewUrl)`.
  - Dispatch `UPLOAD/CLEAR { slug }` → reset to the default shape.
- [ ] 15.3 `runResearchPrep(slug, { agentSlug, companyUrl, customContext, upload })`:
  - Dispatch `RESEARCH_PREP/START { slug }`.
  - Register `researchPrep:${slug}` in `jobsRef`.
  - `fetch('/api/agent-external-context', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({...}), signal })`.
  - On success: dispatch `RESEARCH_PREP/COMPLETE { slug, result }` where `result = json.research` (may be `null` for professor or no-signal).
  - On failure: dispatch `RESEARCH_PREP/FAIL { slug, error }`.
  - Return a promise that resolves when the dispatch completes so `ThreadDetailPage` can `await` it.
- [ ] 15.4 `fetchSessionResources(slug, sessionId, briefs)`:
  - Dispatch `RESOURCES/START { slug, sessionId, briefs }` (sets `status: 'processing'`, `startedAt: Date.now()`).
  - Register `resources:${sessionId}` in `jobsRef`.
  - POST to `/api/session-resources` with `{ agentSlug: slug, sessionId, resourceBriefs: briefs }`.
  - On success: dispatch `RESOURCES/COMPLETE { slug, sessionId, topics: json.topics, disabled: json.disabled ?? false }`.
  - On failure: dispatch `RESOURCES/FAIL { slug, sessionId, error }`.
- [ ] 15.5 Auto-trigger effect:
  ```js
  useEffect(() => {
    for (const slug of Object.keys(state.sessions)) {
      (state.sessions[slug] ?? []).forEach(session => {
        const briefs = session.evaluation?.result?.resourceBriefs;
        if (session.evaluation?.status === 'completed'
            && Array.isArray(briefs) && briefs.length > 0
            && session.resources?.status === 'idle'
            && !jobsRef.current.has(\`resources:\${session.id}\`)) {
          actions.fetchSessionResources(slug, session.id, briefs);
        }
      });
    }
  }, [state.sessions]);
  ```
  Use `autoTriggerRef` (already reserved by the `agents-and-threads` plan) to de-dupe if re-entrancy is possible.
- [ ] **Verify:** in DevTools console, call `window.__sparkActions.uploadDeck('recruiter', file)` (expose via `useEffect` during manual QA); observe state transitions `uploading → completed`.
- [ ] **Requirements:** R4.1, R4.2, R4.3, R11, R12.

### Task 16 — Thread detail page: upload UI

- [ ] 16.1 In `components/thread-detail-page.js`, add a `<input type="file" accept="application/pdf">` bound to `uploadDeck`.
- [ ] 16.2 Render status text based on `state.agents[slug].upload.status`:
  - `idle` → "Attach a deck or resume PDF (optional)".
  - `uploading` → "Uploading…".
  - `completed` → show `fileName` + a "Clear" button calling `clearUpload(slug)`.
  - `failed` → show `error` + a retry affordance (re-select the file).
- [ ] 16.3 When `completed`, render a small `<details>` with `upload.contextText.slice(0, 1000)` as a sanity preview.
- [ ] **Verify:** manual QA — upload `scripts/fixtures/sample.pdf` via the UI; see `fileName` and preview render.
- [ ] **Requirements:** R12.3, R13 (partial).

### Task 17 — Thread detail page: blocking "Start Session"

- [ ] 17.1 Replace the existing "Start Session" stub handler with:
  ```js
  async function startSession() {
    patchThread(slug, threadId, { updatedAt: new Date().toISOString() });
    const sessionId = createSession(slug, threadId, {
      sessionName, customContext: customContextText,
      upload: state.agents[slug].upload.status === 'completed' ? { ... snapshot ... } : null,
    });
    await actions.runResearchPrep(slug, {
      agentSlug: slug,
      companyUrl: state.agents[slug].companyUrl,
      customContext: customContextText,
      upload: state.agents[slug].upload,
    });
    const finalStatus = stateRef.current.agents[slug].researchPrep.status;
    if (finalStatus === 'completed') {
      // snapshot researchPrep.result onto the session row for downstream consumers
      patchSession(slug, sessionId, { externalResearch: stateRef.current.agents[slug].researchPrep.result });
      router.push(\`/session/\${slug}?threadId=\${threadId}&sessionId=\${sessionId}\`);
    } else {
      pushToast({ message: stateRef.current.agents[slug].researchPrep.error ?? 'Research prep failed', kind: 'error' });
    }
  }
  ```
- [ ] 17.2 Disable the button while `researchPrep.status === 'processing'` and render an inline "Prepping research…" label.
- [ ] 17.3 For `professor`, the call returns immediately with `result: null`; navigation proceeds and `externalResearch` is persisted as `null`. No behavioral special-case needed in the UI — the server handles the short-circuit.
- [ ] **Verify:** manual QA — start a Recruiter session with `companyUrl: https://stripe.com`; observe button disables briefly, then route transitions to `/session/recruiter?...`; inspect state to see `externalResearch.companyName === 'Stripe'`.
- [ ] **Requirements:** R4.1, R4.2, R4.3, R4.4.

### Task 18 — Session detail page: resources panel

- [ ] 18.1 In `components/session-detail-page.js`, locate the session record via `state.sessions[slug].find(s => s.id === sessionId)`. Read `session.resources`.
- [ ] 18.2 Render states:
  - `idle` or `failed` → render a "Find Resources" button that calls `fetchSessionResources(slug, sessionId, session.evaluation.result.resourceBriefs)`. If `failed`, also render the error text.
  - `processing` → spinner + text "Finding resources…".
  - `completed` → map `session.resources.topics` to topic cards. Each card shows `brief.topic` as header, `brief.improvement` as body, and `resources` as a `<ul>` of `<a href={url} target="_blank" rel="noopener noreferrer">{title}</a>` followed by a small muted `{type} · {source} · {reason_relevant}` line.
- [ ] 18.3 If `session.resources.topics[0]?.resources.length === 0` and `disabled` flag was flagged at dispatch time (persisted via reducer), render a "Web research disabled" note instead of empty cards.
- [ ] **Verify:** manual QA — end a Recruiter session, wait for evaluation to complete, observe the resources panel auto-populate.
- [ ] **Requirements:** R11, R13.

### Task 19 — Manual QA pass

- [ ] 19.1 Upload a PDF → `contextPreview` reads as clean prose; "Clear" revokes the `previewUrl` (verify via `URL.createObjectURL` count in DevTools).
- [ ] 19.2 Start a Recruiter thread with `stripe.com` → `researchPrep.result.companyName === 'Stripe'`, markdown mentions Stripe; `externalResearch` persists on the session row.
- [ ] 19.3 Start a Coding thread with `google.com` → `codingQuestion.title` present, markdown contains a problem statement.
- [ ] 19.4 Start a Professor thread → prep resolves < 500 ms with `result === null`, navigation still proceeds.
- [ ] 19.5 End a Recruiter session that produced ≥ 2 `resourceBriefs` → resources panel auto-fills within ~30 s.
- [ ] 19.6 Unset `FIRECRAWL_API_KEY` → re-run 2 and 5 → confirm no-research markdown note and "disabled" resources note.
- [ ] 19.7 Unset `GEMINI_API_KEY` entirely → confirm `/api/upload-deck` and `/api/agent-external-context` each return `503` with the purpose-named error.
- [ ] **Requirements:** all.

---

## Verification model

- **Smoke scripts** under `scripts/` are the per-endpoint regression check (no automated test pyramid per `tech.md`). Each script: loads `.env` via `import 'dotenv/config'`, reads `NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:3000'`, POSTs a fixture, asserts the response shape, and exits non-zero on failure.
- **Manual click flows**: upload PDF → observe preview; click "Start Session" → observe prep spinner, then navigation; end a session → observe resources panel auto-fill; unset `FIRECRAWL_API_KEY` → observe graceful-degradation messaging.
- **Environment toggles** are the primary test matrix: all keys present (happy path), `FIRECRAWL_API_KEY` absent (graceful degradation), `GEMINI_API_KEY` absent (503).

Every task has a `**Verify:**` line that must produce the stated observation before moving on. Do not commit a task as complete without running the verification step.

---

## Contract handoff

This spec extends the `AppProvider` state shape declared by `agents-and-threads`:

```js
state.agents[slug].upload = {
  status: 'idle' | 'uploading' | 'completed' | 'failed',
  fileName: string | null,
  contextText: string | null,
  previewUrl: string | null,   // object URL, revoked on clear
  error: string | null,
}

state.agents[slug].researchPrep = {
  status: 'idle' | 'processing' | 'completed' | 'failed',
  result: null | {
    markdown: string,
    sourceUrl?: string,
    companyName?: string,
    codingQuestion?: { title, markdown, companyName, sourceUrl },
  },
  error: string | null,
}

state.sessions[slug][i].externalResearch =
  null | { markdown, sourceUrl?, companyName?, codingQuestion? }
  // snapshot of researchPrep.result taken at the moment the session is started,
  // so later evaluations/comparisons can read it deterministically.

state.sessions[slug][i].resources = {
  status: 'idle' | 'processing' | 'completed' | 'failed',
  briefs: [],  // mirror of evaluation.result.resourceBriefs at dispatch time
  topics: [],  // [{ id: `topic-${i}`, brief, resources: [{title,url,type,source,reason_relevant}] }]
  disabled?: boolean,  // true when Firecrawl key is absent
  error: string | null,
  startedAt: number | null,
  completedAt: number | null,
}
```

**`researchPrep` blocking semantics (consumed by `live-session`):**

- `live-session` must NOT open the `/api/live` WebSocket or render the Anam avatar until `state.agents[slug].researchPrep.status === 'completed'`. This spec guarantees the flag is set correctly by the time `router.push('/session/...')` fires from the thread detail page.
- For `agentSlug === 'professor'`, `researchPrep.status` transitions `idle → processing → completed` in a single round-trip with `result === null`. The live-session gate treats `completed + result:null` as valid.
- On `failed`, the thread detail page does NOT navigate to `/session/...`; the user stays on the thread page and sees a toast. The live-session page never runs in a `failed` prep state.

**Mutators added to `useAppActions()`:**

```js
uploadDeck(slug, file); // returns void
clearUpload(slug); // returns void
runResearchPrep(slug, { agentSlug, companyUrl, customContext, upload }); // returns Promise<void>
fetchSessionResources(slug, sessionId, briefs); // returns Promise<void>
```

All four register a `jobKey` in the shared `jobsRef.current` (keys: `upload:${slug}`, `researchPrep:${slug}`, `resources:${sessionId}`). Aborts from the existing session-lifecycle cleanup path (declared in `agents-and-threads`) will cancel any in-flight job.

**Smoke-script contract:** `scripts/smoke-upload-deck.mjs`, `scripts/smoke-external-context.mjs`, `scripts/smoke-session-resources.mjs`, and `scripts/smoke-firecrawl.mjs` are the regression checks for this spec. Any future change to the endpoint request/response shapes must update the corresponding smoke script in the same commit.
