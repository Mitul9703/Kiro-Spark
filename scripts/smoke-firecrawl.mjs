// Smoke test exercising the Firecrawl-backed research path via
// POST /api/agent-external-context (searchFirecrawl is internal to server.js).
// The dev server must be running (npm run dev) before invoking this script.
// Usage: node scripts/smoke-firecrawl.mjs
// Override target via SPARK_HTTP_URL=http://host:port

const url = process.env.SPARK_HTTP_URL ?? 'http://localhost:3000';
const body = {
  agentSlug: 'investor',
  companyUrl: 'https://stripe.com',
};

const res = await fetch(`${url}/api/agent-external-context`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const json = await res.json();
if (json.ok !== true) { console.error('expected ok:true, got', json); process.exit(1); }
if (json.research !== null && (typeof json.research !== 'object')) {
  console.error('expected research to be object or null, got', typeof json.research, json.research);
  process.exit(1);
}

if (json.research && typeof json.research.markdown === 'string') {
  console.log('---research markdown---');
  console.log(json.research.markdown);
  console.log('---end---');
} else {
  console.warn('WARN research is null (Firecrawl/research stub may be disabled)');
}
console.log('OK research=%s', json.research ? 'present' : 'null');
