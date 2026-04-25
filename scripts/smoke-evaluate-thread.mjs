// Smoke test for POST /api/evaluate-thread.
// The dev server must be running (npm run dev) before invoking this script.
// Usage: node scripts/smoke-evaluate-thread.mjs
// Override target via SPARK_HTTP_URL=http://host:port

const url = process.env.SPARK_HTTP_URL ?? "http://localhost:3000";
const now = Date.now();

function fixtureSession({ id, score, summary, endedAtOffsetMs }) {
  return {
    id,
    sessionName: `Session ${id}`,
    startedAt: new Date(now - endedAtOffsetMs - 600_000).toISOString(),
    endedAt: new Date(now - endedAtOffsetMs).toISOString(),
    durationLabel: "10:00",
    transcript: [],
    upload: null,
    coding: null,
    customContext: "",
    evaluation: {
      score,
      summary,
      metrics: [
        { label: "Communication clarity", value: score, justification: "Worked example." },
        {
          label: "Impact storytelling",
          value: Math.max(0, score - 5),
          justification: "Worked example.",
        },
        {
          label: "Ownership signals",
          value: Math.max(0, score - 10),
          justification: "Worked example.",
        },
        { label: "Role fit", value: Math.max(0, score - 3), justification: "Worked example." },
      ],
      strengths: ["Clear narrative.", "Concrete metrics."],
      improvements: ["Tighten the opening.", "Quantify the ownership claims."],
    },
  };
}

const body = {
  agentSlug: "recruiter",
  thread: {
    id: "thread-smoke-1",
    title: "Smoke thread",
    createdAt: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  },
  sessions: [
    fixtureSession({
      id: "sess-A",
      score: 62,
      summary: "Older baseline run.",
      endedAtOffsetMs: 5 * 24 * 3600 * 1000,
    }),
    fixtureSession({
      id: "sess-B",
      score: 78,
      summary: "More recent run, tighter.",
      endedAtOffsetMs: 1 * 24 * 3600 * 1000,
    }),
  ],
};

const res = await fetch(`${url}/api/evaluate-thread`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}
const json = await res.json();

// Server returns either { ok, evaluation } (Agent A normalized shape) or
// { ok, threadEvaluation } (teammate's inline shape). Accept either.
const evaluation = json.evaluation ?? json.threadEvaluation;
if (!evaluation || typeof evaluation !== "object") {
  console.error("missing evaluation/threadEvaluation", json);
  process.exit(1);
}
if (typeof evaluation.summary !== "string" || !evaluation.summary.length) {
  console.error("summary missing/empty", evaluation);
  process.exit(1);
}
if (!Array.isArray(evaluation.metricTrends)) {
  console.error("metricTrends missing", evaluation);
  process.exit(1);
}
console.log(
  "OK trajectory=%s metricTrends=%d hiddenGuidance.length=%d",
  evaluation.trajectory ?? "?",
  evaluation.metricTrends.length,
  (evaluation.hiddenGuidance ?? "").length,
);
