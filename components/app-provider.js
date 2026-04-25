"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AGENTS } from "../lib/agents";
import { getApiUrl } from "../lib/client-config";

const AppContext = createContext(null);
const STORAGE_KEY = "simcoach-state-v1";

function buildDefaultComparison() {
  return {
    status: "idle",
    baselineSessionId: "",
    result: null,
    error: "",
  };
}

function buildDefaultThreadEvaluation() {
  return {
    status: "idle",
    result: null,
    error: "",
  };
}

function buildDefaultEvaluation(agent) {
  return {
    score: 0,
    metrics: (agent.evaluationCriteria || []).map((criterion) => ({
      label: criterion.label,
      value: 0,
    })),
  };
}

function buildInitialAgentState() {
  return AGENTS.reduce((acc, agent) => {
    acc[agent.slug] = {
      upload: {
        status: "idle",
        fileName: "",
        previewUrl: "",
        previewOpen: false,
        contextPreview: "",
        contextText: "",
        error: "",
      },
      sessionName: "",
      threadName: "",
      customContextText: "",
      companyUrl: "",
      researchPrep: {
        status: "idle",
        result: null,
        error: "",
      },
      selectedThreadId: "",
      session: {
        status: "idle",
        muted: false,
        lastEndedAt: "",
        lastDurationLabel: "00:00",
      },
      evaluation: buildDefaultEvaluation(agent),
      rating: 0,
    };
    return acc;
  }, {});
}

function buildPersistedAgents(agents) {
  const initial = buildInitialAgentState();
  return AGENTS.reduce((acc, agent) => {
    const current = agents?.[agent.slug] || initial[agent.slug];
    acc[agent.slug] = {
      session: {
        status: "idle",
        muted: false,
        lastEndedAt: current.session?.lastEndedAt || "",
        lastDurationLabel: current.session?.lastDurationLabel || "00:00",
      },
      sessionName: current.sessionName || "",
      selectedThreadId: current.selectedThreadId || "",
      threadName: current.threadName || "",
      customContextText: current.customContextText || "",
      companyUrl: current.companyUrl || "",
      researchPrep: {
        status: current.researchPrep?.status || current.questionPrep?.status || "idle",
        result: current.researchPrep?.result || current.questionPrep?.result || null,
        error: current.researchPrep?.error || current.questionPrep?.error || "",
      },
      evaluation: {
        ...current.evaluation,
      },
      rating: current.rating || 0,
    };
    return acc;
  }, {});
}

function buildInitialSessions() {
  return AGENTS.reduce((acc, agent) => {
    acc[agent.slug] = [];
    return acc;
  }, {});
}

function buildInitialThreads() {
  return AGENTS.reduce((acc, agent) => {
    acc[agent.slug] = [];
    return acc;
  }, {});
}

