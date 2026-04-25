# Design — Research and Resources

## 1. Overview

Three backend endpoints plus a shared Firecrawl wrapper and a shared LangChain ReAct agent pattern. The frontend consumes them through four AppProvider mutators and one auto-trigger effect. All LLM calls use Gemini 2.5-flash. All web access goes through Firecrawl's `/v1/search` and `/v2/scrape` HTTP endpoints — there is no Firecrawl SDK.

Rationale: the three endpoints share enough pattern (ReAct loop over `searchWeb` + `scrapeWebsite` with Zod-validated tools) that one agent factory is reused, but each endpoint owns its own system prompt and response shape because the downstream consumers differ.

## 2. Endpoints

### 2.1 `POST /api/upload-deck` (`server/upload.js`)

**Request:** `multipart/form-data` with field `deck` (single file, `.pdf`).

**Middleware:** `multer({ dest: 'uploads/', limits: { fileSize: 20 * 1024 * 1024 } }).single('deck')`.

**Handler flow:**
1. If `!req.file` → `res.status(400).json({ error:"No file uploaded" })`.
2. `const buffer = await fs.promises.readFile(req.file.path)`.
3. `const parsed = await pdfParse(buffer); const rawText = parsed.text.trim()`.
4. Resolve key: `const apiKey = process.env.GEMINI_UPLOAD_PREP_API_KEY || process.env.GEMINI_API_KEY`.
5. If `!apiKey` → `res.status(503).json({ error:"No Gemini API key available for upload cleanup" })`.
6. Call `ai.models.generateContent({ model:'gemini-2.5-flash', contents:[{ role:'user', parts:[{ text: PROMPT + rawText }] }] })` where `ai = new GoogleGenAI({ apiKey })`.
7. `const cleanedText = response.text.trim()`.
8. Respond `{ ok:true, fileName: req.file.originalname, contextPreview: cleanedText.slice(0,1000), contextText: cleanedText }`.
9. `finally { await fs.promises.unlink(req.file.path).catch(e => console.error('unlink failed', e)) }`.

**Error responses:**
- `400` `{ error:"No file uploaded" }`
- `500` `{ error:"PDF parse failed", details: err.message }`
- `500` `{ error:"Gemini cleanup failed", details: err.message }`

### 2.2 `POST /api/agent-external-context` (`server/external-context.js`)

**Request body:**
```json
{
  "agentSlug": "recruiter|professor|investor|coding|custom",
  "companyUrl": "https://stripe.com",
  "customContext": "free-form notes",
  "upload": { "contextText": "cleaned PDF text" }
}
```

**Dispatch:**

```js
switch (agentSlug) {
  case 'professor':
    return res.json({ ok:true, research:null, message:'Professor agent does not use external research.' });
  case 'recruiter':
  case 'investor':
    return res.json(await runCompanyResearch({ companyUrl, customContext, upload }));
  case 'coding':
    return res.json(await runCodingQuestionResearch({ companyUrl, customContext }));
  case 'custom':
    return res.json(await runCustomResearch({ companyUrl, customContext, upload }));
  default:
    return res.status(400).json({ error:`Unknown agentSlug: ${agentSlug}` });
}
```

**Response shapes:**
- `recruiter` / `investor`: `{ ok:true, research: { markdown, sourceUrl, companyName } }`
- `coding`: `{ ok:true, research: { markdown, companyName, codingQuestion:{ title, markdown, companyName, sourceUrl } } }`
- `custom`: `{ ok:true, research: { markdown, sourceUrl? } }`
- no-signal path: `{ ok:true, research:null, message:"No research signal provided." }`
- Firecrawl-disabled path: `{ ok:true, research:null, message:"Web research disabled (FIRECRAWL_API_KEY missing)." }`

### 2.3 `POST /api/session-resources` (`server/resources.js`)

**Request body:**
```json
{
  "agentSlug": "recruiter",
  "sessionId": "session-1735000000000-a1b2c3d4",
  "resourceBriefs": [
    { "topic": "STAR storytelling", "improvement": "Quantify impact in the Result step",
      "searchPhrases": ["STAR method examples", "behavioral interview quantified impact"],
      "resourceTypes": ["article","video"] }
  ]
}
```

