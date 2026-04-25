"use client";

import Link from "next/link";
import { Sparkles, Mic, Target, Zap } from "lucide-react";
import { AppShell } from "./shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STEPS = [
  {
    number: "01",
    title: "Prep",
    desc: "Upload a supporting PDF if you want grounded questions.",
  },
  {
    number: "02",
    title: "Rehearse",
    desc: "Enter a Meet-style rehearsal room, grant mic access once, and let the avatar begin the conversation.",
  },
  {
    number: "03",
    title: "Review",
    desc: "End the session and return to evaluation cards with scores, improvement resources, and session comparisons.",
  },
];

const FEATURES = [
  {
    Icon: Mic,
    title: "Voice-first",
    desc: "Practice speaking out loud, not typing.",
  },
  {
    Icon: Target,
    title: "Role-specific",
    desc: "Agents tuned for interviews, pitches, and lectures.",
  },
  {
    Icon: Zap,
    title: "Instant feedback",
    desc: "Scores and improvement notes right after each session.",
  },
];

export function LandingPage() {
  return (
    <AppShell>
      <section className="flex flex-col items-center gap-6 pt-10 text-center">
        <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
          <Sparkles className="size-7" />
        </div>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          Rehearse the room before you ever walk into it.
        </h1>
        <p className="text-muted-foreground max-w-2xl text-base text-balance sm:text-lg">
          SimCoach pairs with role-specific coaching surfaces so you can practice interviews,
          lectures, startup pitches, and high-pressure Q&amp;A in one calm workspace.
        </p>
        <Button asChild size="xl">
          <Link href="/agents">View Agents</Link>
        </Button>
      </section>

      <section className="flex flex-col gap-6">
        <div className="text-muted-foreground text-center text-xs font-medium tracking-[0.2em] uppercase">
          How a session feels
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <Card key={step.number}>
              <CardContent className="flex flex-col gap-2">
                <div className="text-primary text-xs font-semibold tracking-widest">
                  {step.number}
                </div>
                <div className="text-lg font-semibold">{step.title}</div>
                <p className="text-muted-foreground text-sm">{step.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {FEATURES.map(({ Icon, title, desc }) => (
          <Card key={title}>
            <CardContent className="flex items-start gap-3">
              <div className="bg-accent text-accent-foreground grid size-9 shrink-0 place-items-center rounded-lg">
                <Icon className="size-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{title}</div>
                <p className="text-muted-foreground text-sm">{desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </AppShell>
  );
}
