"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Loader2,
  Timer,
  Trash2,
} from "lucide-react";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState, useAppActions } from "./app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

function domainLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return url;
  }
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be";
  } catch (_) {
    return false;
  }
}

function YouTubeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label="YouTube"
      className="shrink-0 text-[#ff0000]"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function CollapsibleList({ items, initialMax = 4, label, variant = "neutral" }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialMax);
  const hasMore = items.length > initialMax;
  if (!items.length) return null;

  const iconClasses = {
    strength: "bg-[color:var(--success)]/15 text-[color:var(--success)]",
    improvement: "bg-[color:var(--warning)]/15 text-[color:var(--warning)]",
    neutral: "bg-muted text-muted-foreground",
  };
  const symbol = variant === "strength" ? "✓" : variant === "improvement" ? "△" : "›";

  return (
    <div className="bg-card/40 flex flex-col gap-2 rounded-lg border p-4">
      <div className="text-sm font-semibold">{label}</div>
      <div className="flex flex-col gap-2">
        {visible.map((item, i) => (
          <div className="flex items-start gap-2 text-sm" key={i}>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded text-xs font-bold",
                iconClasses[variant] || iconClasses.neutral,
              )}
            >
              {symbol}
            </span>
            <span className="flex-1">{item}</span>
          </div>
        ))}
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <>
              <ChevronUp className="size-4" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-4" /> Show all {items.length}
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function renderInlineMarkdown(text) {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code
          key={`${match.index}-code`}
          className="bg-muted rounded px-1 py-0.5 font-mono text-xs"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      parts.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : text;
}

function MarkdownRenderer({ content }) {
  if (!content?.trim()) {
    return <p className="text-muted-foreground text-sm">No content available.</p>;
  }

  const blocks = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (trimmed.startsWith("```")) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", content: codeLines.join("\n") });
      index += 1;
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    const paragraphLines = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        current.startsWith("```") ||
        /^(#{1,6})\s+/.test(current) ||
        /^[-*]\s+/.test(current)
      )
        break;
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", content: paragraphLines.join(" ") });
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          return (
            <div
              key={blockIndex}
              className={cn(
                "font-semibold tracking-tight",
                block.level <= 2 ? "text-base" : "text-sm",
              )}
            >
              {block.content}
            </div>
          );
        }
        if (block.type === "list") {
          return (
            <ul className="list-disc space-y-1 pl-5 text-sm" key={blockIndex}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "code") {
          return (
            <pre key={blockIndex} className="bg-card overflow-x-auto rounded-lg border p-3 text-xs">
              {block.content}
            </pre>
          );
        }
        return (
          <p key={blockIndex} className="text-muted-foreground text-sm">
            {renderInlineMarkdown(block.content)}
          </p>
        );
      })}
    </div>
  );
}