**Handler flow:**
1. Validate `resourceBriefs` is a non-empty array → else `400`.
2. For each brief, run `await runResourceAgent(brief)` concurrently via `Promise.all`.
3. Assemble `{ topics: briefs.map((brief, i) => ({ id:`topic-${i}`, brief, resources: results[i] })) }`.
4. If `FIRECRAWL_API_KEY` missing, short-circuit with `{ topics: ..., disabled:true }` and empty `resources` arrays.

**Resource object shape:** `{ title, url, type:'article'|'video'|'docs'|'course'|'repo'|'other', source:'firecrawl-search'|'firecrawl-scrape'|'llm-synthesis', reason_relevant:string }`.

## 3. Firecrawl wrapper (`server/firecrawl.js`)

```js
export async function searchWeb(query, { limit = 5 } = {}) { ... }
export async function scrapeWebsite(url) { ... }
```

**`searchWeb` implementation:**
- Guard: throw `new Error("FIRECRAWL_API_KEY is not set")` if absent.
- `fetch('https://api.firecrawl.dev/v1/search', { method:'POST', headers:{ 'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type':'application/json' }, body: JSON.stringify({ query, limit }) })`.
- If `!res.ok` → throw `new Error(\`Firecrawl search ${res.status}: ${(await res.text()).slice(0,200)}\`)`.
- Parse JSON; normalize `data.data` (or `data.results`) into `[{ title, url, snippet }]`.

**`scrapeWebsite` implementation:**
- Same guard.
- `fetch('https://api.firecrawl.dev/v2/scrape', { method:'POST', headers, body: JSON.stringify({ url, formats:['markdown'], onlyMainContent:true }) })`.
- Same error handling.
- Return `{ markdown: data.data?.markdown ?? '', title: data.data?.metadata?.title ?? '' }`.

**Timeout:** wrap each `fetch` in `AbortController` with `setTimeout(() => ctrl.abort(), 25_000)` and clear it on completion.

## 4. ReAct agent design

**Factory** (inlined in `external-context.js` and `resources.js` — not a shared module because prompt differs):

```js
import { createAgent } from 'langchain';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchWeb, scrapeWebsite } from './firecrawl.js';

const searchTool = tool(async ({ query, limit }) => {
  const results = await searchWeb(query, { limit: limit ?? 5 });
  return JSON.stringify(results);
}, {
  name: 'searchWeb',
  description: 'Search the web. Returns up to `limit` results as JSON [{title,url,snippet}].',
  schema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).optional() }),
});

const scrapeTool = tool(async ({ url }) => {
  const page = await scrapeWebsite(url);
  return JSON.stringify({ title: page.title, markdown: page.markdown.slice(0, 6000) });
}, {
  name: 'scrapeWebsite',
  description: 'Fetch a single URL and return its main-content markdown. Truncated to 6000 chars.',
  schema: z.object({ url: z.string().url() }),
});

const model = new ChatGoogleGenerativeAI({ apiKey, model: 'gemini-2.5-flash', temperature: 0.3 });
const agent = createAgent({ llm: model, tools: [searchTool, scrapeTool], maxIterations: 6 });
```

**Invocation:** `const result = await agent.invoke({ messages: [{ role:'system', content: SYSTEM_PROMPT }, { role:'user', content: USER_PROMPT }] });` then extract the final assistant message content.

**System prompts:**

*Company research (recruiter / investor):*
```
You are a diligence analyst. Produce a compact markdown brief of the company so
an interviewer or investor can discuss it credibly. Steps:
1) Call searchWeb with "<company> company overview" and "<company> product".
2) Pick the two strongest URLs and call scrapeWebsite on them.
3) Synthesize a ~300-word markdown brief with sections:
   ## Company  ## Product  ## Traction / Market  ## Talking points
4) End with a "Source" line linking the single best URL.
Do not invent facts. If evidence is thin, say so.
```

*Coding question:*
```
You are sourcing a representative coding-interview question asked at <company>.
Steps:
1) searchWeb for "<company> coding interview question", "<company> leetcode", "<company> technical interview".
2) Inspect the strongest result with scrapeWebsite.
3) If a concrete problem is found, restate it as markdown:
   # <Problem title>
   ## Problem  ## Examples  ## Constraints
4) If no concrete problem is sourced, synthesize a plausible one for this company
   and label it "reportedly asked".
Return ONLY the markdown. Do not add commentary.
```

*Custom research:*
```
You are helping the user prep for a custom scenario. Inputs: companyUrl, customContext.
Steps: searchWeb for terms drawn from the inputs, scrape the best match, produce a
~250-word markdown brief with a "## Context" and "## Talking points" section.
```

