"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";

const CRITERIA_COLOR = "criteria-label-accent";

export function AgentDetailPage({ slug }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, patchAgent, createThread, selectThread, deleteThread } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const [localError, setLocalError] = useState("");
  const [criteriaExpanded, setCriteriaExpanded] = useState(false);
  const justEnded = searchParams.get("ended") === "1";

  const agentState = state.agents[slug];
  const threads = state.threads?.[slug] || [];

  if (!agent || !agentState) {
    return (
      <AppShell>
        <div className="empty-state">
          Agent not found. <Link href="/agents">Back to agents.</Link>
        </div>
      </AppShell>
    );
  }

  function handleCreateThread() {
    if (!agentState.threadName?.trim()) {
      setLocalError("Thread name is required.");
      return;
    }

    const thread = createThread(slug, agentState.threadName);
    setLocalError("");
    router.push(`/agents/${slug}/threads/${thread.id}`);
  }

  const criteria = agent.evaluationCriteria || [];
  const visibleCriteria = criteriaExpanded ? criteria : criteria.slice(0, 4);

  return (
    <AppShell>
      <div className="page-single">
        <div>
          <div className="nav-row">
            <Link href="/agents" className="btn btn-secondary">
              ← Back
            </Link>
            <div className="eyebrow">{agent.role}</div>
          </div>
          <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", margin: "0 0 12px" }}>
            {agent.name}
          </h1>
          <p className="muted-copy" style={{ margin: "0 0 16px", maxWidth: 620 }}>
            {agent.longDescription}
          </p>
          <div className="pill-row">
            {agent.focus.map((item) => (
              <span className="pill" key={item}>{item}</span>
            ))}
          </div>
        </div>

        <div className="metric-card">
          <div className="section-title">Scenario</div>
          <p className="muted-copy" style={{ margin: 0 }}>{agent.scenario}</p>
        </div>

        <div className="metric-card">
          <div className="section-title">Evaluation Criteria</div>
          <p className="muted-copy" style={{ marginBottom: 0 }}>
            Sessions in this agent will be scored on the following dimensions.
          </p>
          <div className="criteria-grid">
            {visibleCriteria.map((criterion) => (
              <div className="subtle-card" key={criterion.label}>
                <span className={`metric-label criteria-label ${CRITERIA_COLOR}`}>
                  {criterion.label}
                </span>
                <p className="muted-copy" style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>
                  {criterion.description}
                </p>
              </div>
            ))}
          </div>
          {criteria.length > 4 && (
            <button
              type="button"
              className="toggle-btn"
              onClick={() => setCriteriaExpanded((current) => !current)}
            >
              {criteriaExpanded ? "▲ Show fewer" : `▼ Show all ${criteria.length} criteria`}
            </button>
          )}
        </div>

        <div className="section-divider">Threads</div>

        <div className="metric-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 4 }}>Create a new thread</div>
              <p className="muted-copy" style={{ margin: 0 }}>
                Start a fresh practice track, then set up the next session from inside that thread.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={handleCreateThread}>
              New thread
            </button>
          </div>

          <div className="subtle-card" style={{ marginBottom: 14 }}>
            <span className="metric-label" style={{ marginBottom: 8 }}>
              New thread name <span style={{ color: "var(--danger)" }}>*</span>
            </span>
            <input
              className="context-textarea"
              type="text"
              value={agentState.threadName || ""}
              onChange={(event) => {
                setLocalError("");
                patchAgent(slug, (current) => ({ ...current, threadName: event.target.value }));
              }}
              placeholder={`e.g. ${agent.name} weekly practice`}
              style={{ minHeight: 50, resize: "none" }}
            />
          </div>

          {localError ? (
            <p className="muted-copy" style={{ color: "var(--danger)", marginBottom: 10 }}>
              {localError}
            </p>
          ) : null}

          {justEnded ? (
            <div className="status-chip status-success" style={{ marginBottom: 14, width: "fit-content" }}>
              <span className="status-dot" />
              Session ended. Open the thread to review evaluation or start the next session.
            </div>
          ) : null}

          {threads.length === 0 ? (
            <div className="empty-state">
              No threads yet. Create a new one to begin.
            </div>
          ) : (
            <div className="sidebar-stack" style={{ maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
              {threads.map((thread) => (
                <div className="session-list-item" key={thread.id}>
                  <div className="session-list-top">
                    <strong>{thread.title}</strong>
                    <span className="pill">{thread.sessionIds?.length || 0} sessions</span>
                  </div>
                  <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                    Updated {new Date(thread.updatedAt).toLocaleString()}
                  </p>
                  {thread.evaluation?.status === "processing" && (thread.sessionIds?.length || 0) > 0 ? (
                    <div className="status-chip status-warning" style={{ marginTop: 10, width: "fit-content" }}>
                      <div className="spinner spinner-xs" style={{ margin: 0 }} />
                      Evaluating thread…
                    </div>
                  ) : null}
                  {thread.evaluation?.status === "completed" && thread.evaluation?.result?.summary ? (
                    <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                      {thread.evaluation.result.summary}
                    </p>
                  ) : null}
                  <div className="button-row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setLocalError("");
                        selectThread(slug, thread.id);
                        router.push(`/agents/${slug}/threads/${thread.id}`);
                      }}
                    >
                      Continue thread
                    </button>
                    <Link href={`/agents/${slug}/threads/${thread.id}`} className="btn btn-secondary">
                      View
                    </Link>
                    <button
                      type="button"
                      className="btn btn-icon btn-danger-icon"
                      aria-label="Delete thread"
                      title="Delete thread"
                      onClick={() => {
                        const confirmed = window.confirm(`Delete the thread "${thread.title}" and all of its sessions?`);
                        if (!confirmed) return;
                        deleteThread(slug, thread.id);
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
