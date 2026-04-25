// Smoke test for POST /api/session-resources.
// The dev server must be running (npm run dev) before invoking this script.
// Usage: node scripts/smoke-session-resources.mjs
// Override target via SPARK_HTTP_URL=http://host:port
//
// If FIRECRAWL_API_KEY is unset on the server, the endpoint may return zero
// resources per topic — we print a warning rather than failing in that case.

const url = process.env.SPARK_HTTP_URL ?? 'http://localhost:3000';
const body = {
  agentSlug: 'recruiter',
  briefs: [
    {
      topic: 'Behavioral storytelling with STAR',
      improvement: 'Tighten outcome framing in answers',
      whyThisMatters: 'Recruiters look for clear impact in 60-90s answers',
      searchPhrases: ['STAR method behavioral interview', 'how to quantify impact in interview'],
      resourceTypes: ['video', 'article'],
    },
    {
      topic: 'Communicating ownership of cross-team projects',
      improvement: 'Show agency without overclaiming',
      whyThisMatters: 'Recruiters probe for accountability vs collaboration balance',
      searchPhrases: ['interview answers about leadership without authority', 'showing ownership in behavioral interview'],
      resourceTypes: ['article', 'video'],
    },
  ],
};

const res = await fetch(`${url}/api/session-resources`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const json = await res.json();
if (!Array.isArray(json.topics)) { console.error('topics missing', json); process.exit(1); }
if (json.topics.length !== 2) { console.error('expected topics.length === 2, got', json.topics.length); process.exit(1); }

let warned = false;
for (const topic of json.topics) {
  const count = Array.isArray(topic.items) ? topic.items.length : 0;
  if (count < 1) {
    console.warn('WARN topic "%s" has 0 resources (Firecrawl may be disabled)', topic.topic);
    warned = true;
  }
}
console.log('OK topics=%d%s', json.topics.length, warned ? ' (with warnings)' : '');
