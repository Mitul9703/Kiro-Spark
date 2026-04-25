import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import next from "next";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { AssemblyAI } from "assemblyai";
import { AGENT_LOOKUP } from "./lib/agents.js";

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

// ─── WebSocket live bridge ────────────────────────────────────────────────────

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

        // get_history — no server-side history in this impl; send empty
        if (msg.type === "get_history") {
          safeSend({ type: "history", history: [] });
          return;
        }

        // save_model_text — acknowledged, no-op server side
        if (msg.type === "save_model_text") return;

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
  });

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
      const anamApiKey = process.env.ANAM_API_KEY;
      if (!anamApiKey) {
        return res.status(500).json({ error: "Missing ANAM_API_KEY." });
      }

      const avatarProfile = pickRandomAnamProfile();

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
          gender: avatarProfile.gender,
          voiceName: avatarProfile.voiceName,
        },
      });
    } catch (error) {
      console.error("[anam-session-token] error:", error);
      return res.status(500).json({ error: "Failed to create Anam session token.", details: error.message });
    }
  });

  // Stub for agent-external-context — returns no research so session proceeds
  // (full LangChain implementation comes in a later iteration)
  app.post("/api/agent-external-context", async (req, res) => {
    const { companyUrl } = req.body || {};
    if (!companyUrl) {
      return res.json({ ok: true, research: null, message: "No company URL provided." });
    }
    return res.json({ ok: true, research: null, message: "External research not yet implemented." });
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

  // Stub: PDF upload (placeholder for next iteration)
  app.post("/api/upload-deck", async (req, res) => {
    return res.json({ ok: true, fileName: "", contextText: "", contextPreview: "", message: "PDF upload not yet implemented." });
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
