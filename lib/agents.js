import agentConfigs from "../data/agents.js";

const AGENT_DISPLAY_ORDER = [
  "investor-panel",
  "investor",
  "professor",
  "recruiter",
  "coding",
  "custom",
];

export const AGENTS = [...agentConfigs].sort((a, b) => {
  const ai = AGENT_DISPLAY_ORDER.indexOf(a.slug);
  const bi = AGENT_DISPLAY_ORDER.indexOf(b.slug);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
});

export const AGENT_LOOKUP = AGENTS.reduce((acc, agent) => {
  acc[agent.slug] = agent;
  return acc;
}, {});

export const DEFAULT_METRICS = {
  score: 82,
  metrics: [
    { label: "Confidence", value: 78 },
    { label: "Clarity", value: 86 },
    { label: "Depth", value: 80 },
    { label: "Composure", value: 84 },
  ],
};

export const EVALUATION_CRITERIA = AGENTS[0]?.evaluationCriteria || [];

export function buildMockEvaluation(slug) {
  return (
    AGENT_LOOKUP[slug]?.mockEvaluation || {
      ...DEFAULT_METRICS,
      summary:
        "Simulated evaluation complete. This session showed solid structure, usable confidence, and clear opportunities to tighten follow-up answers.",
      strengths: ["Strong pacing", "Clear framing", "Good composure under questioning"],
      improvements: [
        "Use more specific examples",
        "Shorten long answers",
        "Signal confidence earlier",
      ],
    }
  );
}
