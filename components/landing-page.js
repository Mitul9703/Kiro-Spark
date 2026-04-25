"use client";

import Link from "next/link";
import { AppShell } from "./shell";

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

export function LandingPage() {
  return (
    <AppShell>
      {/* Hero — centered */}
      <div className="hero-centered">
        <h1 className="hero-title">
          Rehearse the room before you ever walk into it.
        </h1>
        <p className="hero-copy">
          SimCoach pairs with role-specific coaching
          surfaces so you can practice interviews, lectures, startup pitches,
          and high-pressure Q&amp;A in one calm workspace.
        </p>
        <div className="hero-cta-centered">
          <Link href="/agents" className="btn btn-primary" style={{ minWidth: 180, fontSize: "1.05rem" }}>
            View Agents
          </Link>
        </div>
      </div>

      {/* How a session feels — horizontal 3-step card */}
      <div className="steps-panel">
        <div className="steps-panel-label">How a session feels</div>
        <div className="steps-row">
          {STEPS.map((step) => (
            <div className="step-card" key={step.number}>
              <span className="step-number">{step.number}</span>
              <p className="step-title">{step.title}</p>
              <p className="step-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
