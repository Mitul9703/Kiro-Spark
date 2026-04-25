"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AGENT_LOOKUP } from "../lib/agents";
import { getApiUrl } from "../lib/client-config";
import { AppShell } from "./shell";
import { useAppState, useAppActions } from "./app-provider";

function CollapsibleSection({ title, defaultOpen = false, children, action = null }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="subtle-card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <button type="button" className="toggle-btn" style={{ marginTop: 0 }} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {open ? "▲" : "▼"} {title}
        </button>
        {action}
      </div>
      {open ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

export function ThreadDetailPage({ slug, threadId }) {
  const router = useRouter();
  const {
    state,
    patchAgent,
    selectThread,
    deleteThread,
    deleteSession,
  } = useAppState();
  const actions = useAppActions();
  const agent = AGENT_LOOKUP[slug];
  const agentState = state.agents?.[slug];
  const upload = agentState?.upload;
  const researchPrep = agentState?.researchPrep || { status: "idle", result: null, error: "" };
  const thread = (state.threads?.[slug] || []).find((item) => item.id === threadId);
  const sessions = (state.sessions?.[slug] || [])
    .filter((session) => session.threadId === threadId)
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());

  const [localError, setLocalError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [researchEnabled, setResearchEnabled] = useState(true);

  const canStart = useMemo(() => {
    return (
      upload?.status !== "uploading" &&
      agentState?.session?.status !== "starting" &&
      Boolean(agentState?.sessionName?.trim())
    );
  }, [agentState?.session?.status, agentState?.sessionName, upload?.status]);

  if (!agent || !thread || !agentState) {
    return (
      <AppShell>
        <div className="empty-state">
          <strong style={{ fontSize: "1rem", color: "var(--text)" }}>Thread not found</strong>
          <p>This thread may have been deleted or the link is invalid.</p>
          <Link href={`/agents/${slug}`} className="btn btn-secondary" style={{ marginTop: 4 }}>Back to {agent?.name || "agent"}</Link>
        </div>
      </AppShell>
    );
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    setLocalError("");
    if (!file) return;
    if (agentState.session.status === "active" || agentState.session.status === "starting") {
      setLocalError("Cannot change document while a session is active.");
      return;
    }
    if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
    const previewUrl = file.type === "application/pdf" ? URL.createObjectURL(file) : "";
    patchAgent(slug, (current) => ({
      ...current,
      upload: { ...current.upload, status: "uploading", fileName: file.name, previewUrl, previewOpen: false, contextPreview: "", error: "" },
    }));
    setPreviewOpen(false);
    try {
      const formData = new FormData();
      formData.append("deck", file);
      const response = await fetch(getApiUrl("/api/upload-deck"), { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      patchAgent(slug, (current) => ({
        ...current,
        upload: { ...current.upload, status: "success", fileName: data.fileName || file.name, previewUrl, previewOpen: false, contextPreview: data.contextPreview || "", contextText: data.contextText || "", error: "" },
      }));
    } catch (error) {
      patchAgent(slug, (current) => ({
        ...current,
        upload: { ...current.upload, status: "error", error: error.message || "Upload failed." },
      }));
    }
  }

  async function startSession() {
    if (!agentState.sessionName?.trim()) {
      setLocalError("Session name is required.");
      return;
    }
    if (!canStart) return;

    selectThread(slug, threadId);
    setLocalError("");
    patchAgent(slug, (current) => ({
      ...current,
      session: { ...current.session, status: "starting" },
      researchPrep: ["coding", "investor", "custom", "recruiter"].includes(slug)
        ? { status: "idle", result: null, error: "" }
        : current.researchPrep,
    }));

    if (["coding", "investor", "custom", "recruiter"].includes(slug) && researchEnabled) {
      const companyUrl = (agentState.companyUrl || "").trim();
      if (companyUrl) {
        patchAgent(slug, (current) => ({
          ...current,
          researchPrep: { status: "loading", result: null, error: "" },
        }));

        try {
          const response = await fetch(getApiUrl("/api/agent-external-context"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentSlug: slug,
              companyUrl,
              customContext: agentState.customContextText || "",
              upload: upload?.contextText
                ? {
                    fileName: upload.fileName || "",
                    contextText: upload.contextText,
                  }
                : null,
            }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Failed to fetch company context.");
          }
          patchAgent(slug, (current) => ({
            ...current,
            researchPrep: {
              status: payload.research ? "ready" : "idle",
              result: payload.research || null,
              error: payload.research ? "" : payload.message || "",
            },
          }));
        } catch (error) {
          patchAgent(slug, (current) => ({
            ...current,
            researchPrep: {
              status: "failed",
              result: null,
              error: error.message || "Could not fetch company research.",
            },
          }));
        }
      }
    }

    router.push(`/session/${slug}`);
  }

  const evaluation = thread.evaluation || { status: "idle" };
  const hasCompletedSessions = sessions.length > 0;
  const averageScore = sessions.length
    ? Math.round(
        sessions
          .filter((session) => session.evaluation?.result?.score != null)
          .reduce((sum, session) => sum + session.evaluation.result.score, 0) /
          Math.max(1, sessions.filter((session) => session.evaluation?.result?.score != null).length),
      )
    : 0;

  return (
    <AppShell>
      <div className="page-single" style={{ maxWidth: 920 }}>
        <div>
          <div className="nav-row">
            <Link href={`/agents/${slug}`} className="btn btn-secondary">← Back</Link>
            <div className="eyebrow">Thread</div>
          </div>
          <h1 className="hero-title" style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", margin: "0 0 8px" }}>
            {thread.title}
          </h1>
          <p className="muted-copy" style={{ margin: 0 }}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"} in this thread · updated {new Date(thread.updatedAt).toLocaleString()}
          </p>
        </div>

        <div className="metric-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 4 }}>Thread Overview</div>
              <p className="muted-copy" style={{ margin: 0 }}>
                This is the place to start a new session in the thread, inspect thread-level progress, and review previous sessions.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-icon btn-danger-icon"
              aria-label={`Delete thread "${thread.title}"`}
              title={`Delete thread "${thread.title}"`}
              onClick={() => {
                const confirmed = window.confirm(`Delete the thread "${thread.title}" and all its sessions?`);
                if (!confirmed) return;
                deleteThread(slug, threadId);
                router.push(`/agents/${slug}`);
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
          <div className="session-info-grid" style={{ marginTop: 14 }}>
            <div className="subtle-card">
              <span className="metric-label">Sessions</span>
              <div className="metric-value" style={{ fontSize: "1.5rem" }}>{sessions.length}</div>
            </div>
            <div className="subtle-card">
              <span className="metric-label">Average score</span>
              <div className="metric-value" style={{ fontSize: "1.5rem" }}>{averageScore || "—"}</div>
            </div>
          </div>
        </div>

        <div className="metric-card session-launchpad">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div className="launchpad-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3l14 9-14 9V3z"/>
              </svg>
            </div>
            <div className="section-title" style={{ margin: 0 }}>Start a New Session</div>
          </div>
          <p className="muted-copy" style={{ margin: "0 0 16px" }}>
            Name your session, add context, and launch your rehearsal.
          </p>
          <div className="subtle-card" style={{ marginBottom: 14 }}>
            <span className="metric-label">
              Session name <span style={{ color: "var(--danger)" }}>*</span>
            </span>
            <input
              className="context-textarea"
              type="text"
              value={agentState.sessionName || ""}
              onChange={(event) => {
                setLocalError("");
                patchAgent(slug, (current) => ({ ...current, sessionName: event.target.value }));
              }}
              placeholder={`e.g. ${agent.name} practice #${sessions.length + 1}`}
              style={{ minHeight: 50, resize: "none", marginTop: 8 }}
            />
          </div>

          <div className="context-cols">
            <div className="subtle-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="metric-label">{agent.contextFieldLabel || "Optional context"}</span>
              <textarea
                className="context-textarea"
                value={agentState.customContextText || ""}
                onChange={(event) =>
                  patchAgent(slug, (current) => ({ ...current, customContextText: event.target.value }))
                }
                placeholder={agent.contextFieldDescription || "Add any context you want the agent to use."}
                style={{ minHeight: 120, flex: 1 }}
              />

              {["coding", "investor", "custom", "recruiter"].includes(slug) ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <span className="metric-label">Company URL</span>
                  <input
                    className="context-textarea"
                    type="text"
                    value={agentState.companyUrl || ""}
                    onChange={(event) =>
                      patchAgent(slug, (current) => ({
                        ...current,
                        companyUrl: event.target.value,
                        researchPrep: current.researchPrep?.status === "loading"
                          ? current.researchPrep
                          : { status: "idle", result: null, error: "" },
                      }))
                    }
                    placeholder={
                      slug === "coding"
                        ? "Optional · company URL for coding-question research"
                        : slug === "investor"
                          ? "Optional · company or product URL for investor research"
                          : "Optional · URL for public web context"
                    }
                    style={{ minHeight: 52, resize: "none" }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginTop: 4 }}>
                    <span
                      role="switch"
                      aria-checked={researchEnabled}
                      tabIndex={0}
                      onClick={() => setResearchEnabled((c) => !c)}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setResearchEnabled((c) => !c); } }}
                      style={{
                        display: "inline-block",
                        width: 40,
                        height: 22,
                        borderRadius: 999,
                        background: researchEnabled ? "var(--accent)" : "var(--bg-strong)",
                        position: "relative",
                        transition: "background 160ms ease",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: "absolute",
                        top: 3,
                        left: researchEnabled ? 21 : 3,
                        width: 16,
                        height: 16,
                        borderRadius: 999,
                        background: "#fff",
                        transition: "left 160ms ease",
                      }} />
                    </span>
                    <span className="muted-copy" style={{ fontSize: "0.85rem" }}>
                      {researchEnabled ? "Fetch external research before session" : "Skip external research — start faster"}
                    </span>
                  </label>
                </div>
              ) : null}
            </div>

            <div className="subtle-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="metric-label">Supporting document</span>
              {upload.status === "uploading" ? (
                <div className="file-dropzone file-dropzone-loading" style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: "24px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <div className="spinner spinner-sm" style={{ margin: "0 auto 8px" }} />
                  <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>Uploading…</span>
                </div>
              ) : (
                <label className="file-dropzone file-dropzone-dashed" htmlFor="deck-upload-thread" style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: "28px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", cursor: "pointer", transition: "border-color 180ms ease, background 180ms ease" }}>
                  <span className="file-dropzone-icon" style={{ fontSize: "2rem", lineHeight: 1 }}>{upload.status === "success" ? "📄" : "⬆"}</span>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{upload.status === "success" ? upload.fileName : "Drag & drop or click to upload"}</span>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", opacity: 0.7 }}>Optional · PDF only</span>
                </label>
              )}
              <input
                id="deck-upload-thread"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                disabled={upload.status === "uploading" || agentState.session.status === "starting"}
                style={{ display: "none" }}
              />
              {upload.status === "success" ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="status-chip status-success">
                    <span className="status-dot" />
                    {upload.fileName} ready
                  </div>
                  {upload.previewUrl ? (
                    <button
                      type="button"
                      className="toggle-btn"
                      style={{ marginTop: 0 }}
                      onClick={() => setPreviewOpen((current) => !current)}
                    >
                      {previewOpen ? "▲ Hide preview" : "▼ Preview document"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {upload.status === "error" ? (
                <div className="status-chip status-danger">
                  <span className="status-dot" />
                  {upload.error || "Upload failed."}
                </div>
              ) : null}
            </div>
          </div>

          {upload.status === "success" && upload.previewUrl && previewOpen ? (
            <div style={{ marginTop: 14 }}>
              <iframe
                src={upload.previewUrl}
                className="preview-frame"
                title="Document preview"
                style={{ height: 420 }}
              />
            </div>
          ) : null}

          {localError ? (
            <p className="muted-copy" style={{ color: "var(--danger)", marginTop: 12, marginBottom: 0 }}>
              {localError}
            </p>
          ) : null}

          <div className="launchpad-cta" style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
            <button type="button" className="btn btn-primary btn-start btn-launch" disabled={!canStart} onClick={startSession} style={{ fontSize: "1rem", padding: "14px 32px", letterSpacing: "0.02em" }}>
              {upload.status === "uploading" ? (
                <><div className="spinner spinner-sm spinner-inline" />Preparing upload…</>
              ) : researchPrep.status === "loading" ? (
                <><div className="spinner spinner-sm spinner-inline" />Fetching company context…</>
              ) : agentState.session.status === "starting" ? (
                <><div className="spinner spinner-sm spinner-inline" />Starting session…</>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }} aria-hidden="true">
                    <path d="M5 3l14 9-14 9V3z"/>
                  </svg>
                  Start Session
                </>
              )}
            </button>
            {!agentState.sessionName?.trim() && (
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", opacity: 0.7 }}>Enter a session name above to continue</span>
            )}
          </div>
        </div>

        <div className="metric-card">
          <div className="section-title">Thread Evaluation</div>
          {evaluation.status === "processing" ? (
            <div className="subtle-card">
              <div className="status-chip status-warning" style={{ width: "fit-content" }}>
                <div className="spinner spinner-xs" style={{ margin: 0 }} />
                Evaluating thread…
              </div>
              <p className="muted-copy" style={{ margin: "12px 0 0" }}>
                Building a thread-level view of progress, memory, and next-session focus.
              </p>
            </div>
          ) : evaluation.status === "failed" ? (
            <div className="subtle-card">
              <div className="status-chip status-danger">
                <span className="status-dot" />
                Thread evaluation failed
              </div>
              <p className="muted-copy" style={{ margin: "10px 0 12px" }}>
                {evaluation.error || "The thread evaluation could not be completed."}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => actions.retryThreadEvaluation(thread.agentSlug, thread.id)}
              >
                Try again
              </button>
            </div>
          ) : evaluation.status === "idle" || !evaluation.result ? (
            <div className="subtle-card">
              <p className="muted-copy" style={{ margin: 0, fontSize: "0.9rem" }}>
                Thread evaluation will run automatically after you complete a session. It tracks progress, trajectory, and focus across all sessions in this thread.
              </p>
            </div>
          ) : (
            <>
              <p className="muted-copy" style={{ marginTop: 0 }}>{evaluation.result?.summary}</p>
              <div className="session-info-grid">
                <div className="subtle-card">
                  <span className="metric-label">Trajectory</span>
                  <div style={{ fontWeight: 600 }}>{evaluation.result?.trajectory}</div>
                </div>
                <div className="subtle-card">
                  <span className="metric-label">Next session focus</span>
                  <div style={{ fontWeight: 600 }}>{evaluation.result?.nextSessionFocus || "—"}</div>
                </div>
              </div>

              <CollapsibleSection title="Metric trends">
                <div className="metrics-grid-2">
                  {(evaluation.result?.metricTrends || []).map((metric) => (
                    <div className="subtle-card" key={metric.label}>
                      <div className="metric-label">{metric.label}</div>
                      <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{metric.trend}</div>
                      <p className="muted-copy" style={{ margin: "8px 0 0", fontSize: "0.88rem" }}>
                        {metric.comment}
                      </p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Recurring strengths">
                <div className="collapsible-list">
                  {(evaluation.result?.strengths || []).map((item, index) => (
                    <div className="collapsible-list-item" key={index}>{item}</div>
                  ))}
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Areas to improve">
                <div className="collapsible-list">
                  {(evaluation.result?.focusAreas || []).map((item, index) => (
                    <div className="collapsible-list-item" key={index}>{item}</div>
                  ))}
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Thread comments">
                <div className="collapsible-list">
                  {(evaluation.result?.comments || []).map((item, index) => (
                    <div className="collapsible-list-item" key={index}>{item}</div>
                  ))}
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Thread memory">
                <pre className="code-block" style={{ whiteSpace: "pre-wrap" }}>
                  {thread.memory?.hiddenGuidance || "No hidden memory has been stored yet."}
                </pre>
              </CollapsibleSection>
            </>
          )}
        </div>

        <div className="metric-card">
          <div className="section-title">Past Sessions</div>
          {sessions.length === 0 ? (
            <div className="empty-state">
              <strong style={{ fontSize: "1rem", color: "var(--text)" }}>No sessions yet</strong>
              <p>Start your first session above and it will appear here after you finish.</p>
            </div>
          ) : (
            <div className="sidebar-stack" style={{ maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
              {sessions.map((session) => {
                const score = session.evaluation?.result?.score ?? null;
                const scoreColor = score == null ? "var(--text-muted)" : score >= 80 ? "var(--brand-green)" : score >= 60 ? "var(--brand-yellow)" : "var(--brand-red)";
                return (
                  <div className="session-list-item" key={session.id}>
                    <Link href={`/agents/${slug}/sessions/${session.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                      <div className="session-list-top">
                        <strong>{session.sessionName || "Untitled session"}</strong>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {score != null ? (
                            <span className="session-score-badge" style={{ background: `${scoreColor}22`, color: scoreColor, border: `1px solid ${scoreColor}44`, borderRadius: 6, padding: "2px 10px", fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.01em" }}>
                              {score}
                            </span>
                          ) : null}
                          <span className="pill">{session.durationLabel}</span>
                        </div>
                      </div>
                      <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                        {new Date(session.endedAt).toLocaleString()}
                      </p>
                      {score != null ? (
                        <div style={{ marginTop: 8 }}>
                          <div className="progress" style={{ height: 4 }}>
                            <span style={{ width: `${score}%`, background: scoreColor }} />
                          </div>
                        </div>
                      ) : (
                        <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.8rem", opacity: 0.6 }}>
                          Evaluation pending
                        </p>
                      )}
                    </Link>
                    <div className="button-row" style={{ marginTop: 12 }}>
                      <Link href={`/agents/${slug}/sessions/${session.id}`} className="btn btn-secondary">
                        Open session
                      </Link>
                      <button
                        type="button"
                        className="btn btn-icon btn-danger-icon"
                        aria-label={`Delete session "${session.sessionName || "Untitled session"}"`}
                        title={`Delete session "${session.sessionName || "Untitled session"}"`}
                        onClick={() => {
                          const confirmed = window.confirm(`Delete the session "${session.sessionName || "Untitled session"}"?`);
                          if (!confirmed) return;
                          deleteSession(slug, session.id);
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
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