function sanitizeState(state) {
  const initial = buildInitialAgentState();
  const threads = buildInitialThreads();
  const sessions = buildInitialSessions();

  if (!state || typeof state !== "object") {
    return {
      theme: "dark",
      agents: initial,
      threads,
      sessions,
    };
  }

  for (const agent of AGENTS) {
    const saved = state.agents?.[agent.slug];
    if (!saved) continue;

    initial[agent.slug] = {
      upload: {
        ...initial[agent.slug].upload,
      },
      session: {
        ...initial[agent.slug].session,
        ...saved.session,
      },
      selectedThreadId: saved.selectedThreadId || "",
      sessionName: saved.sessionName || "",
      threadName: saved.threadName || "",
      customContextText: saved.customContextText || "",
      companyUrl: saved.companyUrl || "",
      researchPrep: {
        status: saved.researchPrep?.status || saved.questionPrep?.status || "idle",
        result: saved.researchPrep?.result || saved.questionPrep?.result || null,
        error: saved.researchPrep?.error || saved.questionPrep?.error || "",
      },
      evaluation: {
        ...initial[agent.slug].evaluation,
        ...saved.evaluation,
      },
      rating: saved.rating || 0,
    };
  }

  for (const agent of AGENTS) {
    const savedThreads = Array.isArray(state.threads?.[agent.slug])
      ? state.threads[agent.slug]
      : [];
    threads[agent.slug] = savedThreads.map((thread) => ({
      ...thread,
      sessionIds: Array.isArray(thread.sessionIds) ? thread.sessionIds : [],
      evaluation: thread.evaluation || buildDefaultThreadEvaluation(),
      memory: thread.memory || {
        hiddenGuidance: "",
        summary: "",
        focusAreas: [],
        updatedAt: "",
      },
    }));
  }

  for (const agent of AGENTS) {
    const savedSessions = Array.isArray(state.sessions?.[agent.slug])
      ? state.sessions[agent.slug]
      : [];
    sessions[agent.slug] = savedSessions.map((session) => ({
      ...session,
      sessionName: typeof session.sessionName === "string" ? session.sessionName : "",
      transcript: Array.isArray(session.transcript) ? session.transcript : [],
      upload: session.upload || null,
      externalResearch: session.externalResearch || null,
      evaluation: session.evaluation || {
        status: "processing",
        startedAt: new Date().toISOString(),
      },
      resources: session.resources || {
        status: "idle",
        briefs: [],
        topics: [],
        error: "",
      },
      comparison: session.comparison || buildDefaultComparison(),
      threadId: session.threadId || "",
    }));
  }

  return {
    theme: state.theme === "light" ? "light" : "dark",
    agents: initial,
    threads,
    sessions,
  };
}

function deriveResourceBriefs(agentSlug, evaluation) {
  const briefs = Array.isArray(evaluation?.resourceBriefs)
    ? evaluation.resourceBriefs.filter(Boolean)
    : [];

  if (briefs.length) {
    return briefs.slice(0, 2);
  }

  const metrics = Array.isArray(evaluation?.metrics) ? evaluation.metrics : [];
  const sortedMetrics = [...metrics]
    .filter((metric) => typeof metric?.value === "number")
    .sort((a, b) => a.value - b.value);
  const improvements = Array.isArray(evaluation?.improvements)
    ? evaluation.improvements.filter(Boolean)
    : [];

  const fallback = [];

  if (improvements[0]) {
    fallback.push({
      id: "fallback-1",
      topic: sortedMetrics[0]?.label || "Primary improvement area",
      improvement: improvements[0],
      whyThisMatters:
        sortedMetrics[0]?.justification ||
        "This was one of the clearest opportunities for improvement in the evaluation.",
      searchPhrases: [
        `${agentSlug} interview ${improvements[0]}`,
        `${sortedMetrics[0]?.label || "communication"} improvement practice`,
      ],
      resourceTypes: agentSlug === "coding"
        ? ["youtube", "leetcode", "website"]
        : ["youtube", "article", "website"],
    });
  }

  if (improvements[1]) {
    fallback.push({
      id: "fallback-2",
      topic: sortedMetrics[1]?.label || "Secondary improvement area",
      improvement: improvements[1],
      whyThisMatters:
        sortedMetrics[1]?.justification ||
        "This was another important skill to strengthen based on the evaluation.",
      searchPhrases: [
        `${agentSlug} interview ${improvements[1]}`,
        `${sortedMetrics[1]?.label || "practice"} examples`,
      ],
      resourceTypes: agentSlug === "coding"
        ? ["youtube", "leetcode", "website"]
        : ["youtube", "article", "website"],
    });
  }

  return fallback;
}

