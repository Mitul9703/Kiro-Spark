"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Trash2, Plus } from "lucide-react";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center">
            Agent not found.{" "}
            <Link href="/agents" className="text-primary underline-offset-4 hover:underline">
              Back to agents.
            </Link>
          </CardContent>
        </Card>
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
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/agents">
                <ArrowLeft className="size-4" /> Back
              </Link>
            </Button>
            <Badge variant="secondary" className="tracking-wide uppercase">
              {agent.role}
            </Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{agent.name}</h1>
          <p className="text-muted-foreground max-w-2xl">{agent.longDescription}</p>
          <div className="flex flex-wrap gap-1.5">
            {agent.focus.map((item) => (
              <Badge key={item} variant="outline" className="font-normal">
                {item}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Scenario</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{agent.scenario}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evaluation Criteria</CardTitle>
                <CardDescription>
                  Sessions in this agent will be scored on the following dimensions.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {visibleCriteria.map((criterion) => (
                    <div key={criterion.label} className="bg-card/50 rounded-lg border p-3">
                      <div className="text-sm font-semibold">{criterion.label}</div>
                      <p className="text-muted-foreground mt-1 text-xs">{criterion.description}</p>
                    </div>
                  ))}
                </div>
                {criteria.length > 4 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => setCriteriaExpanded((c) => !c)}
                    aria-expanded={criteriaExpanded}
                  >
                    {criteriaExpanded ? (
                      <>
                        <ChevronUp className="size-4" /> Show fewer
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-4" /> Show all {criteria.length} criteria
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Threads
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Create a new thread</CardTitle>
                    <CardDescription className="mt-1">
                      Start a fresh practice track, then set up the next session from inside that
                      thread.
                    </CardDescription>
                  </div>
                  <Button onClick={handleCreateThread}>
                    <Plus className="size-4" /> New thread
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="thread-name-input">
                    New thread name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="thread-name-input"
                    value={agentState.threadName || ""}
                    onChange={(event) => {
                      setLocalError("");
                      patchAgent(slug, (current) => ({
                        ...current,
                        threadName: event.target.value,
                      }));
                    }}
                    placeholder={`e.g. ${agent.name} weekly practice`}
                    aria-invalid={!!localError}
                    aria-describedby={localError ? "thread-name-error" : undefined}
                  />
                  {localError ? (
                    <p id="thread-name-error" role="alert" className="text-destructive text-xs">
                      {localError}
                    </p>
                  ) : null}
                </div>

                {justEnded ? (
                  <Alert>
                    <AlertTitle>Session ended.</AlertTitle>
                    <AlertDescription>
                      Open the thread to review evaluation or start the next session.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Separator />

                {threads.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                    No threads yet. Create a new one to begin.
                  </p>
                ) : (
                  <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto pr-1">
                    {threads.map((thread) => (
                      <div key={thread.id} className="bg-card/40 rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold">{thread.title}</div>
                          <Badge variant="outline">{thread.sessionIds?.length || 0} sessions</Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Updated {new Date(thread.updatedAt).toLocaleString()}
                        </p>
                        {thread.evaluation?.status === "processing" &&
                        (thread.sessionIds?.length || 0) > 0 ? (
                          <Badge variant="warning" className="mt-2">
                            <Loader2 className="size-3 animate-spin" />
                            Evaluating thread…
                          </Badge>
                        ) : null}
                        {thread.evaluation?.status === "completed" &&
                        thread.evaluation?.result?.summary ? (
                          <p className="text-muted-foreground mt-2 text-xs">
                            {thread.evaluation.result.summary}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setLocalError("");
                              selectThread(slug, thread.id);
                              router.push(`/agents/${slug}/threads/${thread.id}`);
                            }}
                          >
                            Continue thread
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/agents/${slug}/threads/${thread.id}`}>View</Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete thread "${thread.title}"`}
                            title={`Delete thread "${thread.title}"`}
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Delete the thread "${thread.title}" and all of its sessions?`,
                              );
                              if (!confirmed) return;
                              deleteThread(slug, thread.id);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