*Resource curation (one call per brief):*
```
You are curating up to 5 learning resources for the user's weakness: "<topic>".
Improvement goal: "<improvement>". Preferred types: <resourceTypes>.
Steps:
1) searchWeb using each phrase in <searchPhrases>.
2) Inspect the top 1-2 results with scrapeWebsite to confirm relevance.
3) Return a JSON array (valid JSON, no code fences) of up to 5 resources:
   [{ "title":"", "url":"", "type":"article|video|docs|course|repo|other",
      "source":"firecrawl-search|firecrawl-scrape",
      "reason_relevant":"one sentence" }]
Rank by specificity to the improvement goal. Do not include generic homepages.
```

**Output parsing:** for resource curation, parse the final message with `JSON.parse` after stripping any ```json fences; on parse failure, return `[]` and log.

**Retry policy:** no retries. If the agent throws, bubble the error to the endpoint which returns `500 { error:"Agent failure", details }`. Tool-level errors are caught inside the tool wrapper and returned as observation strings so the agent can keep looping.

## 5. Per-agent research behavior

| agentSlug | Strategy | Response `research` shape |
|-----------|----------|---------------------------|
| `recruiter` | ReAct company brief (search+scrape) | `{ markdown, sourceUrl, companyName }` |
| `professor` | Short-circuit, no network | `null` + `message` |
| `investor` | ReAct company brief, investor-angle prompt | `{ markdown, sourceUrl, companyName }` |
| `coding` | ReAct to source coding question, fallback synthesis | `{ markdown, companyName, codingQuestion:{ title, markdown, companyName, sourceUrl } }` |
| `custom` | ReAct over URL + customContext | `{ markdown, sourceUrl? }` |

**Company-name extraction:**
```js
function extractCompanyName({ companyUrl, customContext }) {
  if (companyUrl) {
    try {
      const host = new URL(companyUrl).hostname.replace(/^www\./, '');
      const base = host.split('.').slice(0, -1).join('.') || host;
      return base.charAt(0).toUpperCase() + base.slice(1);
    } catch { /* fall through */ }
  }
  const m = (customContext || '').match(/\b([A-Z][A-Za-z0-9&.\- ]{2,40})\b/);
  return m ? m[1].trim() : null;
}
```

## 6. PDF processing

**Multer config:**
```js
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});
```

**pdf-parse usage:**
```js
import pdfParse from 'pdf-parse';
const buf = await fs.promises.readFile(req.file.path);
const parsed = await pdfParse(buf);
const rawText = (parsed.text || '').trim();
if (!rawText) throw new Error('PDF contained no extractable text');
```

**Cleanup prompt template** (used verbatim in `upload.js`):
```
You are preparing raw text extracted from a PDF so it can be used as grounding
context for a voice AI rehearsal agent.

Do:
- Remove page headers, page numbers, footers, repeated navigation chrome, and
  scanning artifacts.
- Collapse broken line wraps into flowing paragraphs.
- Preserve bullet lists, numbered lists, headings, and any tables as simple
  markdown.
- Preserve technical terms, numbers, company/product names, dates, and code
  exactly as written.

Do not:
- Do not summarize or paraphrase. The output should contain the same facts as
  the input, just cleaned.
- Do not add any commentary, preface, or closing.
- Do not wrap the whole output in a code fence.

Output: the cleaned text only.

--- RAW PDF TEXT ---
<rawText>
```

## 7. Frontend integration

### 7.1 AppProvider mutators (added to the provider from `agents-and-threads`)

```js
uploadDeck(slug, file)                   // POST /api/upload-deck
clearUpload(slug)                        // local only; revokes previewUrl
runResearchPrep(slug, { agentSlug, companyUrl, customContext, upload })
                                         // POST /api/agent-external-context
fetchSessionResources(slug, sessionId, briefs)
                                         // POST /api/session-resources
