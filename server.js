import http from "node:http";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import next from "next";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { AssemblyAI } from "assemblyai";
import { AIMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { AGENT_LOOKUP } from "./lib/agents.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

dotenv.config();

// Prevent a single bad WebSocket from crashing the whole server
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException (non-fatal):", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection (non-fatal):", reason);
});

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 5000);

const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();
const upload = multer({ dest: "uploads/" });

// ─── Gemini key helper ────────────────────────────────────────────────────────

const GEMINI_ENV_BY_TASK = {
  live: ["GEMINI_LIVE_API_KEY", "GEMINI_API_KEY"],
  evaluation: ["GEMINI_EVALUATION_API_KEY", "GEMINI_API_KEY"],
  resources: ["GEMINI_RESOURCE_CURATION_API_KEY", "GEMINI_API_KEY"],
  uploadPrep: ["GEMINI_UPLOAD_PREP_API_KEY", "GEMINI_API_KEY"],
  questionFinder: ["GEMINI_QUESTION_FINDER_API_KEY", "GEMINI_API_KEY"],
};

function getGeminiApiKey(task) {
  const candidates = GEMINI_ENV_BY_TASK[task] || ["GEMINI_API_KEY"];
  for (const envName of candidates) {
    const value = (process.env[envName] || "").trim();
    if (value) return value;
  }
  throw new Error(
    `Missing Gemini API key for task "${task}". Checked: ${candidates.join(", ")}`,
  );
}

// ─── Anam avatar profiles ─────────────────────────────────────────────────────

const ANAM_AVATAR_PROFILES = [
  { name: "Kevin",   avatarId: "ccf00c0e-7302-455b-ace2-057e0cf58127", gender: "Male"   },
  { name: "Gabriel", avatarId: "6cc28442-cccd-42a8-b6e4-24b7210a09c5", gender: "Male"   },
  { name: "Sophie",  avatarId: "6dbc1e47-7768-403e-878a-94d7fcc3677b", gender: "Female" },
  { name: "Astrid",  avatarId: "e717a556-2d44-4213-96ec-27d0b94dc198", gender: "Female" },
  { name: "Cara",    avatarId: "d9ebe82e-2f34-4ff6-9632-16cb73e7de08", gender: "Female" },
  { name: "Mia",     avatarId: "edf6fdcb-acab-44b8-b974-ded72665ee26", gender: "Female" },
  { name: "Leo",     avatarId: "d73415e3-d624-45a6-a461-0df1580e73d6", gender: "Male"   },
  { name: "Richard", avatarId: "19d18eb0-5346-4d50-a77f-26b3723ed79d", gender: "Male"   },
];

const GEMINI_VOICE_BY_GENDER = {
  Male:   ["Charon"],
  Female: ["Aoede", "Autonoe", "Despina", "Sulafat"],
};

function pickRandomItem(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function pickRandomAnamProfile() {
  const profile = pickRandomItem(ANAM_AVATAR_PROFILES) || ANAM_AVATAR_PROFILES[0];
  const voicePool = GEMINI_VOICE_BY_GENDER[profile.gender] || GEMINI_VOICE_BY_GENDER.Female;
  return { ...profile, voiceName: pickRandomItem(voicePool) || "Aoede" };
}

// ─── Gemini response schemas ──────────────────────────────────────────────────

const evaluationResponseSchema = {
  type: Type.OBJECT,
  required: ["score", "summary", "metrics", "strengths", "improvements", "recommendations", "resourceBriefs"],
  properties: {
    score: { type: Type.INTEGER, description: "Overall evaluation score from 0 to 100." },
    summary: { type: Type.STRING, description: "A concise overall summary of the session." },
    metrics: {
      type: Type.ARRAY, description: "Rubric metrics for this agent.",
      items: {
        type: Type.OBJECT, required: ["label", "score", "justification"],
        properties: { label: { type: Type.STRING }, score: { type: Type.INTEGER }, justification: { type: Type.STRING } },
      },
    },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
    resourceBriefs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT, required: ["topic", "improvement", "whyThisMatters", "searchPhrases", "resourceTypes"],
        properties: {
          topic: { type: Type.STRING }, improvement: { type: Type.STRING }, whyThisMatters: { type: Type.STRING },
          searchPhrases: { type: Type.ARRAY, items: { type: Type.STRING } },
          resourceTypes: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
  },
};

const tinyFishArticlesSchema = {
  type: Type.OBJECT, required: ["resources"],
  properties: {
    resources: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT, required: ["title", "url", "type", "source", "reason_relevant"],
        properties: {
          title: { type: Type.STRING }, url: { type: Type.STRING }, type: { type: Type.STRING },
          source: { type: Type.STRING }, reason_relevant: { type: Type.STRING },
        },
      },
    },
  },
};

const threadEvaluationResponseSchema = {
  type: Type.OBJECT,
  required: ["summary", "trajectory", "comments", "strengths", "focusAreas", "nextSessionFocus", "metricTrends", "hiddenGuidance"],
  properties: {
    summary: { type: Type.STRING },
    trajectory: { type: Type.STRING },
    comments: { type: Type.ARRAY, items: { type: Type.STRING } },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    focusAreas: { type: Type.ARRAY, items: { type: Type.STRING } },
    nextSessionFocus: { type: Type.STRING },
    metricTrends: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT, required: ["label", "trend", "comment"],
        properties: { label: { type: Type.STRING }, trend: { type: Type.STRING }, comment: { type: Type.STRING } },
      },
    },
    hiddenGuidance: { type: Type.STRING, description: "Internal-only hidden session guidance for the next live session. Never meant for direct user display." },
  },
};

const comparisonResponseSchema = {
  type: Type.OBJECT,
  required: ["trend", "summary", "metrics"],
  properties: {
    trend: { type: Type.STRING, description: "Overall direction of change. Use improved, mixed, similar, or declined." },
    summary: { type: Type.STRING, description: "A short comparison inference with minimal wording." },
    metrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT, required: ["label", "delta", "trend", "insight"],
        properties: { label: { type: Type.STRING }, delta: { type: Type.INTEGER }, trend: { type: Type.STRING }, insight: { type: Type.STRING } },
      },
    },
  },
};

// ─── Transcript / evaluation helpers ──────────────────────────────────────────

function normalizeTranscriptRole(role) {
  if (!role) return "User";
  if (role === "You") return "User";
  return role;
}

