# Requirements — Research and Resources

## Introduction

This spec covers three external-data features for Spark: (1) PDF "deck" upload with LLM-driven text cleanup, (2) pre-session research prep that fetches agent-specific external context (company diligence, coding interview question, custom URL brief), and (3) post-session resource discovery that turns `resourceBriefs` from the evaluation engine into ranked learning resources. All three lean on Gemini 2.5-flash via `@google/genai` (direct) and via `@langchain/google-genai` (ReAct agents). Web access is provided by a thin Firecrawl HTTP wrapper.

The feature must block live-session entry until prep is complete so the avatar has the context it needs at the first turn, and must degrade gracefully when optional API keys (Firecrawl, per-purpose Gemini keys) are absent.

## Requirements

### Requirement 1 — PDF upload endpoint

**User story:** As a user preparing for a session, I want to upload a deck or resume PDF so the agent has a grounded knowledge base for the conversation.

#### Acceptance Criteria

1. WHEN a client sends `POST /api/upload-deck` as `multipart/form-data` with field name `deck`, THEN the server SHALL accept the upload using `multer` configured with `dest: 'uploads/'`.
2. WHEN no file is attached, THEN the server SHALL respond `400` with `{ error: "No file uploaded" }`.
3. WHEN the file is a valid PDF, THEN the server SHALL parse it with `pdf-parse` and extract the raw text.
4. WHEN raw text is extracted, THEN the server SHALL send it to Gemini 2.5-flash with a "clean and de-noise this PDF text for use as a knowledge ground" instruction and capture the cleaned text.
5. WHEN cleanup succeeds, THEN the response SHALL be `{ ok:true, fileName, contextPreview: cleanedText.slice(0,1000), contextText: cleanedText }`.
6. WHEN any step throws, THEN the server SHALL respond `500` with `{ error, details }` whose `error` names the failing stage (`"PDF parse failed"`, `"Gemini cleanup failed"`, etc.).

### Requirement 2 — PDF temp-file cleanup

**User story:** As an operator, I want uploaded PDFs to never accumulate on disk so the Render free plan does not run out of space.

#### Acceptance Criteria

1. WHEN the upload handler finishes (success OR failure), THEN it SHALL delete the temp file via `fs.promises.unlink` in a `finally` block.
2. IF unlink itself fails, THEN the handler SHALL `console.error` the unlink error but SHALL NOT override the primary response.

### Requirement 3 — Agent-external-context endpoint

**User story:** As a user starting a session, I want the agent to have already gathered relevant external context so the conversation starts on-topic.

#### Acceptance Criteria

1. WHEN a client sends `POST /api/agent-external-context` with `{ agentSlug, companyUrl?, customContext?, upload?:{contextText} }`, THEN the server SHALL route by `agentSlug`.
2. WHEN `agentSlug === 'professor'`, THEN the server SHALL respond immediately with `{ ok:true, research:null, message:"Professor agent does not use external research." }`.
3. WHEN `agentSlug` is `recruiter` or `investor`, THEN the server SHALL extract a company name from `companyUrl` (host → registered domain → capitalized) or from `customContext`, run the ReAct agent to gather company/product diligence via Firecrawl, and return `{ ok:true, research:{ markdown, sourceUrl?, companyName } }`.
4. WHEN `agentSlug === 'coding'`, THEN the server SHALL extract a company name, run the ReAct agent to search for "<company> coding interview question" (and related phrases), and return `{ ok:true, research:{ markdown, companyName, codingQuestion:{ title, markdown, companyName, sourceUrl } } }`.
5. WHEN `agentSlug === 'custom'`, THEN the server SHALL run the ReAct agent over `companyUrl` + `customContext` and return `{ ok:true, research:{ markdown, sourceUrl? } }`.
6. WHEN neither `companyUrl` nor `customContext` provides a usable signal for a research-capable agent, THEN the server SHALL respond `{ ok:true, research:null, message:"No research signal provided." }` with HTTP 200.

### Requirement 4 — Blocking prep before session