export function AppProvider({ children }) {
  const [state, setState] = useState(() =>
    sanitizeState({
      theme: "dark",
      agents: buildInitialAgentState(),
      threads: buildInitialThreads(),
      sessions: buildInitialSessions(),
    }),
  );
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState([]);
  const evaluationJobsRef = useRef(new Map());
  const resourceJobsRef = useRef(new Map());
  const comparisonJobsRef = useRef(new Map());
  const threadJobsRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(sanitizeState(JSON.parse(raw)));
      }
    } catch (_error) {}
    setMounted(true);
  }, []);

  const setTheme = useCallback((theme) => {
    setState((current) => ({
      ...current,
      theme,
    }));
  }, []);

  const patchAgent = useCallback((slug, updater) => {
    setState((current) => {
      const previous = current.agents[slug];
      return {
        ...current,
        agents: {
          ...current.agents,
          [slug]: typeof updater === "function" ? updater(previous) : previous,
        },
      };
    });
  }, []);

  const patchSession = useCallback((slug, sessionId, updater) => {
    setState((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [slug]: (current.sessions[slug] || []).map((session) =>
          session.id === sessionId ? updater(session) : session,
        ),
      },
    }));
  }, []);

  const patchThread = useCallback((slug, threadId, updater) => {
    setState((current) => ({
      ...current,
      threads: {
        ...current.threads,
        [slug]: (current.threads[slug] || []).map((thread) =>
          thread.id === threadId ? updater(thread) : thread,
        ),
      },
    }));
  }, []);

  const createThread = useCallback((slug, title) => {
    const now = new Date().toISOString();
    const thread = {
      id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentSlug: slug,
      title: (title || "").trim() || `${AGENTS.find((agent) => agent.slug === slug)?.name || "Practice"} thread`,
      createdAt: now,
      updatedAt: now,
      sessionIds: [],
      evaluation: buildDefaultThreadEvaluation(),
      memory: {
        hiddenGuidance: "",
        summary: "",
        focusAreas: [],
        updatedAt: "",
      },
    };

    setState((current) => ({
      ...current,
      agents: {
        ...current.agents,
        [slug]: {
          ...current.agents[slug],
          selectedThreadId: thread.id,
          threadName: "",
        },
      },
      threads: {
        ...current.threads,
        [slug]: [thread, ...(current.threads[slug] || [])],
      },
    }));

    return thread;
  }, []);

  const selectThread = useCallback((slug, threadId) => {
    setState((current) => ({
      ...current,
      agents: {
        ...current.agents,
        [slug]: {
          ...current.agents[slug],
          selectedThreadId: threadId,
        },
      },
    }));
  }, []);

  const clearAgentSessions = useCallback(
    (slug) => {
      const sessionsToClear = state.sessions?.[slug] || [];

      sessionsToClear.forEach((session) => {
        const key = `${slug}:${session.id}`;
        const evaluationController = evaluationJobsRef.current.get(key);
        if (evaluationController) {
          evaluationController.abort();
          evaluationJobsRef.current.delete(key);
        }

        const resourceController = resourceJobsRef.current.get(key);
        if (resourceController) {
          resourceController.abort();
          resourceJobsRef.current.delete(key);
        }

        const comparisonController = comparisonJobsRef.current.get(key);
        if (comparisonController) {
          comparisonController.abort();
          comparisonJobsRef.current.delete(key);
        }
      });

      (state.threads?.[slug] || []).forEach((thread) => {
        const key = `${slug}:${thread.id}`;
        const threadController = threadJobsRef.current.get(key);
        if (threadController) {
          threadController.abort();
          threadJobsRef.current.delete(key);
        }
      });

      setState((current) => ({
        ...current,
        agents: {
          ...current.agents,
          [slug]: {
            ...current.agents[slug],
            selectedThreadId: "",
          },
        },
        threads: {
          ...current.threads,
          [slug]: [],
        },
        sessions: {
          ...current.sessions,
          [slug]: [],
        },
      }));
    },
    [state.sessions, state.threads],
  );

  const deleteSession = useCallback(
    (slug, sessionId) => {
      const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);
      if (!session) return;

      const key = `${slug}:${session.id}`;
      const evaluationController = evaluationJobsRef.current.get(key);
      if (evaluationController) {
        evaluationController.abort();
        evaluationJobsRef.current.delete(key);
      }
      const resourceController = resourceJobsRef.current.get(key);
      if (resourceController) {
        resourceController.abort();
        resourceJobsRef.current.delete(key);
      }
      const comparisonController = comparisonJobsRef.current.get(key);
      if (comparisonController) {
        comparisonController.abort();
        comparisonJobsRef.current.delete(key);
      }

      setState((current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [slug]: (current.sessions?.[slug] || []).filter((item) => item.id !== sessionId),
        },
        threads: {
          ...current.threads,
          [slug]: (current.threads?.[slug] || []).map((thread) =>
            thread.id === session.threadId
              ? {
                  ...thread,
                  updatedAt: new Date().toISOString(),
                  sessionIds: (thread.sessionIds || []).filter((id) => id !== sessionId),
                  evaluation: {
                    ...thread.evaluation,
                    status: (thread.sessionIds || []).filter((id) => id !== sessionId).length
                      ? "processing"
                      : "idle",
                    result: (thread.sessionIds || []).filter((id) => id !== sessionId).length
                      ? thread.evaluation?.result
                      : null,
                    error: "",
                  },
                }
              : thread,
          ),
        },
      }));
    },
    [state.sessions],
  );

  const deleteThread = useCallback(
    (slug, threadId) => {
      const thread = (state.threads?.[slug] || []).find((item) => item.id === threadId);
      if (!thread) return;

      (thread.sessionIds || []).forEach((sessionId) => {
        const key = `${slug}:${sessionId}`;
        const evaluationController = evaluationJobsRef.current.get(key);
        if (evaluationController) {
          evaluationController.abort();
          evaluationJobsRef.current.delete(key);
        }
        const resourceController = resourceJobsRef.current.get(key);
        if (resourceController) {
          resourceController.abort();
          resourceJobsRef.current.delete(key);
        }
        const comparisonController = comparisonJobsRef.current.get(key);
        if (comparisonController) {
          comparisonController.abort();
          comparisonJobsRef.current.delete(key);
        }
      });

      const threadController = threadJobsRef.current.get(`${slug}:${threadId}`);
      if (threadController) {
        threadController.abort();
        threadJobsRef.current.delete(`${slug}:${threadId}`);
      }

      setState((current) => ({
        ...current,
        agents: {
          ...current.agents,
          [slug]: {
            ...current.agents[slug],
            selectedThreadId:
              current.agents[slug]?.selectedThreadId === threadId
                ? ""
                : current.agents[slug]?.selectedThreadId || "",
          },
        },
        threads: {
          ...current.threads,
          [slug]: (current.threads?.[slug] || []).filter((item) => item.id !== threadId),
        },
        sessions: {
          ...current.sessions,
          [slug]: (current.sessions?.[slug] || []).filter((session) => session.threadId !== threadId),
        },
      }));
    },
    [state.threads],
  );

  const runResourceJob = useCallback(
    async (session) => {
      const jobKey = `${session.agentSlug}:${session.id}`;
      if (resourceJobsRef.current.has(jobKey)) return;

      const briefs = session.resources?.briefs || [];
      if (!briefs.length) {
        patchSession(session.agentSlug, session.id, (cur) => ({
          ...cur,
          resources: { ...cur.resources, status: "completed", completedAt: new Date().toISOString(), error: "" },
        }));
        return;
      }

      const abortController = new AbortController();
      resourceJobsRef.current.set(jobKey, abortController);

      patchSession(session.agentSlug, session.id, (cur) => ({
        ...cur,
        resources: { ...cur.resources, status: "processing", startedAt: cur.resources?.startedAt || new Date().toISOString(), error: "" },
      }));

      try {
        const response = await fetch(getApiUrl("/api/session-resources"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentSlug: session.agentSlug, sessionId: session.id, resourceBriefs: briefs }),
          signal: abortController.signal,
        });

        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to fetch resources.");

        patchSession(session.agentSlug, session.id, (cur) => ({
          ...cur,
          resources: { ...cur.resources, status: "completed", completedAt: new Date().toISOString(), topics: payload.topics || [], error: "" },
        }));

        pushToast(`${session.agentName || "Session"} resources are ready.`);
      } catch (error) {
        if (abortController.signal.aborted) return;
        patchSession(session.agentSlug, session.id, (cur) => ({
          ...cur,
          resources: { ...cur.resources, status: "failed", failedAt: new Date().toISOString(), error: error.message || "Resource search failed." },
        }));
      } finally {
        resourceJobsRef.current.delete(jobKey);
      }
    },
    [patchSession, pushToast],
  );

  const runThreadEvaluationJob = useCallback(
    async (slug, threadId) => {
      // Placeholder — immediately mark as completed with stub result
      // Real thread evaluation will be wired in a later iteration
      patchThread(slug, threadId, (currentThread) => ({
        ...currentThread,
        updatedAt: new Date().toISOString(),
        evaluation: {
          status: "completed",
          completedAt: new Date().toISOString(),
          result: {
            summary: "Thread evaluation not yet implemented.",
            trajectory: "—",
            comments: [],
            strengths: [],
            focusAreas: [],
            nextSessionFocus: "—",
            metricTrends: [],
            hiddenGuidance: "",
          },
          error: "",
        },
      }));
    },
    [patchThread],
  );

  const runEvaluationJob = useCallback(
    async (session) => {
      const jobKey = `${session.agentSlug}:${session.id}`;
      if (evaluationJobsRef.current.has(jobKey)) return;

      const abortController = new AbortController();
      evaluationJobsRef.current.set(jobKey, abortController);

      patchSession(session.agentSlug, session.id, (cur) => ({
        ...cur,
        evaluation: { ...cur.evaluation, status: "processing", startedAt: cur.evaluation?.startedAt || cur.endedAt || new Date().toISOString(), error: "" },
      }));

      try {
        const response = await fetch(getApiUrl("/api/evaluate-session"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentSlug: session.agentSlug,
            sessionId: session.id,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            durationLabel: session.durationLabel,
            transcript: session.transcript || [],
            upload: session.upload || null,
            coding: session.coding || null,
            customContext: session.customContext || "",
          }),
          signal: abortController.signal,
        });

        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to evaluate session.");

        const derivedBriefs = deriveResourceBriefs(session.agentSlug, payload.evaluation);

        patchSession(session.agentSlug, session.id, (cur) => ({
          ...cur,
          evaluation: {
            status: "completed",
            startedAt: cur.evaluation?.startedAt || session.evaluation?.startedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            result: payload.evaluation,
            error: "",
          },
          resources: {
            status: derivedBriefs.length ? "idle" : "completed",
            startedAt: "",
            completedAt: derivedBriefs.length ? "" : new Date().toISOString(),
            briefs: derivedBriefs,
            topics: [],
            error: "",
          },
        }));

        pushToast(`${session.agentName || "Session"} evaluation is ready.`);
      } catch (error) {
        if (abortController.signal.aborted) return;
        patchSession(session.agentSlug, session.id, (cur) => ({
          ...cur,
          evaluation: { ...cur.evaluation, status: "failed", failedAt: new Date().toISOString(), error: error.message || "Evaluation failed." },
        }));
        pushToast(`${session.agentName || "Session"} evaluation could not be completed.`);
      } finally {
        evaluationJobsRef.current.delete(jobKey);
      }
    },
    [patchSession, pushToast, runResourceJob],
  );

  const requestResourceFetch = useCallback(
    (slug, sessionId) => {
      const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);
      if (!session || !session.resources?.briefs?.length) {
        return;
      }

      void runResourceJob(session);
    },
    [runResourceJob, state.sessions],
  );

  const runComparisonJob = useCallback(
    async (session, baselineSessionId) => {
      // Placeholder — comparison not yet implemented
      patchSession(session.agentSlug, session.id, (currentSession) => ({
        ...currentSession,
        comparison: {
          status: "completed",
          baselineSessionId,
          completedAt: new Date().toISOString(),
          result: {
            trend: "similar",
            summary: "Session comparison not yet implemented.",
            metrics: [],
          },
          error: "",
        },
      }));
    },
    [patchSession],
  );

  const requestSessionComparison = useCallback(
    (slug, sessionId, baselineSessionId) => {
      const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);
      if (!session || !baselineSessionId) {
        return;
      }

      void runComparisonJob(session, baselineSessionId);
    },
    [runComparisonJob, state.sessions],
  );

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: state.theme,
        agents: buildPersistedAgents(state.agents),
        threads: state.threads,
        sessions: state.sessions,
      }),
    );
    document.documentElement.dataset.theme = state.theme;
  }, [mounted, state]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.theme = state.theme;
  }, [mounted, state.theme]);

  useEffect(() => {
    if (!mounted) return;

    AGENTS.forEach((agent) => {
      (state.threads[agent.slug] || []).forEach((thread) => {
        if (thread.evaluation?.status === "processing") {
          void runThreadEvaluationJob(agent.slug, thread.id);
        }
      });

      (state.sessions[agent.slug] || []).forEach((session) => {
        if (session.evaluation?.status === "processing") {
          void runEvaluationJob(session);
          return;
        }

        if (session.resources?.status === "processing") {
          void runResourceJob(session);
        }

        if (session.comparison?.status === "processing" && session.comparison?.baselineSessionId) {
          void runComparisonJob(session, session.comparison.baselineSessionId);
        }
      });
    });
  }, [mounted, runComparisonJob, runEvaluationJob, runResourceJob, runThreadEvaluationJob, state.sessions, state.threads]);

  useEffect(() => {
    return () => {
      for (const controller of evaluationJobsRef.current.values()) {
        controller.abort();
      }
      evaluationJobsRef.current.clear();
      for (const controller of resourceJobsRef.current.values()) {
        controller.abort();
      }
      resourceJobsRef.current.clear();
      for (const controller of comparisonJobsRef.current.values()) {
        controller.abort();
      }
      comparisonJobsRef.current.clear();
      for (const controller of threadJobsRef.current.values()) {
        controller.abort();
      }
      threadJobsRef.current.clear();
    };
  }, []);

  const createSessionRecord = useCallback(
    (session) => {
      const startedAt = new Date().toISOString();
      const sessionRecord = {
        ...session,
        evaluation: {
          status: "processing",
          startedAt,
          error: "",
        },
        resources: {
          status: "idle",
          briefs: [],
          topics: [],
          error: "",
        },
        comparison: buildDefaultComparison(),
      };

      setState((current) => ({
        ...current,
        threads: {
          ...current.threads,
          [session.agentSlug]: (current.threads[session.agentSlug] || []).map((thread) =>
            thread.id === session.threadId
              ? {
                  ...thread,
                  updatedAt: session.endedAt,
                  sessionIds: [session.id, ...(thread.sessionIds || [])],
                  evaluation: {
                    ...thread.evaluation,
                    status: "processing",
                    error: "",
                  },
                }
              : thread,
          ),
        },
        sessions: {
          ...current.sessions,
          [session.agentSlug]: [sessionRecord, ...(current.sessions[session.agentSlug] || [])],
        },
      }));

      void runEvaluationJob(sessionRecord);
      return sessionRecord;
    },
    [runEvaluationJob],
  );

  const value = useMemo(
    () => ({
      mounted,
      state,
      setTheme,
      patchAgent,
      patchSession,
      patchThread,
      clearAgentSessions,
      requestResourceFetch,
      requestSessionComparison,
      createSessionRecord,
      createThread,
      selectThread,
      deleteThread,
      deleteSession,
      runThreadEvaluationJob,
      dismissToast,
      toasts,
    }),
    [
      createSessionRecord,
      dismissToast,
      mounted,
      patchAgent,
      patchSession,
      patchThread,
      clearAgentSessions,
      requestResourceFetch,
      requestSessionComparison,
      setTheme,
      state,
      createThread,
      selectThread,
      deleteThread,
      deleteSession,
      runThreadEvaluationJob,
      toasts,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}