function buildTranscriptText(transcript) {
  return (transcript || [])
    .map((entry) => {
      const role = normalizeTranscriptRole(entry.role);
      const text = (entry.text || "").trim();
      if (!text) return null;
      return `${role}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildCodingContext(coding) {
  if (!coding) return "";
  const question = coding.interviewQuestion?.markdown
    ? `Prepared interview question:\n${coding.interviewQuestion.markdown}`.trim()
    : "";
  return `
Coding session context:
Selected language: ${coding.language || "Unspecified"}
${coding.companyUrl ? `Target company URL: ${coding.companyUrl}\n` : ""}
${question ? `${question}\n\n` : ""}
Latest candidate code:
${coding.finalCode?.trim() || "No code was saved."}
  `.trim();
}

function normalizeEvaluationResult(agent, rawResult) {
  const criteria = agent.evaluationCriteria || [];
  const metricsByLabel = new Map(
    (rawResult.metrics || []).map((metric) => [metric.label, metric]),
  );
  const metrics = criteria.map((criterion) => {
    const metric = metricsByLabel.get(criterion.label);
    return {
      label: criterion.label,
      value: Math.max(0, Math.min(100, Number(metric?.score || 0))),
      justification: (metric?.justification || "").trim(),
    };
  });
  return {
    score: Math.max(0, Math.min(100, Number(rawResult.score || 0))),
    summary: (rawResult.summary || "").trim(),
    metrics,
    strengths: Array.isArray(rawResult.strengths) ? rawResult.strengths.filter(Boolean).slice(0, 4) : [],
    improvements: Array.isArray(rawResult.improvements) ? rawResult.improvements.filter(Boolean).slice(0, 4) : [],
    recommendations: Array.isArray(rawResult.recommendations) ? rawResult.recommendations.filter(Boolean).slice(0, 4) : [],
    resourceBriefs: Array.isArray(rawResult.resourceBriefs)
      ? rawResult.resourceBriefs
          .map((brief, index) => ({
            id: brief.id || `brief-${index + 1}`,
            topic: (brief.topic || "").trim(),
            improvement: (brief.improvement || "").trim(),
            whyThisMatters: (brief.whyThisMatters || "").trim(),
            searchPhrases: Array.isArray(brief.searchPhrases) ? brief.searchPhrases.filter(Boolean).slice(0, 3) : [],
            resourceTypes: Array.isArray(brief.resourceTypes) ? brief.resourceTypes.filter(Boolean).slice(0, 3) : [],
          }))
          .filter((brief) => brief.topic && brief.improvement)
          .slice(0, 2)
      : [],
  };
}

function normalizeComparisonResult(agent, rawResult, currentEvaluation, baselineEvaluation) {
  const allowedTrends = new Set(["improved", "mixed", "similar", "declined"]);
  const currentMetrics = Array.isArray(currentEvaluation?.metrics) ? currentEvaluation.metrics : [];
  const baselineMetrics = Array.isArray(baselineEvaluation?.metrics) ? baselineEvaluation.metrics : [];

  const metrics = (agent.evaluationCriteria || []).map((criterion) => {
    const currentMetric = currentMetrics.find((item) => item.label === criterion.label);
    const baselineMetric = baselineMetrics.find((item) => item.label === criterion.label);
    const currentValue = typeof currentMetric?.value === "number" ? currentMetric.value : 0;
    const baselineValue = typeof baselineMetric?.value === "number" ? baselineMetric.value : 0;
    const rawMetric = Array.isArray(rawResult?.metrics) ? rawResult.metrics.find((item) => item.label === criterion.label) : null;
    const delta = typeof rawMetric?.delta === "number" ? rawMetric.delta : currentValue - baselineValue;
    const trend = allowedTrends.has(rawMetric?.trend)
      ? rawMetric.trend
      : delta > 4 ? "improved" : delta < -4 ? "declined" : "similar";

    return {
      label: criterion.label,
      currentValue,
      baselineValue,
      delta,
      trend,
      insight: typeof rawMetric?.insight === "string" && rawMetric.insight.trim()
        ? rawMetric.insight.trim()
        : delta === 0 ? "This metric stayed broadly steady between the two sessions."
          : delta > 0 ? "This metric improved in the newer session."
            : "This metric slipped in the newer session.",
    };
  });

  return {
    trend: allowedTrends.has(rawResult?.trend) ? rawResult.trend : "mixed",
    summary: typeof rawResult?.summary === "string" && rawResult.summary.trim()
      ? rawResult.summary.trim()
      : "This session shows mixed movement compared with the selected earlier session.",
    metrics,
  };
}

// ─── Firecrawl helpers ────────────────────────────────────────────────────────

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch (_) { return ""; }
}

async function searchFirecrawl(query, { limit = 6 } = {}) {
  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ query, limit, location: "United States", timeout: 30000, ignoreInvalidURLs: true, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error("[firecrawl-search] failed", { status: response.status, payload });
    throw new Error(payload?.message || payload?.error || "Firecrawl search failed.");
  }
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function scrapeWithFirecrawl(url) {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 30000, blockAds: true, proxy: "auto" }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || "Firecrawl scrape failed.");
  }
  return payload?.data || null;
}

function normalizeFirecrawlCandidates(results, fallbackType) {
  return (results || [])
    .map((item) => ({
      title: (item.title || "").trim(),
      url: (item.url || "").trim(),
      source: domainFromUrl(item.url || ""),
      snippet: (item.description || "").trim(),
      scrapedSummary: (item.markdown || "").slice(0, 1800),
      type: fallbackType,
    }))
    .filter((item) => item.title && item.url);
}

async function curateResourceCandidates(brief, candidates) {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey("resources") });
  const prompt = `
Topic: ${brief.topic}
Improvement area: ${brief.improvement}
Why it matters: ${brief.whyThisMatters}

Candidate resources:
${candidates.map((c, i) => `
Candidate ${i + 1}
- title: ${c.title}
- url: ${c.url}
- source: ${c.source}
- type: ${c.type}
- search snippet: ${c.snippet || "None"}
- scraped summary: ${(c.scrapedSummary || "").slice(0, 1200) || "None"}
`).join("\n")}

Return exactly up to 4 resources in JSON.
Prefer practical, educational, high-signal links.
Avoid duplicates, spammy pages, and weak matches.
Reason relevance specifically for this improvement area.
Use type values like youtube, article, website, or leetcode.
  `.trim();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      systemInstruction: "You curate improvement resources for a practice app. Select the strongest links from the provided candidates only. Never invent URLs. Prefer practical, credible, and directly relevant resources.",
      responseMimeType: "application/json",
      responseSchema: tinyFishArticlesSchema,
    },
  });

  const parsed = JSON.parse((response.text || "").trim());
  const resources = Array.isArray(parsed?.resources) ? parsed.resources : [];
  return resources
    .map((r) => ({ title: (r.title || "").trim(), url: (r.url || "").trim(), type: (r.type || "").trim(), source: (r.source || "").trim(), reason: (r.reason_relevant || "").trim() }))
    .filter((r) => r.title && r.url);
}

async function fetchResourcesForBrief(brief) {
  const phrases = (brief.searchPhrases || []).filter(Boolean);
  const primaryPhrase = phrases[0] || brief.topic || brief.improvement;
  const secondaryPhrase = phrases[1] || brief.improvement || brief.topic;
  const isCoding = brief.agentSlug === "coding";

  const videoQuery = isCoding
    ? `${primaryPhrase} site:youtube.com coding interview OR neetcode OR leetcode`
    : `${primaryPhrase} site:youtube.com`;
  const articleQuery = isCoding
    ? `${secondaryPhrase} site:leetcode.com OR site:neetcode.io OR site:geeksforgeeks.org`
    : `${secondaryPhrase}`;

  const [videoResults, articleResults] = await Promise.all([
    searchFirecrawl(videoQuery, { limit: 5 }),
    searchFirecrawl(articleQuery, { limit: 6 }),
  ]);

  const rawCandidates = [
    ...normalizeFirecrawlCandidates(videoResults, "youtube"),
    ...normalizeFirecrawlCandidates(articleResults, isCoding ? "website" : "article"),
  ];

  const deduped = [];
  const seen = new Set();
  for (const candidate of rawCandidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    deduped.push(candidate);
    if (deduped.length >= 6) break;
  }

  const enriched = await Promise.all(
    deduped.map(async (candidate) => {
      if (candidate.scrapedSummary) return candidate;
      try {
        const scraped = await scrapeWithFirecrawl(candidate.url);
        return { ...candidate, source: candidate.source || scraped?.metadata?.title || domainFromUrl(candidate.url), scrapedSummary: (scraped?.markdown || "").slice(0, 1800) };
      } catch (_) { return candidate; }
    }),
  );

  const curated = await curateResourceCandidates(brief, enriched);
  return curated.slice(0, 4);
}

// ─── URL / text helpers ───────────────────────────────────────────────────────

function normalizeHttpUrl(rawUrl) {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try { return new URL(withProtocol).toString(); }
  catch (_) { return ""; }
}

function companyNameFromUrl(rawUrl) {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return "";
  try {
    const { hostname } = new URL(normalized);
    const cleaned = hostname.replace(/^www\./, "").replace(/\.(com|ai|io|org|net|co|app|dev|jobs|careers)$/i, "");
    return cleaned.split(".").filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  } catch (_) { return ""; }
}

function extractTextFromLangChainContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n");
  if (content && typeof content.text === "string") return content.text;
  return "";
}

function stripCodeFences(text) {
  return (text || "").trim().replace(/^```markdown\s*/i, "").replace(/^```md\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function normalizeCodingQuestionMarkdown(rawText, companyUrl) {
  const markdown = stripCodeFences(rawText);
  if (!markdown) return null;
  const titleMatch = markdown.match(/(?:^|\n)#{1,6}\s*(.+)/);
  const sourceUrlMatch = markdown.match(/https?:\/\/[^\s)]+/i);
  return {
    companyName: companyNameFromUrl(companyUrl) || "",
    title: (titleMatch?.[1] || "Company-specific coding question").trim(),
    markdown,
    sourceUrl: normalizeHttpUrl(sourceUrlMatch?.[0] || ""),
  };
}

function hasGroundedProblemSignals(markdown = "", title = "") {
  const text = `${title}\n${markdown}`.toLowerCase();
  const checks = [/given\s+an?\s/, /\binput\b/, /\boutput\b/, /\bexample\b/, /\bconstraint/, /\breturn\b/, /\btest case/];
  return checks.reduce((c, p) => c + (p.test(text) ? 1 : 0), 0) >= 3;
}

function looksLikeWeakInterviewExperienceSource(url = "", title = "") {
  const n = `${url} ${title}`.toLowerCase();
  return n.includes("interview-experience") || n.includes("my-") || n.includes("experience") || n.includes("medium.com");
}

// ─── External research agent ──────────────────────────────────────────────────

async function generateExternalResearchForAgent({ agentSlug, companyUrl, customContext = "", uploadContextText = "" }) {
  const normalizedUrl = normalizeHttpUrl(companyUrl);
  if (!normalizedUrl) throw new Error("A valid company URL is required.");
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("Missing FIRECRAWL_API_KEY.");
  getGeminiApiKey("questionFinder");

  const companyName = companyNameFromUrl(normalizedUrl) || "the target company";
  const agentConfig = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.custom;
  const searchLogs = [];
  const scrapeLogs = [];
  const scrapeCache = new Map();

  const searchTool = tool(
    async ({ query, limit = 5 }) => {
      const results = await searchFirecrawl(query, { limit });
      const candidates = normalizeFirecrawlCandidates(results, "website")
        .map((item) => ({ title: item.title, url: item.url, source: item.source, snippet: item.snippet, likelyWeakSource: looksLikeWeakInterviewExperienceSource(item.url, item.title) }))
        .slice(0, limit);
      searchLogs.push({ query, candidates });
      console.log("[external-research] search", { agentSlug, companyName, query, count: candidates.length });
      return JSON.stringify(candidates);
    },
    {
      name: "search_web_for_coding_questions",
      description: "Search the public web for actual coding problem pages, company-tagged practice lists, or grounded sources. Use this before scraping.",
      schema: z.object({ query: z.string().describe("A web search query."), limit: z.number().int().min(1).max(6).optional() }),
    },
  );

  const scrapeTool = tool(
    async ({ url }) => {
      const target = normalizeHttpUrl(url);
      if (!target) throw new Error("A valid URL is required for scraping.");
      const scraped = await scrapeWithFirecrawl(target);
      const payload = { url: target, title: scraped?.metadata?.title || scraped?.metadata?.ogTitle || domainFromUrl(target), markdown: (scraped?.markdown || "").slice(0, 9000) };
      const enriched = { ...payload, groundedProblemSignals: hasGroundedProblemSignals(payload.markdown, payload.title), weakSource: looksLikeWeakInterviewExperienceSource(target, payload.title) };
      scrapeCache.set(target, enriched);
      scrapeLogs.push({ url: target, title: enriched.title, groundedProblemSignals: enriched.groundedProblemSignals });
      console.log("[external-research] scrape", { agentSlug, url: target, title: enriched.title });
      return JSON.stringify(enriched);
    },
    {
      name: "scrape_coding_question_source",
      description: "Scrape one promising page to extract grounded question text, examples, constraints, and evidence.",
      schema: z.object({ url: z.string().describe("The URL of a promising source page to scrape.") }),
    },
  );

  const llm = new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", temperature: 0.1, maxRetries: 2, apiKey: getGeminiApiKey("questionFinder") });

  const systemPrompt = agentSlug === "coding"
    ? `You are a careful research agent selecting exactly one grounded coding interview question for a live technical interview rehearsal.\n\nWorkflow:\n- Search first for reputable public sources such as actual problem pages, company-tagged coding question lists, or well-known prep pages.\n- Prefer LeetCode problem pages, company-tagged question lists, NeetCode-style lists, or public pages that contain a full problem statement.\n- If you find an interview-experience page that only mentions a question title, topic, or data structure, do not stop there. Treat it as a clue and search again for the actual problem page.\n- Scrape the most promising one or two URLs to verify the question details.\n- Choose exactly one question that is plausible for an early-round coding screen.\n\nYour final answer must be markdown only with sections: # Question Title, ## Difficulty, ## Why this question fits, ## Problem Statement, ## Examples, ## Constraints, ## Suggested Test Cases, ## Source, ## Evidence`
    : agentSlug === "investor"
      ? `You are a careful research agent preparing hidden diligence context for an investor-style live pitch rehearsal.\n\nWorkflow:\n- Search for authoritative public sources about the target company or product.\n- Prioritize the company site, product/pricing pages, recent news, funding announcements, partnerships, reviews, and market signals.\n- Scrape the most relevant pages and synthesize a concise investor-style brief.\n\nYour final answer must be markdown only with sections: # Company Research Brief, ## Company Snapshot, ## Product and Monetization Signals, ## Recent News and Material Events, ## Market / Competitive Context, ## Investor Pressure Points, ## Source, ## Evidence`
      : `You are a careful research agent preparing hidden public-context notes for a live rehearsal session.\n\nWorkflow:\n- Search for relevant public sources related to the target URL and the user's optional context.\n- Scrape the most promising pages and synthesize a concise brief.\n\nYour final answer must be markdown only with sections: # External Context Brief, ## What this appears to be, ## Relevant Public Signals, ## Points worth probing, ## Source, ## Evidence`;

  const codingQuestionAgent = createAgent({ model: llm, tools: [searchTool, scrapeTool], systemPrompt });

  const prompt = agentSlug === "coding"
    ? `Target company URL: ${normalizedUrl}\nTarget company name: ${companyName}\n\nOptional interview context:\n${customContext?.trim() || "None provided."}\n\nOptional uploaded document context:\n${uploadContextText?.trim() || "None provided."}\n\nFind one coding interview question for this company. Use the tools to search, inspect sources, and return a single grounded question.`
    : agentSlug === "investor"
      ? `Target company URL: ${normalizedUrl}\nTarget company name: ${companyName}\n\nOptional investor context:\n${customContext?.trim() || "None provided."}\n\nOptional uploaded document context:\n${uploadContextText?.trim() || "None provided."}\n\nBuild one hidden investor-style diligence brief for this company.`
      : `Target URL: ${normalizedUrl}\nTarget entity name: ${companyName}\nAgent role: ${agentConfig.name}\n\nOptional scenario context:\n${customContext?.trim() || "None provided."}\n\nOptional uploaded document context:\n${uploadContextText?.trim() || "None provided."}\n\nBuild one hidden external-context brief for this session.`;

  const result = await codingQuestionAgent.invoke({ messages: [{ role: "user", content: prompt }] });

  const finalMessage = Array.isArray(result?.messages)
    ? [...result.messages].reverse().find((m) => m instanceof AIMessage)
    : null;
  const rawText = extractTextFromLangChainContent(finalMessage?.content || "");
  console.log("[external-research] final_raw", { agentSlug, length: rawText.length });

  const question = normalizeCodingQuestionMarkdown(rawText, normalizedUrl) || null;
  console.log("[external-research] generated", { agentSlug, companyUrl: normalizedUrl, found: Boolean(question), title: question?.title || null, searchesRun: searchLogs.length, scrapesRun: scrapeLogs.length });

  return question;
}

// ─── WebSocket live bridge ────────────────────────────────────────────────────

// Panel persona turn arbitration
const PANEL_TURN_PATTERNS = [
  ["skeptic", "operator", "believer"],
  ["believer", "skeptic", "operator"],
  ["operator", "believer", "skeptic"],
  ["skeptic", "believer", "operator"],
];

function registerLiveBridge(server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (clientSocket, request) => {
    console.log("[live] browser connected");

    const requestUrl = new URL(
      request?.url || "/api/live",
      `http://${hostname}:${port}`,
    );
    const agentSlug = requestUrl.searchParams.get("agent") || "recruiter";
    const voiceName = (requestUrl.searchParams.get("voice") || "").trim();
    const agentConfig = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;

    // Detect panel mode
    const isPanelMode = Boolean(agentConfig.panelMode && agentConfig.panelPersonas?.length);

    if (isPanelMode) {
      handlePanelSession(clientSocket, agentSlug, agentConfig);
    } else {
      handleSingleSession(clientSocket, agentSlug, voiceName, agentConfig);
    }
  });

  // ── Panel session handler (multiple Gemini streams) ─────────────────────

  function handlePanelSession(clientSocket, agentSlug, agentConfig) {
    const personas = agentConfig.panelPersonas || [];
    const personaSessions = new Map(); // id -> { session, connected, persona }
    let assemblyTranscriber = null;
    let assemblyConnected = false;
    let sessionBootstrapped = false;
    let clientClosed = false;
    let kickoffTimer = null;
    let kickoffSent = false;

    // Turn state
    let activeSpeaker = null;
    let turnIndex = 0;
    let conversationLog = []; // [{role: "founder"|personaId, text}] — shared context

    let sessionCustomContext = "";
    let sessionThreadContext = "";
    let sessionUploadContextText = "";
    let sessionUploadFileName = "";
    let sessionCompanyUrl = "";
    let sessionExternalResearch = null;

    function safeSend(data) {
      try {
        if (!clientClosed && clientSocket.readyState === 1) {
          clientSocket.send(typeof data === "string" ? data : JSON.stringify(data));
        }
      } catch (_) {}
    }

    function buildSharedContext() {
      const parts = [`Panel members: ${personas.map((p) => p.name).join(", ")}`];
      if (sessionCustomContext) parts.push(`\nUser-provided context:\n${sessionCustomContext}`);
      if (sessionUploadContextText) parts.push(`\nUploaded document context:\n${sessionUploadContextText}`);
      if (sessionExternalResearch?.markdown) parts.push(`\nExternal research:\n${sessionExternalResearch.markdown}`);
      if (sessionThreadContext) parts.push(`\nThread memory (hidden):\n${sessionThreadContext}`);
      return parts.join("\n");
    }

    // Build conversation history text for injection into a persona's session
    function buildConversationSummary() {
      if (!conversationLog.length) return "";
      return "\n\nConversation so far:\n" + conversationLog
        .slice(-20) // last 20 turns to avoid token overflow
        .map((entry) => {
          if (entry.role === "founder") return `Founder: ${entry.text}`;
          const p = personas.find((pp) => pp.id === entry.role);
          return `${p?.name || entry.role}: ${entry.text}`;
        })
        .join("\n");
    }

    // Context-aware speaker selection
    // Skeptic: numbers, metrics, retention, revenue, unit economics, competition
    // Operator: market, GTM, operations, logistics, supply chain, distribution, pricing
    // Believer: vision, team, timing, conviction, mission, passion, why-now
    const SKEPTIC_SIGNALS = /\b(number|metric|revenue|retention|churn|arr|mrr|cac|ltv|unit econom|margin|burn|runway|profit|loss|cost|compet|rival)\b/i;
    const OPERATOR_SIGNALS = /\b(market|gtm|go.to.market|distribution|channel|pricing|supply|logistics|operation|scale|infra|partner|vendor|regulation)\b/i;
    const BELIEVER_SIGNALS = /\b(vision|mission|team|passion|timing|why.now|believe|excit|opportunit|impact|transform|disrupt)\b/i;

    function pickNextSpeaker(excludeId, founderText) {
      const text = (founderText || "").toLowerCase();

      // Score each persona based on keyword relevance to what the founder said
      const scores = { skeptic: 0, operator: 0, believer: 0 };
      if (SKEPTIC_SIGNALS.test(text)) scores.skeptic += 3;
      if (OPERATOR_SIGNALS.test(text)) scores.operator += 3;
      if (BELIEVER_SIGNALS.test(text)) scores.believer += 3;

      // Add rotation bias so it doesn't always pick the same one
      const pattern = PANEL_TURN_PATTERNS[turnIndex % PANEL_TURN_PATTERNS.length];
      turnIndex++;
      pattern.forEach((id, i) => { scores[id] = (scores[id] || 0) + (3 - i); }); // first in pattern gets +3, second +2, third +1

      // Remove excluded persona
      if (excludeId) delete scores[excludeId];

      // Pick the highest-scoring connected persona
      const ranked = Object.entries(scores)
        .filter(([id]) => personaSessions.has(id) && personaSessions.get(id).connected)
        .sort((a, b) => b[1] - a[1]);

      const picked = ranked[0]?.[0] || null;
      if (picked) {
        console.log(`[panel] speaker selection: ${picked} (scores: ${JSON.stringify(scores)})`);
      }
      return picked;
    }

    // Prompt a persona to speak — sends conversation context + trigger
    function promptPersonaToSpeak(personaId, trigger) {
      const entry = personaSessions.get(personaId);
      if (!entry?.session || !entry.connected) {
        console.log(`[panel] cannot prompt ${personaId} — not connected`);
        return;
      }

      activeSpeaker = personaId;

      // Tell the client who's about to speak BEFORE audio arrives
      safeSend({ type: "panel_speaker", personaId, personaName: entry.persona.name });

      const conversationContext = buildConversationSummary();
      const prompt = `${conversationContext}\n\n${trigger}`;

      console.log(`[panel] prompting ${entry.persona.name} to speak`);
      entry.session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: prompt }] }],
        turnComplete: true,
      });
    }

    async function connectPersona(persona) {
      // Use separate Gemini API keys if available (round-robin)
      const liveKeys = (process.env.GEMINI_LIVE_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
      const keyIndex = personas.indexOf(persona);
      const apiKey = liveKeys[keyIndex % liveKeys.length] || getGeminiApiKey("live");

      const ai = new GoogleGenAI({ apiKey });
      const sharedContext = buildSharedContext();
      const systemInstruction = `${persona.systemPrompt}\n\nShared session context:\n${sharedContext}`.trim();

      console.log(`[panel] connecting ${persona.name} (voice: ${persona.voice}, keyIndex: ${keyIndex})`);

      // Pre-register the entry so onopen can find it
      personaSessions.set(persona.id, { session: null, connected: false, persona, lastTranscript: "" });

      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.voice } } },
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            if (clientClosed) return;
            const e = personaSessions.get(persona.id);
            if (e) e.connected = true;
            console.log(`[panel] ✓ ${persona.name} Gemini session OPEN (connected: true)`);
            safeSend({ type: "status", message: `${persona.name} joined the panel.` });
          },
          onmessage: (message) => {
            if (clientClosed) return;
            const serverContent = message.serverContent;

            // Only relay if this persona is the active speaker
            if (activeSpeaker !== persona.id) {
              // Non-active persona generated a response — suppress it
              // But if turnComplete fires, just ignore it silently
              return;
            }

            const transcriptChunk = serverContent?.outputTranscription?.text;
            if (transcriptChunk) {
              // Accumulate transcript for this turn
              const e = personaSessions.get(persona.id);
              if (e) e.lastTranscript = (e.lastTranscript || "") + " " + transcriptChunk;
              console.log(`[panel] ${persona.name} says: ${transcriptChunk.slice(0, 80)}...`);
              safeSend({ type: "model_text", text: `[${persona.name}] ${transcriptChunk}` });
            }

            const parts = serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                safeSend({
                  type: "audio_chunk",
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                });
              }
            }

            if (serverContent?.turnComplete) {
              safeSend({ type: "turn_complete" });

              const e = personaSessions.get(persona.id);
              const spokenText = (e?.lastTranscript || "").trim();
              console.log(`[panel] ${persona.name} finished turn (spoke: ${spokenText.length} chars)`);

              if (spokenText) {
                conversationLog.push({ role: persona.id, text: spokenText });

                // Share what was said with the OTHER personas as text
                for (const [otherId, otherEntry] of personaSessions) {
                  if (otherId !== persona.id && otherEntry.connected && otherEntry.session) {
                    otherEntry.session.sendClientContent({
                      turns: [{ role: "user", parts: [{ text: `[${persona.name} just said]: ${spokenText}` }] }],
                      turnComplete: true,
                    });
                  }
                }
              }

              // Reset for next turn
              if (e) e.lastTranscript = "";
              activeSpeaker = null;

              // Parse turn control tags from the spoken text
              // [FOLLOW-UP: Name] means this agent wants another panelist to speak next
              // [PASS] means wait for the founder
              const followUpMatch = spokenText.match(/\[FOLLOW-UP:\s*(\w+)\]/i);
              const hasPass = /\[PASS\]/i.test(spokenText);

              if (followUpMatch) {
                const requestedName = followUpMatch[1].toLowerCase();
                // Map name to persona id
                const targetPersona = personas.find((p) =>
                  p.name.toLowerCase().includes(requestedName) || p.id === requestedName
                );
                if (targetPersona && targetPersona.id !== persona.id) {
                  console.log(`[panel] ${persona.name} requested follow-up from ${targetPersona.name}`);
                  setTimeout(() => {
                    if (clientClosed || activeSpeaker) return;
                    promptPersonaToSpeak(targetPersona.id, `${persona.name} just directed the conversation to you. They said: "${spokenText.replace(/\[FOLLOW-UP:[^\]]*\]/gi, "").replace(/\[PASS\]/gi, "").trim()}"\n\nRespond in character. 1-3 sentences max. End with [PASS] or [FOLLOW-UP: Name].`);
                  }, 500);
                } else {
                  console.log(`[panel] ${persona.name} requested follow-up but target not found: ${requestedName}`);
                }
              } else if (!hasPass) {
                // No explicit tag — use context-aware selection with 60% probability
                if (Math.random() < 0.6) {
                  const nextId = pickNextSpeaker(persona.id, spokenText);
                  if (nextId) {
                    setTimeout(() => {
                      if (clientClosed || activeSpeaker) return;
                      promptPersonaToSpeak(nextId, `${persona.name} just said: "${spokenText.replace(/\[FOLLOW-UP:[^\]]*\]/gi, "").replace(/\[PASS\]/gi, "").trim()}"\n\nYou may respond, agree, disagree, or ask the founder a follow-up. Keep it to 1-2 sentences. End with [PASS] or [FOLLOW-UP: Name].`);
                    }, 600);
                  }
                }
              }
              // If [PASS], do nothing — wait for the founder to speak
            }
          },
          onerror: (error) => {
            if (clientClosed) return;
            console.error(`[panel] ✗ ${persona.name} Gemini ERROR:`, error.message || error);
            safeSend({ type: "status", message: `${persona.name} encountered an error.` });
          },
          onclose: (event) => {
            const e = personaSessions.get(persona.id);
            if (e) e.connected = false;
            console.log(`[panel] ${persona.name} Gemini session CLOSED`, event?.reason || "");
            if (activeSpeaker === persona.id) {
              activeSpeaker = null;
            }
          },
        },
      });

      // Update the entry with the actual session object
      const entry = personaSessions.get(persona.id);
      if (entry) entry.session = session;
      return session;
    }

    async function connectAssemblyPanel() {
      if (!assembly) return;
      assemblyTranscriber = assembly.streaming.transcriber({
        sampleRate: 16_000, speechModel: "universal-streaming-english",
        formatTurns: true, languageDetection: false, minTurnSilence: 700,
      });
      assemblyTranscriber.on("turn", (turn) => {
        if (!turn?.transcript) return;
        safeSend({ type: "user_transcription", text: turn.transcript, finished: !!turn.end_of_turn });

        if (turn.end_of_turn) {
          console.log(`[panel] founder said: ${turn.transcript.slice(0, 80)}...`);
          conversationLog.push({ role: "founder", text: turn.transcript });

          // Pick next speaker based on what the founder said
          const nextId = pickNextSpeaker(null, turn.transcript);
          if (nextId) {
            promptPersonaToSpeak(nextId, `The founder just said: "${turn.transcript}"\n\nRespond in character. 1-3 sentences max.`);
          }
        }
      });
      assemblyTranscriber.on("error", (err) => {
        console.error("[panel] AssemblyAI error:", err);
      });
      assemblyTranscriber.on("close", () => { assemblyConnected = false; });
      await assemblyTranscriber.connect();
      assemblyConnected = true;
      console.log("[panel] ✓ AssemblyAI connected");
    }

    const assembly = process.env.ASSEMBLYAI_API_KEY
      ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
      : null;

    clientSocket.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "session_context") {
          if (sessionBootstrapped) return;
          sessionBootstrapped = true;

          sessionCustomContext = (msg.customContext || "").trim();
          sessionThreadContext = (msg.threadContext || "").trim();
          sessionUploadContextText = (msg.upload?.contextText || "").trim();
          sessionUploadFileName = (msg.upload?.fileName || "").trim();
          sessionCompanyUrl = (msg.companyUrl || "").trim();
          sessionExternalResearch = msg.externalResearch || null;

          console.log("[panel] session_context received", { agentSlug, personas: personas.map((p) => p.id) });

          try {
            if (clientClosed) return;

            // Connect all personas in parallel
            console.log("[panel] connecting all personas...");
            await Promise.all(personas.map((p) => connectPersona(p)));
            console.log("[panel] all personas connected");

            if (clientClosed) return;
            await connectAssemblyPanel();
            if (clientClosed) return;

            safeSend({ type: "status", message: "All panel members connected. Session is live." });

            // Kickoff: Believer opens the session
            kickoffTimer = setTimeout(() => {
              if (kickoffSent || clientClosed) return;
              kickoffSent = true;
              console.log("[panel] kickoff — Believer opens");
              promptPersonaToSpeak("believer", agentConfig.sessionKickoff || "Open this investor panel session with a brief introduction of the panel, then ask the founder for a 60-second overview.");
            }, 1000);
          } catch (error) {
            if (clientClosed) return;
            console.error("[panel] failed to open session:", error);
            safeSend({ type: "error", message: error.message || "Failed to start panel session" });
            try { clientSocket.close(); } catch (_) {}
          }
          return;
        }

        // Audio goes to ALL persona sessions so they stay in audio mode
        // Only the active speaker's audio output gets relayed to the browser
        if (msg.type === "user_audio") {
          for (const [, entry] of personaSessions) {
            if (entry.connected && entry.session) {
              entry.session.sendRealtimeInput({
                audio: { data: msg.data, mimeType: msg.mimeType || "audio/pcm;rate=16000" },
              });
            }
          }

          // Always forward to AssemblyAI for transcription
          if (assemblyTranscriber && assemblyConnected) {
            queueMicrotask(() => {
              try { assemblyTranscriber.sendAudio(Buffer.from(msg.data, "base64")); }
              catch (err) { console.error("[panel] AssemblyAI audio forward error:", err); }
            });
          }
          return;
        }

        if (msg.type === "screen_frame") {
          // Only send to active speaker
          if (activeSpeaker) {
            const entry = personaSessions.get(activeSpeaker);
            if (entry?.connected && entry.session && msg.data) {
              entry.session.sendRealtimeInput({ video: { data: msg.data, mimeType: msg.mimeType || "image/jpeg" } });
            }
          }
          return;
        }

        if (msg.type === "screen_share_state") {
          const surface = (msg.surface || "screen").trim();
          const text = msg.active
            ? `The founder has started sharing a live ${surface}. Use what is visibly shown as passive visual context.`
            : "The live screen share has ended.";
          for (const [, entry] of personaSessions) {
            if (entry.connected && entry.session) {
              entry.session.sendClientContent({
                turns: [{ role: "user", parts: [{ text }] }],
                turnComplete: true,
              });
            }
          }
          return;
        }

        if (msg.type === "end_session") {
          console.log("[panel] ending session");
          if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
          for (const [, entry] of personaSessions) {
            try { await entry.session?.close(); } catch (_) {}
          }
          try { await assemblyTranscriber?.close(); } catch (_) {}
          safeSend({ type: "live_closed", message: "Panel session ended." });
          return;
        }

        if (msg.type === "get_history") {
          safeSend({ type: "history", history: [] });
          return;
        }

        if (msg.type === "save_model_text") return;

      } catch (error) {
        console.error("[panel] message error:", error);
        safeSend({ type: "error", message: error.message || "Invalid message" });
      }
    });

    clientSocket.on("close", async () => {
      clientClosed = true;
      console.log("[panel] browser disconnected — cleaning up");
      if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
      for (const [, entry] of personaSessions) {
        try { await entry.session?.close(); } catch (_) {}
      }
      try { await assemblyTranscriber?.close(); } catch (_) {}
    });
  }

  // ── Single-agent session handler (original behavior) ────────────────────

  function handleSingleSession(clientSocket, agentSlug, voiceName, agentConfig) {

    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey("live") });
    const assembly = process.env.ASSEMBLYAI_API_KEY
      ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
      : null;

    let geminiSession = null;
    let assemblyTranscriber = null;
    let liveConnected = false;
    let assemblyConnected = false;
    let kickoffSent = false;
    let kickoffTimer = null;
    let sessionBootstrapped = false;
    let clientClosed = false;
    let conversationHistory = [];

    // Context fields populated from session_context message
    let sessionCustomContext = "";
    let sessionThreadContext = "";
    let sessionUploadContextText = "";
    let sessionUploadFileName = "";
    let sessionCompanyUrl = "";
    let sessionExternalResearch = null;

    // Safe send — never throws on a closed/closing socket
    function safeSend(data) {
      try {
        if (!clientClosed && clientSocket.readyState === 1) {
          clientSocket.send(typeof data === "string" ? data : JSON.stringify(data));
        }
      } catch (_) {}
    }

    function sendKickoff(text) {
      const kickoffText = (text || "").trim();
      if (!kickoffText || !liveConnected || !geminiSession || kickoffSent) return;
      kickoffSent = true;
      geminiSession.sendClientContent({
        turns: [{ role: "user", parts: [{ text: kickoffText }] }],
        turnComplete: true,
      });
    }

    async function connectLive() {
      // Build layered system instruction from all available context
      const uploadBlock = sessionUploadContextText
        ? `\n\nAdditional grounded document context from the uploaded file "${sessionUploadFileName || "uploaded file"}":\n${sessionUploadContextText}\n\nRules for grounded usage:\n- Use this document context actively when relevant.\n- Do not invent details not present in this context or in the live conversation.\n- If the user asks about the uploaded file, rely on this grounded context.`
        : "";

      const customBlock = sessionCustomContext
        ? `\n\nAdditional user-provided context for this session:\n${sessionCustomContext}\n\nRules for using this context:\n- Treat it as an explicit user brief for this room.\n- Use it actively when framing questions and follow-ups.\n- Do not invent details beyond what the user provided.${agentSlug === "coding" ? "\n- If this context includes a specific coding question or problem statement, use that as the interview problem instead of the default fallback bank." : ""}`
        : "";

      const researchBlock = sessionExternalResearch
        ? `\n\nPrepared hidden session research for this session:\nCompany URL: ${sessionCompanyUrl || "Not provided"}\n${sessionExternalResearch.markdown || "No grounded research brief was available."}\n\nGrounding rules:\n- Use this prepared research only as hidden steering context.\n- For coding, use the prepared problem brief as the interview question for this session.\n- For investor and custom, use the brief to shape sharper questions, follow-ups, and pressure points.\n- Do not explicitly mention the hidden research process unless the user directly asks.`
        : "";

      const threadBlock = sessionThreadContext
        ? `\n\nInternal thread memory for hidden steering only:\n${sessionThreadContext}\n\nCritical rule:\n- Never mention prior sessions, prior evaluations, stored weaknesses, thread memory, coaching strategy, or adaptation logic to the user.\n- Use this memory only internally to shape question selection, follow-up depth, and emphasis.`
        : "";

      const systemInstruction = [
        agentConfig.systemPrompt,
        customBlock,
        threadBlock,
        researchBlock,
        uploadBlock,
      ]
        .filter(Boolean)
        .join("\n")
        .trim();

      geminiSession = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: voiceName
            ? { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
            : undefined,
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            if (clientClosed) return;
            liveConnected = true;
            safeSend({ type: "status", message: "Gemini Live connected" });
          },
          onmessage: (message) => {
            if (clientClosed) return;
            const serverContent = message.serverContent;

            // Relay model audio transcription as model_text
            const transcript = serverContent?.outputTranscription?.text;
            if (transcript) {
              safeSend({ type: "model_text", text: transcript });
            }

            // Relay audio chunks to browser (browser feeds them to Anam)
            const parts = serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                safeSend({
                    type: "audio_chunk",
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                });
              }
            }

            if (serverContent?.turnComplete) {
              safeSend({ type: "turn_complete" });
            }
          },
          onerror: (error) => {
            if (clientClosed) return;
            console.error("[live] Gemini error:", error);
            safeSend({ type: "error", message: error.message || "Gemini Live error" });
          },
          onclose: (event) => {
            liveConnected = false;
            if (clientClosed) return;
            safeSend({
                type: "live_closed",
                message: `Gemini Live disconnected${event?.reason ? `: ${event.reason}` : ""}`,
            });
          },
        },
      });
    }

    async function connectAssembly() {
      if (!assembly) return;

      assemblyTranscriber = assembly.streaming.transcriber({
        sampleRate: 16_000,
        speechModel: "universal-streaming-english",
        formatTurns: true,
        languageDetection: false,
        minTurnSilence: 700,
      });

      assemblyTranscriber.on("turn", (turn) => {
        if (!turn?.transcript) return;
        safeSend({
            type: "user_transcription",
            text: turn.transcript,
            finished: !!turn.end_of_turn,
        });
      });

      assemblyTranscriber.on("error", (error) => {
        console.error("[live] AssemblyAI error:", error);
        safeSend({ type: "status", message: "User transcription temporarily unavailable." });
      });

      assemblyTranscriber.on("close", () => { assemblyConnected = false; });

      await assemblyTranscriber.connect();
      assemblyConnected = true;
    }

    // ── Incoming messages from browser ──────────────────────────────────────

    clientSocket.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // session_context — bootstraps the live session with all context
        if (msg.type === "session_context") {
          if (sessionBootstrapped) return;
          sessionBootstrapped = true;

          sessionCustomContext      = (msg.customContext || "").trim();
          sessionThreadContext      = (msg.threadContext || "").trim();
          sessionUploadContextText  = (msg.upload?.contextText || "").trim();
          sessionUploadFileName     = (msg.upload?.fileName || "").trim();
          sessionCompanyUrl         = (msg.companyUrl || "").trim();
          sessionExternalResearch   = msg.externalResearch || null;

          console.log("[live] session_context", {
            agentSlug,
            hasCustomContext: Boolean(sessionCustomContext),
            hasThreadContext: Boolean(sessionThreadContext),
            uploadFileName: sessionUploadFileName || null,
            hasExternalResearch: Boolean(sessionExternalResearch),
          });

          try {
            if (clientClosed) return;
            await connectLive();
            if (clientClosed) { try { await geminiSession?.close(); } catch (_) {} return; }
            await connectAssembly();
            if (clientClosed) return;
            kickoffTimer = setTimeout(() => {
              sendKickoff(
                agentConfig.sessionKickoff ||
                  `Begin this ${agentConfig.name} rehearsal with a short greeting, quick introduction, and the first question.`,
              );
            }, 700);
          } catch (error) {
            if (clientClosed) {
              console.log("[live] client disconnected during session setup — ignoring");
              return;
            }
            console.error("[live] failed to open session:", error);
            try { safeSend({ type: "error", message: error.message || "Failed to start Gemini Live session" }); } catch (_) {}
            try { clientSocket.close(); } catch (_) {}
          }
          return;
        }

        // user_audio — forward PCM to Gemini + AssemblyAI
        if (msg.type === "user_audio") {
          if (!liveConnected || !geminiSession) return;

          geminiSession.sendRealtimeInput({
            audio: { data: msg.data, mimeType: msg.mimeType || "audio/pcm;rate=16000" },
          });

          if (assemblyTranscriber && assemblyConnected) {
            queueMicrotask(() => {
              try {
                const pcmBytes = Buffer.from(msg.data, "base64");
                assemblyTranscriber.sendAudio(pcmBytes);
              } catch (err) {
                console.error("[live] AssemblyAI audio forward error:", err);
              }
            });
          }
          return;
        }

        // screen_frame — forward JPEG to Gemini
        if (msg.type === "screen_frame") {
          if (!liveConnected || !geminiSession || !msg.data) return;
          geminiSession.sendRealtimeInput({
            video: { data: msg.data, mimeType: msg.mimeType || "image/jpeg" },
          });
          return;
        }

        // screen_share_state — notify Gemini that screen share started/stopped
        if (msg.type === "screen_share_state") {
          if (!liveConnected || !geminiSession) return;
          const surface = (msg.surface || "screen").trim();
          if (msg.active) {
            geminiSession.sendRealtimeInput({
              text:
                `The user has started sharing a live ${surface}. ` +
                (agentConfig.screenShareInstruction ||
                  "Use what is visibly shown as passive visual context only. Ask grounded questions about the visible material. Do not claim to click or inspect hidden state."),
            });
          } else {
            geminiSession.sendRealtimeInput({
              text: "The live screen share has ended. Continue the conversation using only the spoken discussion and any grounded context already provided.",
            });
          }
          return;
        }

        // code_snapshot — send code as hidden context to Gemini
        if (msg.type === "code_snapshot") {
          const snapshot = (msg.snapshot || "").trim();
          if (!snapshot || !liveConnected || !geminiSession) return;
          geminiSession.sendRealtimeInput({
            text: `For your internal interview context only, here is the candidate's current code in ${msg.language || "pseudocode"}.\nDo not read it aloud, do not quote it verbatim, and do not answer with code.\n\n${snapshot}`,
          });
          return;
        }

        // end_session — clean up
        if (msg.type === "end_session") {
          if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
          try { await geminiSession?.close(); } catch (_) {}
          try { await assemblyTranscriber?.close(); } catch (_) {}
          liveConnected = false;
          safeSend({ type: "live_closed", message: "Session ended." });
          return;
        }

        // get_history — return the server-side transcript mirror
        if (msg.type === "get_history") {
          safeSend({ type: "history", history: conversationHistory });
          return;
        }

        // save_model_text — append model utterance and broadcast updated history
        if (msg.type === "save_model_text") {
          const text = (msg.text || "").trim();
          if (!text) return;
          conversationHistory.push({ role: "model", text });
          safeSend({ type: "history", history: conversationHistory });
          return;
        }

        // user_text — typed user turn: forward to Gemini, then commit to history
        if (msg.type === "user_text") {
          const text = (msg.text || "").trim();
          if (!text) return;
          if (!liveConnected || !geminiSession) {
            safeSend({ type: "error", message: "Live session not ready — message not sent." });
            return;
          }
          geminiSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text }] }],
            turnComplete: true,
          });
          conversationHistory.push({ role: "user", text });
          safeSend({ type: "history", history: conversationHistory });
          return;
        }

        // kickoff — explicit client-initiated opening turn
        if (msg.type === "kickoff") {
          sendKickoff(msg.text || "");
          return;
        }

      } catch (error) {
        console.error("[live] message error:", error);
        safeSend({ type: "error", message: error.message || "Invalid message" });
      }
    });

    clientSocket.on("close", async () => {
      clientClosed = true;
      if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
      try { await geminiSession?.close(); } catch (_) {}
      try { await assemblyTranscriber?.close(); } catch (_) {}
    });
  }

  // Upgrade /api/live to WebSocket
  server.on("upgrade", (request, socket, head) => {
    if ((request.url || "").startsWith("/api/live")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });
}