```

All four manage an entry in the `jobsRef.current: Map<jobKey, AbortController>` from the `agents-and-threads` spec. Job keys: `upload:${slug}`, `researchPrep:${slug}`, `resources:${sessionId}`.

### 7.2 Blocking semantics for prep

- Thread detail page "Start Session" handler:
  ```js
  await actions.runResearchPrep(slug, { agentSlug:slug, companyUrl, customContext, upload });
  if (state.agents[slug].researchPrep.status === 'completed') router.push(`/session/${slug}`);
  else toast.error(state.agents[slug].researchPrep.error ?? 'Research prep failed');
  ```
- Session page does not open the WS until `researchPrep.status === 'completed'` — that gate lives in the `live-session` spec but is fed by the flag this spec sets.

### 7.3 Auto-trigger effect for resources

In `AppProvider`:
```js
useEffect(() => {
  for (const slug of Object.keys(state.sessions)) {
    state.sessions[slug].forEach((session, i) => {
      const briefs = session.evaluation?.result?.resourceBriefs;
      if (session.evaluation?.status === 'completed'
          && Array.isArray(briefs) && briefs.length > 0
          && session.resources?.status === 'idle') {
        actions.fetchSessionResources(slug, session.id, briefs);
      }
    });
  }
}, [state.sessions]);
```

## 8. Contract changes

Additions to `AppProvider` state (extending `agents-and-threads`):

```js
state.agents[slug].upload = {
  status: 'idle' | 'uploading' | 'completed' | 'failed',
  fileName: string | null,
  contextText: string | null,
  previewUrl: string | null,       // object URL, revoked on clear
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

state.sessions[slug][i].externalResearch = // snapshot of researchPrep.result at session start
  null | { markdown, sourceUrl?, companyName? }

state.sessions[slug][i].resources = {
  status: 'idle' | 'processing' | 'completed' | 'failed',
  briefs: [],                      // mirror of evaluation.result.resourceBriefs at dispatch time
  topics: [],                      // [{ id, brief, resources:[{title,url,type,source,reason_relevant}] }]
  error: string | null,
  startedAt: number | null,
  completedAt: number | null,
}
```

Mutator signatures are declared in Section 7.1. All mutators dispatch reducer actions of type `UPLOAD/*`, `RESEARCH_PREP/*`, `RESOURCES/*` and are persisted through the existing debounced localStorage sync.

## 9. Error handling

| Scenario | Status | Response body | Client behavior |
|----------|--------|---------------|-----------------|
| `GEMINI_API_KEY` missing (and purpose fallback missing) | 503 | `{ error:"No Gemini API key available for <purpose>" }` | Toast; mark researchPrep `failed`. |
| `FIRECRAWL_API_KEY` missing, research requested | 200 | `{ ok:true, research:null, message }` | Proceed to session with no external context. |
| `FIRECRAWL_API_KEY` missing, resources requested | 200 | `{ topics:[...empty], disabled:true }` | Render briefs with "Web research disabled" notice. |
| Firecrawl 4xx/5xx | 500 | `{ error:"Firecrawl request failed", details }` | Toast; researchPrep `failed`, resources `failed` with retry button. |
| Scrape timeout (>25s) | 500 | `{ error:"Firecrawl scrape timeout" }` | Same. |
| Agent loop hits cap | 200 | Best-effort markdown | No client-side surfacing; acceptable output. |
| `pdfParse` throws | 500 | `{ error:"PDF parse failed", details }` | Toast; upload stays `failed`. |
| `pdfParse` returns empty text | 500 | `{ error:"PDF contained no extractable text" }` | Toast. |
| Upload file > 20 MB | 413 (multer default) | `{ error:"File too large" }` | Toast. |

## 10. Testing strategy

**Manual flows:**
1. Upload a known-good PDF → inspect `contextPreview` for clean prose.
2. Start a Recruiter thread with `stripe.com` → verify `researchPrep.result.companyName === 'Stripe'` and markdown mentions Stripe.
3. Start a Coding thread with `google.com` → verify `codingQuestion.title` is present and `markdown` contains a problem statement.
4. Start a Professor thread → prep resolves in < 500 ms with `result === null`.
5. End a Recruiter session that produced 3 `resourceBriefs` → watch the resources panel auto-fill within ~30 s.
6. Unset `FIRECRAWL_API_KEY` and re-run 2 & 5 → confirm graceful no-research / disabled messaging.

**Smoke scripts (under `scripts/`):**
- `scripts/smoke-upload-deck.mjs` — posts `sample.pdf` to `/api/upload-deck`, asserts `ok:true` and `contextText.length > 0`.
- `scripts/smoke-external-context.mjs` — runs all five agent slugs sequentially against a fixed URL and prints the response shapes.
- `scripts/smoke-session-resources.mjs` — posts two hand-crafted briefs and asserts `topics.length === 2` with at most 5 resources each.

Each script loads `.env` via `import 'dotenv/config'` and reads `NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:3000'`.
