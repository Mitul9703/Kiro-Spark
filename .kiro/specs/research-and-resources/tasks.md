# Tasks — Research and Resources

Sequenced implementation plan. Each task lists the requirement(s) it satisfies.

- [ ] 1. **Create `server/firecrawl.js` wrapper** — implement `searchWeb(query, { limit })` and `scrapeWebsite(url)` against `https://api.firecrawl.dev/v1/search` and `/v2/scrape` with `Bearer ${FIRECRAWL_API_KEY}`, 25 s `AbortController` timeout, descriptive thrown errors on non-2xx, and a startup guard that throws when the env var is missing. _Requirements: 6, 8.1_

- [ ] 2. **Write `scripts/smoke-firecrawl.mjs`** — calls `searchWeb('openai company overview', {limit:3})` and `scrapeWebsite('https://example.com')`, prints results. _Requirements: 6, 10 (testing)_

- [ ] 3. **Create `server/upload.js` with multer + pdf-parse** — wire `multer({ dest:'uploads/', limits:{ fileSize:20*1024*1024 }, fileFilter: pdf-only })`, parse with `pdf-parse`, `finally`-unlink the temp file, return `400` when no file. _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

- [ ] 4. **Add Gemini cleanup to `server/upload.js`** — resolve key `GEMINI_UPLOAD_PREP_API_KEY ?? GEMINI_API_KEY`, send raw text with the cleanup prompt from `design.md` §6, return `{ ok:true, fileName, contextPreview, contextText }`; 503 when no key; 500 with stage-named errors. _Requirements: 1.4, 1.5, 1.6, 8.2, 9.1_

- [ ] 5. **Mount `/api/upload-deck` in `server.js`** — `app.post('/api/upload-deck', upload.single('deck'), handler)`. _Requirements: 1.1_

- [ ] 6. **Write `scripts/smoke-upload-deck.mjs`** — posts `scripts/fixtures/sample.pdf` via `FormData`, asserts `ok:true` and `contextText.length > 0`. _Requirements: 1, 2_

- [ ] 7. **Build the ReAct agent factory in `server/external-context.js`** — `ChatGoogleGenerativeAI({ model:'gemini-2.5-flash' })`, Zod-schemed `searchWeb`/`scrapeWebsite` tools, `createAgent({ llm, tools, maxIterations:6 })`, tool-level try/catch that returns observation strings on error. _Requirements: 7.1, 7.3_

- [ ] 8. **Implement `extractCompanyName` helper** and the four strategy functions — `runCompanyResearch`, `runCodingQuestionResearch` (uses `GEMINI_QUESTION_FINDER_API_KEY ?? GEMINI_API_KEY`), `runCustomResearch`, and the `professor` short-circuit. Apply the system prompts in `design.md` §4. _Requirements: 3.2, 3.3, 3.4, 3.5, 9.2, 9.3, 10.1, 10.2_

- [ ] 9. **Wire `POST /api/agent-external-context`** — parse body, dispatch by `agentSlug`, return the response shapes in `design.md` §2.2; 200+`research:null` when Firecrawl key is absent or no signal was given; 503 when Gemini key chain is exhausted. _Requirements: 3.1, 3.6, 4.4, 8.1, 8.2_

- [ ] 10. **Write `scripts/smoke-external-context.mjs`** — runs all five slugs against a fixed URL, prints the response shapes and asserts the correct `research` field presence/absence for each. _Requirements: 3, 10_

- [ ] 11. **Build `server/resources.js` ReAct agent** — same factory pattern, resource-curation system prompt, resolves key `GEMINI_RESOURCE_CURATION_API_KEY ?? GEMINI_API_KEY`, parses the final message as JSON (strip `json` fences first), returns up to 5 resources per brief. _Requirements: 5.1, 5.2, 7, 9.4_

- [ ] 12. **Wire `POST /api/session-resources`** — validate `resourceBriefs` (400 if empty), fan out with `Promise.all`, assemble `{ topics:[{ id:`topic-${i}`, brief, resources }] }`, short-circuit to `{ topics, disabled:true }` when Firecrawl is disabled. _Requirements: 5.3, 5.4, 8.3_

- [ ] 13. **Write `scripts/smoke-session-resources.mjs`** — posts two hand-crafted briefs, asserts `topics.length === 2` and `topics[0].resources.length <= 5`. _Requirements: 5, 8.3_

- [ ] 14. **Extend `AppProvider` state shape** — add `upload`, `researchPrep` under `state.agents[slug]` and `externalResearch`, `resources` under `state.sessions[slug][i]` with the reducer actions in `design.md` §8. Persist through the existing localStorage debounce. _Requirements: 12.1, 12.2, 13_

- [ ] 15. **Implement the four AppProvider mutators** — `uploadDeck`, `clearUpload` (revokes `previewUrl`), `runResearchPrep`, `fetchSessionResources`. Each registers a `jobKey` in `jobsRef.current` and supports abort. Add the auto-trigger effect for resources. _Requirements: 4.1–4.3, 11, 12_

- [ ] 16. **Hook the UI** — thread detail page: file input → `uploadDeck`; "Start Session" awaits `runResearchPrep` before routing to `/session/[slug]`. Session detail page: Resources panel renders brief cards, spinner while `processing`, "Find Resources" button when `idle|failed`. _Requirements: 4, 11, 12.3, 13_