// ─── HTTP server + Express routes ────────────────────────────────────────────

async function startServer() {
  await nextApp.prepare();
  const nextUpgradeHandler = nextApp.getUpgradeHandler();

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Anam session token
  app.post("/api/anam-session-token", async (req, res) => {
    try {
      const { keyIndex, avatarId: requestedAvatarId, avatarName: requestedAvatarName } = req.body || {};

      // Support multiple Anam keys for panel mode
      const anamKeys = (process.env.ANAM_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
      const singleKey = (process.env.ANAM_API_KEY || "").trim();
      let anamApiKey;

      if (typeof keyIndex === "number" && anamKeys.length > 0) {
        anamApiKey = anamKeys[keyIndex % anamKeys.length] || singleKey;
      } else {
        anamApiKey = singleKey || anamKeys[0];
      }

      if (!anamApiKey) {
        return res.status(500).json({ error: "Missing ANAM_API_KEY." });
      }

      // Use requested avatar (panel mode) or pick random
      const avatarProfile = requestedAvatarId
        ? { name: requestedAvatarName || "Panelist", avatarId: requestedAvatarId }
        : pickRandomAnamProfile();

      const response = await fetch("https://api.anam.ai/v1/auth/session-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anamApiKey}`,
        },
        body: JSON.stringify({
          personaConfig: {
            name: avatarProfile.name,
            avatarId: avatarProfile.avatarId,
            enableAudioPassthrough: true,
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.sessionToken) {
        return res.status(response.status || 500).json({
          error: "Failed to create Anam session token.",
          details: payload?.message || payload?.error || "Unknown Anam error.",
        });
      }

      return res.json({
        ok: true,
        sessionToken: payload.sessionToken,
        avatarProfile: {
          name: avatarProfile.name,
          avatarId: avatarProfile.avatarId,
          gender: avatarProfile.gender || "Unknown",
          voiceName: avatarProfile.voiceName || "",
        },
      });
    } catch (error) {
      console.error("[anam-session-token] error:", error);
      return res.status(500).json({ error: "Failed to create Anam session token.", details: error.message });
    }
  });

  // PDF upload — parse with pdf-parse, clean with Gemini
  app.post("/api/upload-deck", upload.single("deck"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
      }

      const fileBuffer = fs.readFileSync(req.file.path);
      const parser = new PDFParse({ data: fileBuffer });
      const parsed = await parser.getText();
      const rawText = (parsed.text || "").trim();
      await parser.destroy?.();

      fs.unlink(req.file.path, () => {});

      if (!rawText) {
        return res.status(400).json({ error: "Could not extract text from PDF." });
      }

      const ai = new GoogleGenAI({ apiKey: getGeminiApiKey("uploadPrep") });

      const prepResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are preparing grounded context for a live conversational interview/presentation agent.

The following text was parsed from an uploaded PDF and may be messy, out of order, or contain formatting artifacts.

Your task:
- infer what kind of document this is
- rewrite it into clean, organized text
- preserve only grounded information from the document
- do not invent anything
- remove parsing noise, duplication, and broken formatting
- keep important names, projects, roles, metrics, requirements, and claims
- produce plain text only
- make the result useful as context for a live conversational AI agent

Return a clean text memo with sections when helpful.

Parsed PDF text:
${rawText}`,
      });

      const uploadedContextText = (prepResponse.text || "").trim();
      const uploadedFileName = req.file.originalname;

      if (!uploadedContextText) {
        return res.status(500).json({ error: "Failed to create grounded context." });
      }

      return res.json({
        ok: true,
        fileName: uploadedFileName,
        contextPreview: uploadedContextText.slice(0, 1000),
        contextText: uploadedContextText,
      });
    } catch (error) {
      console.error("Deck upload error:", error);
      return res.status(500).json({ error: "Failed to upload and process PDF.", details: error.message });
    }
  });

  // External research — LangChain agent with Firecrawl tools
  app.post("/api/agent-external-context", async (req, res) => {
    try {
      const { agentSlug, companyUrl, customContext, upload: uploadBody } = req.body || {};
      const normalizedUrl = normalizeHttpUrl(companyUrl);

      if (!normalizedUrl) {
        return res.json({ ok: true, research: null, message: "No valid company URL was provided." });
      }

      const research = await generateExternalResearchForAgent({
        agentSlug: agentSlug || "custom",
        companyUrl: normalizedUrl,
        customContext: (customContext || "").trim(),
        uploadContextText: (uploadBody?.contextText || "").trim(),
      });

      return res.json({
        ok: true,
        research,
        message: research ? "External research fetched." : "No grounded external research could be confirmed.",
      });
    } catch (error) {
      console.error("External research generation error:", error);
      return res.status(500).json({ error: "Failed to fetch external research context.", details: error.message });
    }
  });

  // Session evaluation — calls Gemini with structured JSON schema
  app.post("/api/evaluate-session", async (req, res) => {
    try {
      const { agentSlug, transcript, upload, coding, customContext, durationLabel, startedAt, endedAt } = req.body || {};
      const agent = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;
      const transcriptText = buildTranscriptText(transcript);

      if (!transcriptText) {
        return res.status(400).json({ error: "A completed transcript is required for evaluation." });
      }

      const criteriaBlock = (agent.evaluationCriteria || [])
        .map((c, i) => `${i + 1}. ${c.label}: ${c.description}`)
        .join("\n");

      const uploadContext = upload?.contextText?.trim() || "No uploaded file context was provided for this session.";
      const codingContext = buildCodingContext(coding);
      const userContext = customContext?.trim() || "No additional text context was provided for this session.";

      const ai = new GoogleGenAI({ apiKey: getGeminiApiKey("evaluation") });

      const evaluationPrompt = `
Agent: ${agent.name}
Scenario: ${agent.scenario}
Session duration: ${durationLabel || "Unknown"}
Started at: ${startedAt || "Unknown"}
Ended at: ${endedAt || "Unknown"}

Rubric dimensions:
${criteriaBlock}

Instructions:
- Return scores only for the rubric dimensions listed above.
- Use a 0 to 100 integer score for every metric and for the overall score.
- Be specific and fair.
- Ground every metric justification in actual transcript evidence.
- Treat uploaded document context as supporting background only when it is relevant.
- Do not invent transcript details, file details, or performance claims.
- Strengths, improvements, and recommendations should be concise, concrete, and non-redundant.
- Keep the feedback human and useful, not robotic.
- Return up to 2 resource briefs for the most important improvement areas.
- Each resource brief should be distinct and should help a later web-search tool find concrete learning resources.
- Use the saved code when it is relevant, but do not pretend the code was executed.

Uploaded file context:
${uploadContext}

Additional user-provided context:
${userContext}

${codingContext ? `${codingContext}\n\n` : ""}Complete labeled transcript:
${transcriptText}
      `.trim();

      const evaluationResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: evaluationPrompt,
        config: {
          systemInstruction: agent.evaluationPrompt,
          responseMimeType: "application/json",
          responseSchema: evaluationResponseSchema,
        },
      });

      const parsed = JSON.parse((evaluationResponse.text || "").trim());
      const evaluation = normalizeEvaluationResult(agent, parsed);

      return res.json({ ok: true, evaluation });
    } catch (error) {
      console.error("Session evaluation error:", error);
      return res.status(500).json({ error: "Failed to evaluate session.", details: error.message });
    }
  });

  // Improvement resources — Firecrawl search + Gemini curation
  app.post("/api/session-resources", async (req, res) => {
    try {
      if (!process.env.FIRECRAWL_API_KEY) {
        return res.status(400).json({ error: "Firecrawl API key must be configured." });
      }

      const { resourceBriefs, agentSlug } = req.body || {};
      const briefs = Array.isArray(resourceBriefs) ? resourceBriefs.slice(0, 2) : [];

      if (!briefs.length) {
        return res.json({ ok: true, topics: [] });
      }

      const topics = await Promise.all(
        briefs.map(async (brief, index) => {
          const items = await fetchResourcesForBrief({ ...brief, agentSlug });
          return {
            id: brief.id || `topic-${index + 1}`,
            topic: brief.topic,
            improvement: brief.improvement,
            whyThisMatters: brief.whyThisMatters,
            items: items.slice(0, 4),
          };
        }),
      );

      return res.json({ ok: true, topics });
    } catch (error) {
      console.error("Resource search error:", error);
      return res.status(500).json({ error: "Failed to fetch improvement resources.", details: error.message });
    }
  });

  // Thread evaluation — longitudinal analysis across sessions
  app.post("/api/evaluate-thread", async (req, res) => {
    try {
      const { agentSlug, thread, sessions } = req.body || {};
      const agent = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;
      const orderedSessions = Array.isArray(sessions) ? [...sessions] : [];

      if (!orderedSessions.length) {
        return res.status(400).json({ error: "At least one completed session is required for thread evaluation." });
      }

      const criteriaBlock = (agent.evaluationCriteria || [])
        .map((c, i) => `${i + 1}. ${c.label}: ${c.description}`)
        .join("\n");

      const now = Date.now();
      const sessionDigest = orderedSessions
        .map((session, index) => {
          const endedAt = new Date(session.endedAt || session.startedAt || now).getTime();
          const ageDays = Math.max(0, (now - endedAt) / (1000 * 60 * 60 * 24));
          const recencyWeight = Math.max(0.15, Number(Math.exp(-ageDays / 21).toFixed(2)));
          const metricsText = (session.evaluation?.metrics || [])
            .map((m) => `- ${m.label}: ${m.value}`)
            .join("\n");

          return `
Session ${index + 1}
- Name: ${session.sessionName || "Untitled"}
- Ended at: ${session.endedAt || "Unknown"}
- Duration: ${session.durationLabel || "Unknown"}
- Recency weight: ${recencyWeight}
- Overall score: ${session.evaluation?.score ?? "Unknown"}
- Summary: ${session.evaluation?.summary || "No session summary"}
- Strengths: ${(session.evaluation?.strengths || []).join("; ") || "None"}
- Improvements: ${(session.evaluation?.improvements || []).join("; ") || "None"}
- Metric scores:
${metricsText || "- None"}
          `.trim();
        })
        .join("\n\n");

      const prompt = `
Agent: ${agent.name}
Thread title: ${thread?.title || "Untitled thread"}
Rubric dimensions:
${criteriaBlock}

You are evaluating a whole practice thread, not a single session.

Instructions:
- Analyze improvement over time across the sessions below.
- Weight newer sessions more heavily than older ones.
- Treat repeated weaknesses across multiple sessions as important, even if some sessions are older.
- The visible thread evaluation should talk about trajectory, repeated strengths, repeated gaps, and the best next areas to improve.
- Focus on user behavior patterns only: clarity, specificity, composure, confidence, evidence use, directness, structure, and response handling.
- Do not carry forward old technical details, subject matter specifics, project facts, or prior presentation content as thread memory.
- The thread memory is for adapting to the user's behavioral patterns, not for remembering the exact content topic from prior sessions.
- nextSessionFocus should explain what the next session will quietly probe more based on the user's behavior patterns.
- The hidden guidance must be internal-only and must never be written as something the live interviewer says explicitly.
- Hidden guidance should tell the next live session what to probe more, what to probe less, and how to adapt pressure based on this thread.
- Hidden guidance must explicitly say not to mention prior sessions or stored weaknesses to the user.
- Keep comments concise and useful.

Thread sessions:
${sessionDigest}
      `.trim();

      const ai = new GoogleGenAI({ apiKey: getGeminiApiKey("evaluation") });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You analyze longitudinal performance for the ${agent.name} agent. Be grounded, concise, and evidence-based. Distinguish between visible thread feedback and hidden internal session guidance. The hidden guidance is for internal steering only and must never be phrased for direct disclosure to the user.`,
          responseMimeType: "application/json",
          responseSchema: threadEvaluationResponseSchema,
        },
      });

      const parsed = JSON.parse((response.text || "").trim());
      console.log("[thread-eval] generated", {
        agentSlug,
        threadId: thread?.id || null,
        summary: parsed.summary,
        nextSessionFocus: parsed.nextSessionFocus,
        hiddenGuidancePreview: (parsed.hiddenGuidance || "").slice(0, 240),
      });

      return res.json({ ok: true, threadEvaluation: parsed });
    } catch (error) {
      console.error("Thread evaluation error:", error);
      return res.status(500).json({ error: "Failed to evaluate thread.", details: error.message });
    }
  });

  // Session comparison — compare two evaluations via Gemini
  app.post("/api/compare-sessions", async (req, res) => {
    try {
      const { agentSlug, currentSession, baselineSession } = req.body || {};
      const agent = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;
      const currentEvaluation = currentSession?.evaluation;
      const baselineEvaluation = baselineSession?.evaluation;

      if (!currentEvaluation || !baselineEvaluation) {
        return res.status(400).json({ error: "Two completed session evaluations are required for comparison." });
      }

      const criteriaBlock = (agent.evaluationCriteria || [])
        .map((c, i) => `${i + 1}. ${c.label}: ${c.description}`)
        .join("\n");

      const ai = new GoogleGenAI({ apiKey: getGeminiApiKey("evaluation") });

      const comparisonPrompt = `
Agent: ${agent.name}
Scenario: ${agent.scenario}

Rubric dimensions:
${criteriaBlock}

Current session:
- Ended at: ${currentSession?.endedAt || "Unknown"}
- Duration: ${currentSession?.durationLabel || "Unknown"}
- Overall score: ${currentEvaluation?.score ?? "Unknown"}

Current session metric scores:
${(currentEvaluation?.metrics || []).map((m) => `- ${m.label}: ${m.value}`).join("\n")}

Current session summary:
${currentEvaluation?.summary || "No summary was saved."}

Earlier comparison session:
- Ended at: ${baselineSession?.endedAt || "Unknown"}
- Duration: ${baselineSession?.durationLabel || "Unknown"}
- Overall score: ${baselineEvaluation?.score ?? "Unknown"}

Earlier session metric scores:
${(baselineEvaluation?.metrics || []).map((m) => `- ${m.label}: ${m.value}`).join("\n")}

Earlier session summary:
${baselineEvaluation?.summary || "No summary was saved."}

Instructions:
- Compare the current session against the earlier session.
- Judge whether the user improved, stayed similar, declined, or had mixed movement.
- Keep wording concise and human.
- Use the rubric dimensions only.
- Return one short overall summary and one short insight per metric.
- The delta should be current minus earlier.
- Address the user directly as "you".
- Never refer to the user as "the agent", "the speaker", or "the candidate".
      `.trim();

      const comparisonResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: comparisonPrompt,
        config: {
          systemInstruction: 'You compare two saved rehearsal evaluations for the same agent. Be concise, evidence-based, and metric-aware. Address the user directly as "you" and never call them "agent", "speaker", or "candidate".',
          responseMimeType: "application/json",
          responseSchema: comparisonResponseSchema,
        },
      });

      const parsed = JSON.parse((comparisonResponse.text || "").trim());
      const comparison = normalizeComparisonResult(agent, parsed, currentEvaluation, baselineEvaluation);

      return res.json({ ok: true, comparison });
    } catch (error) {
      console.error("Session comparison error:", error);
      return res.status(500).json({ error: "Failed to compare sessions.", details: error.message });
    }
  });

  // Fallthrough to Next.js
  app.all(/.*/, (req, res) => handle(req, res));

  const server = http.createServer(app);

  // Register WebSocket bridge
  registerLiveBridge(server);

  // Let Next.js handle non-live upgrades (HMR etc.)
  server.on("upgrade", (request, socket, head) => {
    if (!(request.url || "").startsWith("/api/live")) {
      nextUpgradeHandler(request, socket, head);
    }
  });

  server.listen(port, hostname, () => {
    console.log(`SimCoach running at http://${hostname}:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