**User story:** As a user, I want the live-session page to wait for prep so I am not dropped into an avatar that has no context.

#### Acceptance Criteria

1. WHEN the user clicks "Start Session" on the thread detail page, THEN the AppProvider SHALL set `state.agents[slug].researchPrep.status = 'processing'` and call `/api/agent-external-context`.
2. WHEN the response returns, THEN the provider SHALL set `researchPrep.status = 'completed'` and store `researchPrep.result = response.research`.
3. WHEN the call fails, THEN the provider SHALL set `researchPrep.status = 'failed'` with `researchPrep.error`.
4. WHEN `agentSlug === 'professor'`, THEN prep SHALL resolve to `completed` with `result = null` in a single round-trip.
5. WHEN the live-session page opens, THEN it SHALL NOT render the avatar or open the WebSocket until `researchPrep.status === 'completed'` (enforced in `live-session` spec; this spec guarantees the flag is set correctly).

### Requirement 5 — Session-resources endpoint

**User story:** As a user who just finished a session, I want curated learning resources that target my specific weaknesses.

#### Acceptance Criteria

1. WHEN a client sends `POST /api/session-resources` with `{ agentSlug, sessionId, resourceBriefs:[{topic, improvement, searchPhrases, resourceTypes}, ...] }`, THEN the server SHALL run one ReAct agent invocation per brief.
2. WHEN each agent invocation completes, THEN the server SHALL return up to 5 ranked resources for that brief in the shape `{ title, url, type, source, reason_relevant }`.
3. WHEN all briefs are processed, THEN the response SHALL be `{ topics:[ { id, brief, resources } ] }` where `id` is a stable `topic-${i}` identifier.
4. IF `resourceBriefs` is empty or missing, THEN the server SHALL respond `400` with `{ error: "resourceBriefs required" }`.

### Requirement 6 — Firecrawl wrapper

**User story:** As a developer, I want one small module that owns Firecrawl so every consumer uses the same contract.

#### Acceptance Criteria

1. WHEN `searchWeb(query, { limit = 5 })` is called, THEN it SHALL `POST https://api.firecrawl.dev/v1/search` with `Authorization: Bearer ${FIRECRAWL_API_KEY}` and JSON body `{ query, limit }`, and return an array of `{ title, url, snippet }`.
2. WHEN `scrapeWebsite(url)` is called, THEN it SHALL `POST https://api.firecrawl.dev/v2/scrape` with the same Authorization header and JSON body `{ url, formats:["markdown"], onlyMainContent:true }`, and return `{ markdown, title }`.
3. WHEN either call returns a non-2xx status, THEN the function SHALL throw an `Error` whose message contains the HTTP status and the first 200 characters of the response body.
4. WHEN `FIRECRAWL_API_KEY` is not set, THEN the function SHALL throw `new Error("FIRECRAWL_API_KEY is not set")` before making any network call.

### Requirement 7 — ReAct agent bounds

**User story:** As an operator on a free tier, I want the research agent to be cost-bounded so runaway loops do not burn budget.

#### Acceptance Criteria

1. WHEN the ReAct agent is constructed, THEN it SHALL be configured with `maxIterations = 6`.
2. WHEN the agent hits the iteration cap before producing a final answer, THEN the server SHALL synthesize a best-effort markdown response from whatever observations were collected and return it.
3. WHEN a tool call throws, THEN the agent SHALL catch the error, surface it as an observation, and continue the loop (not crash the request).

### Requirement 8 — Graceful degradation when keys are absent

**User story:** As a contributor without every API key, I want the server to boot and the product to explain which flows are disabled rather than 500 on startup.

#### Acceptance Criteria

1. WHEN `FIRECRAWL_API_KEY` is absent AND research is requested, THEN the endpoint SHALL respond `200` with `{ ok:true, research:null, message:"Web research disabled (FIRECRAWL_API_KEY missing)." }`.
2. WHEN `GEMINI_API_KEY` is absent AND the fallback chain also fails, THEN the endpoint SHALL respond `503` with `{ error:"No Gemini API key available for <purpose>" }`.
3. WHEN `FIRECRAWL_API_KEY` is absent for `/api/session-resources`, THEN the response SHALL be `{ topics: resourceBriefs.map(brief => ({ id, brief, resources:[] })) }` with a top-level `disabled: true` flag.

