"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import { AGENT_LOOKUP } from "../lib/agents";
import { getApiUrl } from "../lib/client-config";
import { AppShell } from "./shell";
import { useAppState, useAppActions } from "./app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

function CollapsibleSection({ title, defaultOpen = false, children, action = null }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card/40 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {title}
        </Button>
        {action}
      </div>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

const RESEARCH_SLUGS = ["coding", "investor", "investor-panel", "custom", "recruiter"];

export function ThreadDetailPage({ slug, threadId }) {
  const router = useRouter();
  const { state, patchAgent, selectThread, deleteThread, deleteSession } = useAppState();
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
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <strong className="text-base">Thread not found</strong>
            <p className="text-muted-foreground text-sm">
              This thread may have been deleted or the link is invalid.
            </p>
            <Button variant="outline" asChild>
              <Link href={`/agents/${slug}`}>Back to {agent?.name || "agent"}</Link>
            </Button>
          </CardContent>
        </Card>
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
      upload: {
        ...current.upload,
        status: "uploading",
        fileName: file.name,
        previewUrl,
        previewOpen: false,
        contextPreview: "",
        error: "",
      },
    }));
    setPreviewOpen(false);
    try {
      const formData = new FormData();
      formData.append("deck", file);
      const response = await fetch(getApiUrl("/api/upload-deck"), {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      patchAgent(slug, (current) => ({
        ...current,
        upload: {
          ...current.upload,
          status: "success",
          fileName: data.fileName || file.name,
          previewUrl,
          previewOpen: false,
          contextPreview: data.contextPreview || "",
          contextText: data.contextText || "",
          error: "",
        },
      }));
    } catch (error) {
      patchAgent(slug, (current) => ({
        ...current,
        upload: {
          ...current.upload,
          status: "error",
          error: error.message || "Upload failed.",
        },
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
      researchPrep: RESEARCH_SLUGS.includes(slug)
        ? { status: "idle", result: null, error: "" }
        : current.researchPrep,
    }));

    if (RESEARCH_SLUGS.includes(slug) && researchEnabled) {
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
                ? { fileName: upload.fileName || "", contextText: upload.contextText }
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
  const averageScore = sessions.length
    ? Math.round(
        sessions
          .filter((session) => session.evaluation?.result?.score != null)
          .reduce((sum, session) => sum + session.evaluation.result.score, 0) /
          Math.max(
            1,
            sessions.filter((session) => session.evaluation?.result?.score != null).length,
          ),
      )
    : 0;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/agents/${slug}`}>
                <ArrowLeft className="size-4" /> Back
              </Link>
            </Button>
            <Badge variant="secondary" className="tracking-wide uppercase">
              Thread
            </Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{thread.title}</h1>
          <p className="text-muted-foreground text-sm">
            {sessions.length} session{sessions.length === 1 ? "" : "s"} in this thread · updated{" "}
            {new Date(thread.updatedAt).toLocaleString()}
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Thread Overview</CardTitle>
                <CardDescription className="mt-1">
                  Start a new session in this thread, inspect thread-level progress, and review
                  previous sessions.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Delete thread "${thread.title}"`}
                title={`Delete thread "${thread.title}"`}
                onClick={() => {
                  const confirmed = window.confirm(
                    `Delete the thread "${thread.title}" and all its sessions?`,
                  );
                  if (!confirmed) return;
                  deleteThread(slug, threadId);
                  router.push(`/agents/${slug}`);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  Sessions
                </div>
                <div className="text-2xl font-semibold">{sessions.length}</div>
              </div>
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  Average score
                </div>
                <div className="text-2xl font-semibold">{averageScore || "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-lg">
                <Play className="size-4" />
              </div>
              <CardTitle>Start a New Session</CardTitle>
            </div>
            <CardDescription>
              Name your session, add context, and launch your rehearsal.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="session-name">
                Session name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="session-name"
                value={agentState.sessionName || ""}
                onChange={(event) => {
                  setLocalError("");
                  patchAgent(slug, (current) => ({
                    ...current,
                    sessionName: event.target.value,
                  }));
                }}
                placeholder={`e.g. ${agent.name} practice #${sessions.length + 1}`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="bg-card/40 flex flex-col gap-3 rounded-lg border p-4">
                <Label htmlFor="custom-context">
                  {agent.contextFieldLabel || "Optional context"}
                </Label>
                <Textarea
                  id="custom-context"
                  value={agentState.customContextText || ""}
                  onChange={(event) =>
                    patchAgent(slug, (current) => ({
                      ...current,
                      customContextText: event.target.value,
                    }))
                  }
                  placeholder={
                    agent.contextFieldDescription || "Add any context you want the agent to use."
                  }
                  className="min-h-[120px]"
                />

                {RESEARCH_SLUGS.includes(slug) ? (
                  <div className="flex flex-col gap-3">
                    <Label htmlFor="company-url">Company URL</Label>
                    <Input
                      id="company-url"
                      value={agentState.companyUrl || ""}
                      onChange={(event) =>
                        patchAgent(slug, (current) => ({
                          ...current,
                          companyUrl: event.target.value,
                          researchPrep:
                            current.researchPrep?.status === "loading"
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
                    />
                    <div className="flex items-center gap-2">
                      <Switch
                        id="research-toggle"
                        checked={researchEnabled}
                        onCheckedChange={setResearchEnabled}
                      />
                      <Label htmlFor="research-toggle" className="text-muted-foreground text-xs">
                        {researchEnabled
                          ? "Fetch external research before session"
                          : "Skip external research — start faster"}
                      </Label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="bg-card/40 flex flex-col gap-3 rounded-lg border p-4">
                <Label>Supporting document</Label>
                {upload.status === "uploading" ? (
                  <div className="bg-background/50 flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
                    <Loader2 className="text-muted-foreground size-6 animate-spin" />
                    <span className="text-muted-foreground text-sm">Uploading…</span>
                  </div>
                ) : (
                  <label
                    htmlFor="deck-upload-thread"
                    className="bg-background/50 hover:border-primary/40 hover:bg-accent/30 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors"
                  >
                    {upload.status === "success" ? (
                      <FileText className="text-primary size-7" />
                    ) : (
                      <Upload className="text-muted-foreground size-7" />
                    )}
                    <span className="text-sm font-medium">
                      {upload.status === "success"
                        ? upload.fileName
                        : "Drag & drop or click to upload"}
                    </span>
                    <span className="text-muted-foreground text-xs">Optional · PDF only</span>
                  </label>
                )}
                <input
                  id="deck-upload-thread"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  disabled={
                    upload.status === "uploading" || agentState.session.status === "starting"
                  }
                  className="hidden"
                />
                {upload.status === "success" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">{upload.fileName} ready</Badge>
                    {upload.previewUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewOpen((current) => !current)}
                      >
                        {previewOpen ? (
                          <>
                            <ChevronUp className="size-4" /> Hide preview
                          </>
                        ) : (
                          <>
                            <ChevronDown className="size-4" /> Preview document
                          </>
                        )}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {upload.status === "error" ? (
                  <Badge variant="destructive">{upload.error || "Upload failed."}</Badge>
                ) : null}
              </div>
            </div>

            {upload.status === "success" && upload.previewUrl && previewOpen ? (
              <iframe
                src={upload.previewUrl}
                title="Document preview"
                className="h-[420px] w-full rounded-lg border"
              />
            ) : null}

            {localError ? <p className="text-destructive text-sm">{localError}</p> : null}

            <div className="flex flex-col items-start gap-2">
              <Button
                size="lg"
                disabled={!canStart}
                onClick={startSession}
                className="px-8 text-base"
              >
                {upload.status === "uploading" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Preparing upload…
                  </>
                ) : researchPrep.status === "loading" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Fetching company context…
                  </>
                ) : agentState.session.status === "starting" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Starting session…
                  </>
                ) : (
                  <>
                    <Play className="size-4" /> Start Session
                  </>
                )}
              </Button>
              {!agentState.sessionName?.trim() && (
                <span className="text-muted-foreground text-xs">
                  Enter a session name above to continue
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thread Evaluation</CardTitle>
          </CardHeader>
          <CardContent>
            {evaluation.status === "processing" ? (
              <Alert>
                <Loader2 className="size-4 animate-spin" />
                <AlertTitle>Evaluating thread…</AlertTitle>
                <AlertDescription>
                  Building a thread-level view of progress, memory, and next-session focus.
                </AlertDescription>
              </Alert>
            ) : evaluation.status === "failed" ? (
              <Alert variant="destructive">
                <AlertTitle>Thread evaluation failed</AlertTitle>
                <AlertDescription>
                  <p>{evaluation.error || "The thread evaluation could not be completed."}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => actions.retryThreadEvaluation(thread.agentSlug, thread.id)}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            ) : evaluation.status === "idle" || !evaluation.result ? (
              <p className="bg-card/40 text-muted-foreground rounded-lg border p-4 text-sm">
                Thread evaluation will run automatically after you complete a session. It tracks
                progress, trajectory, and focus across all sessions in this thread.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-muted-foreground text-sm">{evaluation.result?.summary}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="bg-card/40 rounded-lg border p-3">
                    <div className="text-muted-foreground text-xs tracking-wide uppercase">
                      Trajectory
                    </div>
                    <div className="text-sm font-semibold">{evaluation.result?.trajectory}</div>
                  </div>
                  <div className="bg-card/40 rounded-lg border p-3">
                    <div className="text-muted-foreground text-xs tracking-wide uppercase">
                      Next session focus
                    </div>
                    <div className="text-sm font-semibold">
                      {evaluation.result?.nextSessionFocus || "—"}
                    </div>
                  </div>
                </div>

                <CollapsibleSection title="Metric trends">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(evaluation.result?.metricTrends || []).map((metric) => (
                      <div className="bg-card/40 rounded-lg border p-3" key={metric.label}>
                        <div className="text-muted-foreground text-xs tracking-wide uppercase">
                          {metric.label}
                        </div>
                        <div className="font-semibold capitalize">{metric.trend}</div>
                        <p className="text-muted-foreground mt-1 text-xs">{metric.comment}</p>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="Recurring strengths">
                  <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                    {(evaluation.result?.strengths || []).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </CollapsibleSection>

                <CollapsibleSection title="Areas to improve">
                  <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                    {(evaluation.result?.focusAreas || []).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </CollapsibleSection>

                <CollapsibleSection title="Thread comments">
                  <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                    {(evaluation.result?.comments || []).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </CollapsibleSection>

                <CollapsibleSection title="Thread memory">
                  <pre className="bg-card overflow-x-auto rounded-lg border p-3 text-xs">
                    {thread.memory?.hiddenGuidance || "No hidden memory has been stored yet."}
                  </pre>
                </CollapsibleSection>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Past Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-6 text-center">
                <strong className="text-base">No sessions yet</strong>
                <p className="text-muted-foreground text-sm">
                  Start your first session above and it will appear here after you finish.
                </p>
              </div>
            ) : (
              <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto pr-1">
                {sessions.map((session) => {
                  const score = session.evaluation?.result?.score ?? null;
                  const scoreVariant =
                    score == null
                      ? "outline"
                      : score >= 80
                        ? "success"
                        : score >= 60
                          ? "warning"
                          : "destructive";
                  return (
                    <div key={session.id} className="bg-card/40 rounded-lg border p-3">
                      <Link
                        href={`/agents/${slug}/sessions/${session.id}`}
                        className="block text-inherit no-underline"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <strong>{session.sessionName || "Untitled session"}</strong>
                          <div className="flex items-center gap-2">
                            {score != null ? <Badge variant={scoreVariant}>{score}</Badge> : null}
                            <Badge variant="outline">{session.durationLabel}</Badge>
                          </div>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {new Date(session.endedAt).toLocaleString()}
                        </p>
                        {score != null ? (
                          <Progress
                            value={score}
                            className={cn(
                              "mt-2 h-1",
                              score >= 80
                                ? "bg-[color:var(--success)]/20"
                                : score >= 60
                                  ? "bg-[color:var(--warning)]/20"
                                  : "bg-destructive/20",
                            )}
                            indicatorClassName={
                              score >= 80
                                ? "bg-[color:var(--success)]"
                                : score >= 60
                                  ? "bg-[color:var(--warning)]"
                                  : "bg-destructive"
                            }
                          />
                        ) : (
                          <p className="text-muted-foreground/80 mt-1 text-xs">
                            Evaluation pending
                          </p>
                        )}
                      </Link>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/agents/${slug}/sessions/${session.id}`}>Open session</Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete session "${session.sessionName || "Untitled session"}"`}
                          title={`Delete session "${session.sessionName || "Untitled session"}"`}
                          onClick={() => {
                            const confirmed = window.confirm(
                              `Delete the session "${session.sessionName || "Untitled session"}"?`,
                            );
                            if (!confirmed) return;
                            deleteSession(slug, session.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />
      </div>
    </AppShell>
  );
}