function MetricCard({ metric }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="bg-card/40 rounded-lg border p-3">
      <div className="text-muted-foreground text-xs tracking-wide uppercase">{metric.label}</div>
      <div className="mt-1 text-2xl font-semibold">
        {metric.value}
        <span className="text-muted-foreground/70 ml-0.5 text-base">%</span>
      </div>
      <Progress value={metric.value} className="mt-2 h-1.5" />
      {metric.justification && (
        <>
          {showDetail && (
            <p className="text-muted-foreground mt-2 text-xs">{metric.justification}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 -ml-2"
            onClick={() => setShowDetail((d) => !d)}
          >
            {showDetail ? (
              <>
                <ChevronUp className="size-3.5" /> Hide detail
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" /> Show detail
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}

export function SessionDetailPage({ slug, sessionId }) {
  const router = useRouter();
  const { state, requestResourceFetch, requestSessionComparison, deleteSession } = useAppState();
  const actions = useAppActions();
  const agent = AGENT_LOOKUP[slug];
  const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);

  const evaluation = session?.evaluation || { status: "idle" };
  const resources = session?.resources || { status: "idle", topics: [], briefs: [] };
  const comparison = session?.comparison || {
    status: "idle",
    baselineSessionId: "",
    result: null,
    error: "",
  };

  const comparisonOptions = useMemo(
    () =>
      (state.sessions?.[slug] || []).filter(
        (item) =>
          item.id !== sessionId &&
          item.threadId === session?.threadId &&
          item.evaluation?.status === "completed" &&
          item.evaluation?.result,
      ),
    [slug, sessionId, session?.threadId, state.sessions],
  );

  const [selectedComparisonId, setSelectedComparisonId] = useState(
    comparison.baselineSessionId || comparisonOptions[0]?.id || "",
  );
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  useEffect(() => {
    const preferredId =
      comparison.baselineSessionId &&
      comparisonOptions.some((item) => item.id === comparison.baselineSessionId)
        ? comparison.baselineSessionId
        : comparisonOptions[0]?.id || "";
    setSelectedComparisonId(preferredId);
  }, [comparison.baselineSessionId, comparisonOptions]);

  if (!agent || !session) {
    return (
      <AppShell>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <strong className="text-base">Session not found</strong>
            <p className="text-muted-foreground text-sm">
              This session may have been deleted or the link is invalid.
            </p>
            <Button variant="outline" asChild>
              <Link href={`/agents/${slug}`}>Back to {agent?.name || "agent"}</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

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
              Saved session
            </Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {session.sessionName || `${agent.name} session`}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              {new Date(session.endedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {new Date(session.endedAt).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Timer className="size-3.5" />
              {session.durationLabel}
            </span>
          </div>
          <div>
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
                const target = session.threadId
                  ? `/agents/${slug}/threads/${session.threadId}`
                  : `/agents/${slug}`;
                deleteSession(slug, session.id);
                router.push(target);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Session Info</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">Agent</div>
                <div className="font-semibold">{agent.name}</div>
              </div>
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  Supporting file
                </div>
                <div className="font-semibold">{session.upload?.fileName || "No file"}</div>
              </div>
            </div>
            {session.threadId ? (
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">Thread</div>
                <Link
                  href={`/agents/${slug}/threads/${session.threadId}`}
                  className="text-primary mt-1 inline-flex items-center gap-1 text-sm hover:underline"
                >
                  Open thread view <ExternalLink className="size-3" />
                </Link>
              </div>
            ) : null}
            {session.customContext && (
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  Extra context
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{session.customContext}</p>
              </div>
            )}
            {!session.coding && session.externalResearch?.markdown ? (
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  External research brief
                </div>
                <MarkdownRenderer content={session.externalResearch.markdown} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {session.coding && (
          <Card>
            <CardHeader>
              <CardTitle>Coding workspace</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                Language: {session.coding.language || "Unspecified"}
              </p>
              {session.coding.companyUrl ? (
                <div className="bg-card/40 rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs tracking-wide uppercase">
                    Company URL
                  </div>
                  <div className="font-semibold break-words">{session.coding.companyUrl}</div>
                </div>
              ) : null}
              {session.coding.interviewQuestion ? (
                <div className="bg-card/40 rounded-lg border p-3">
                  <div className="text-sm font-semibold">Interview question</div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    <strong>
                      {session.coding.interviewQuestion.title || "Curated coding question"}
                    </strong>
                  </p>
                  <MarkdownRenderer
                    content={
                      session.coding.interviewQuestion.markdown ||
                      "No grounded problem brief was saved."
                    }
                  />
                </div>
              ) : null}
              <div className="bg-card/40 rounded-lg border p-3">
                <div className="text-sm font-semibold">Final code</div>
                <pre className="bg-card mt-2 overflow-x-auto rounded-lg border p-3 text-xs">
                  {session.coding.finalCode || "// No code was saved."}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Evaluation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {evaluation.status === "processing" && (
              <>
                <div className="flex items-center gap-3">
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                  <p className="text-muted-foreground text-sm">Analysing your session…</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-12 w-32" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
                <p className="text-muted-foreground text-xs">
                  The evaluation pipeline is scoring your transcript. It will update automatically —
                  no refresh needed.
                </p>
              </>
            )}

            {evaluation.status === "failed" && (
              <Alert variant="destructive">
                <AlertTitle>Evaluation failed</AlertTitle>
                <AlertDescription>
                  <p>{evaluation.error || "The evaluation could not be completed."}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => actions.retryEvaluation(session.agentSlug, session.id)}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {evaluation.status === "idle" && (
              <p className="bg-card/40 text-muted-foreground rounded-lg border p-4 text-sm">
                Evaluation will run automatically after the session ends. Check back shortly.
              </p>
            )}

            {evaluation.status === "completed" && !evaluation.result && (
              <p className="bg-card/40 text-muted-foreground rounded-lg border p-4 text-sm">
                Evaluation completed but no result was returned. Try running it again from the
                thread view.
              </p>
            )}

            {evaluation.status === "completed" && evaluation.result && (
              <>
                <div className="flex flex-wrap items-center gap-5">
                  <div className="relative shrink-0">
                    <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="var(--muted)"
                        strokeWidth="10"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke={
                          evaluation.result.score >= 80
                            ? "var(--success)"
                            : evaluation.result.score >= 60
                              ? "var(--warning)"
                              : "var(--destructive)"
                        }
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        strokeDashoffset={`${2 * Math.PI * 42 * (1 - evaluation.result.score / 100)}`}
                        transform="rotate(-90 50 50)"
                        style={{ transition: "stroke-dashoffset 0.6s ease" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl leading-none font-semibold">
                        {evaluation.result.score}
                      </span>
                      <span className="text-muted-foreground text-[0.65rem] tracking-wider uppercase">
                        / 100
                      </span>
                    </div>
                  </div>
                  <p className="text-muted-foreground min-w-[160px] flex-1 text-sm">
                    {evaluation.result.summary}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {evaluation.result.metrics.map((metric) => (
                    <MetricCard key={metric.label} metric={metric} />
                  ))}
                </div>

                <CollapsibleList
                  items={evaluation.result.strengths}
                  label="Strengths"
                  variant="strength"
                />
                <CollapsibleList
                  items={evaluation.result.improvements}
                  label="Areas to improve"
                  variant="improvement"
                />
                {evaluation.result.recommendations?.length > 0 && (
                  <CollapsibleList
                    items={evaluation.result.recommendations}
                    label="Recommended next steps"
                    variant="improvement"
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Improvement Resources</CardTitle>
          </CardHeader>
          <CardContent>
            {resources.status === "idle" && (
              <div className="bg-card/40 flex flex-col gap-3 rounded-lg border p-4">
                <p className="text-muted-foreground text-sm">
                  Fetch targeted videos, articles, and practice links based on your evaluation
                  themes.
                </p>
                {resources.briefs?.length ? (
                  <Button
                    variant="outline"
                    className="self-start"
                    onClick={() => requestResourceFetch(slug, sessionId)}
                  >
                    Fetch resources
                  </Button>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Complete the evaluation first to unlock resources.
                  </p>
                )}
              </div>
            )}

            {resources.status === "processing" && (
              <div className="bg-card/40 flex flex-col items-center gap-2 rounded-lg border p-6 text-center">
                <Loader2 className="text-muted-foreground size-5 animate-spin" />
                <p className="text-muted-foreground text-sm">Finding resources…</p>
                <p className="text-muted-foreground text-xs">
                  Gathering articles, videos, and practice links.
                </p>
              </div>
            )}

            {resources.status === "failed" && (
              <Alert variant="destructive">
                <AlertTitle>Resource search failed</AlertTitle>
                <AlertDescription>
                  <p>{resources.error || "The resource search did not complete."}</p>
                  {resources.briefs?.length ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => requestResourceFetch(slug, sessionId)}
                    >
                      Try again
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            )}

            {resources.status === "completed" && resources.topics?.length > 0 && (
              <div className="flex flex-col gap-3">
                {resources.topics.map((topic, index) => (
                  <details
                    className="bg-card/40 rounded-lg border p-3 [&_summary::-webkit-details-marker]:hidden"
                    key={topic.id || topic.topic}
                    open={index === 0}
                  >
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{topic.topic}</div>
                        <p className="text-muted-foreground mt-1 text-xs">{topic.whyThisMatters}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {topic.items?.length || 0}{" "}
                        {topic.items?.length === 1 ? "resource" : "resources"}
                        <ChevronDown className="size-3" />
                      </Badge>
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(topic.items || []).map((item) => {
                        const isYT = isYouTubeUrl(item.url);
                        return (
                          <a
                            key={`${topic.id}-${item.url}`}
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-background hover:border-primary/40 hover:bg-accent/30 flex flex-col gap-2 rounded-lg border p-3 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {isYT ? (
                                  <YouTubeIcon />
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">
                                    {item.type || "resource"}
                                  </Badge>
                                )}
                              </div>
                              <span className="text-muted-foreground text-xs">
                                {item.source || domainLabel(item.url)}
                              </span>
                            </div>
                            <div className="text-sm font-semibold">{item.title}</div>
                            <p className="text-muted-foreground text-xs">{item.reason}</p>
                            <span className="text-primary inline-flex items-center gap-1 text-xs">
                              <ExternalLink className="size-3" /> Open
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            )}

            {resources.status === "completed" && !resources.topics?.length && (
              <p className="bg-card/40 text-muted-foreground rounded-lg border p-4 text-sm">
                No targeted resources were found for this session.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session Comparison</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {evaluation.status !== "completed" ? (
              <p className="bg-card/40 text-muted-foreground rounded-lg border p-4 text-sm">
                Complete the evaluation first, then compare with another session.
              </p>
            ) : !comparisonOptions.length ? (
              <p className="bg-card/40 text-muted-foreground rounded-lg border p-4 text-sm">
                Save at least one more completed session to compare progress.
              </p>
            ) : (
              <>
                <div className="bg-card/40 flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <Label htmlFor="compare-select" className="shrink-0">
                    Compare against
                  </Label>
                  <Select value={selectedComparisonId} onValueChange={setSelectedComparisonId}>
                    <SelectTrigger id="compare-select" className="min-w-[200px] flex-1">
                      <SelectValue placeholder="Select a session" />
                    </SelectTrigger>
                    <SelectContent>
                      {comparisonOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.sessionName || "Untitled"} ·{" "}
                          {new Date(option.endedAt).toLocaleDateString()} · {option.durationLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!selectedComparisonId || comparison.status === "processing"}
                    onClick={() => requestSessionComparison(slug, sessionId, selectedComparisonId)}
                  >
                    {comparison.status === "processing" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Comparing…
                      </>
                    ) : (
                      "Compare"
                    )}
                  </Button>
                </div>

                {comparison.status === "processing" && (
                  <div className="bg-card/40 flex items-center gap-3 rounded-lg border p-4">
                    <Loader2 className="text-muted-foreground size-4 animate-spin" />
                    <p className="text-muted-foreground text-sm">Comparing sessions…</p>
                  </div>
                )}

                {comparison.status === "failed" && (
                  <Alert variant="destructive">
                    <AlertTitle>Comparison failed</AlertTitle>
                    <AlertDescription>
                      {comparison.error || "The comparison could not be completed."}
                    </AlertDescription>
                  </Alert>
                )}

                {comparison.status === "completed" && comparison.result && (
                  <div className="flex flex-col gap-3">
                    <div className="bg-card/40 rounded-lg border p-3">
                      <Badge
                        variant={
                          comparison.result.trend === "improved"
                            ? "success"
                            : comparison.result.trend === "declined"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {comparison.result.trend}
                      </Badge>
                      <p className="text-muted-foreground mt-2 text-sm">
                        {comparison.result.summary}
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {comparison.result.metrics.map((metric) => {
                        const deltaPrefix = metric.delta > 0 ? "+" : "";
                        const trendColor =
                          metric.trend === "improved"
                            ? "text-[color:var(--success)]"
                            : metric.trend === "declined"
                              ? "text-destructive"
                              : "text-muted-foreground";
                        return (
                          <div className="bg-card/40 rounded-lg border p-3" key={metric.label}>
                            <div className="flex items-start justify-between">
                              <span className="text-muted-foreground text-xs tracking-wide uppercase">
                                {metric.label}
                              </span>
                              <span className={cn("text-sm font-semibold", trendColor)}>
                                {deltaPrefix}
                                {metric.delta}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-xs">
                              <span>Now {metric.currentValue}</span>
                              <span className="text-muted-foreground">
                                Earlier {metric.baselineValue}
                              </span>
                            </div>
                            <p className="text-muted-foreground mt-2 text-xs">{metric.insight}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Transcript</CardTitle>
              {(session.transcript?.length ?? 0) > 6 && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={transcriptExpanded}
                  onClick={() => setTranscriptExpanded((e) => !e)}
                >
                  {transcriptExpanded ? (
                    <>
                      <ChevronUp className="size-4" /> Collapse
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-4" /> Expand all
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!session.transcript?.length ? (
              <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                No transcript was saved for this session.
              </p>
            ) : (
              <div
                className={cn(
                  "flex flex-col gap-3 overflow-y-auto pr-1",
                  transcriptExpanded ? "max-h-none" : "max-h-[420px]",
                )}
              >
                {session.transcript.map((entry) => (
                  <div key={entry.id} className="bg-card/40 rounded-lg border p-3">
                    <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      {entry.role}
                    </div>
                    <p className="mt-1 text-sm">{entry.text}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