### Requirement 9 — Per-purpose Gemini key fallback

**User story:** As an operator, I want to route upload cleanup, coding-question discovery, and resource curation to separate Gemini quotas.

#### Acceptance Criteria

1. WHEN `/api/upload-deck` calls Gemini, THEN it SHALL resolve its API key as `GEMINI_UPLOAD_PREP_API_KEY ?? GEMINI_API_KEY`.
2. WHEN `/api/agent-external-context` runs the coding-question ReAct agent, THEN it SHALL resolve its key as `GEMINI_QUESTION_FINDER_API_KEY ?? GEMINI_API_KEY`.
3. WHEN `/api/agent-external-context` runs any other research agent, THEN it SHALL use `GEMINI_API_KEY`.
4. WHEN `/api/session-resources` runs, THEN it SHALL resolve its key as `GEMINI_RESOURCE_CURATION_API_KEY ?? GEMINI_API_KEY`.

### Requirement 10 — Coding-question shape

**User story:** As the coding agent, I want a fully-formed interview question at start so the first turn can be "Here is your question."

#### Acceptance Criteria

1. WHEN the coding ReAct agent finishes, THEN it SHALL produce a `codingQuestion` object with `title` (≤ 120 chars), `markdown` (problem statement + examples + constraints), `companyName`, and `sourceUrl` (source page if a concrete question was found, otherwise the best search-result URL).
2. WHEN no concrete question can be sourced from search, THEN the agent SHALL synthesize a plausible representative question for that company (e.g. "Two Sum — reportedly asked at $company") and mark `sourceUrl` as the best-ranked search result it inspected.

### Requirement 11 — Auto-trigger resource discovery

**User story:** As a user, I want resources to appear automatically after evaluation so I do not have to press a button for every session.

#### Acceptance Criteria

1. WHEN a completed session has `evaluation.status === 'completed'`, `evaluation.result.resourceBriefs.length > 0`, and `resources.status === 'idle'`, THEN the AppProvider effect SHALL call `fetchSessionResources(slug, sessionId, briefs)`.
2. WHEN the fetch succeeds, THEN `resources.status` SHALL transition `idle → processing → completed` with `topics` populated.
3. WHEN the fetch fails, THEN `resources.status` SHALL be `failed` with `resources.error`, and the session-detail page SHALL render a "Find Resources" retry button.

### Requirement 12 — Frontend upload flow

**User story:** As a user on the thread detail page, I want a single click to attach a deck and see a preview of the cleaned text.

#### Acceptance Criteria

1. WHEN the user selects a PDF via the file input, THEN the AppProvider mutator `uploadDeck(slug, file)` SHALL POST to `/api/upload-deck` and update `state.agents[slug].upload` through `uploading → completed | failed`.
2. WHEN the upload completes, THEN the provider SHALL store `{ fileName, contextText, previewUrl: URL.createObjectURL(file) }` under `state.agents[slug].upload`.
3. WHEN the user clicks "Clear", THEN `clearUpload(slug)` SHALL reset `state.agents[slug].upload` to `{ status:'idle' }` and revoke the `previewUrl`.

### Requirement 13 — Resources panel rendering

**User story:** As a user reviewing my session report, I want the resources grouped by weakness topic so I know exactly what to study.

#### Acceptance Criteria

1. WHEN `state.sessions[slug][i].resources.status === 'completed'`, THEN the session detail page SHALL render one card per entry in `topics`, with the brief's `topic`, `improvement`, and a list of resource links.
2. WHEN status is `processing`, THEN the panel SHALL render a spinner with text "Finding resources…".
3. WHEN status is `failed` OR `idle`, THEN the panel SHALL render a "Find Resources" button that calls `fetchSessionResources`.
