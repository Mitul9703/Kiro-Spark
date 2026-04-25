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
        <svg
          aria-hidden="true"
          focusable="false"
          width="56"
          height="56"
          viewBox="0 0 56 56"
          style={{ marginBottom: "1rem", overflow: "visible" }}
        >
          <defs>
            <radialGradient id="heroSparkGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.95)" />
              <stop offset="45%" stopColor="rgba(125, 211, 252, 0.55)" />
              <stop offset="100%" stopColor="rgba(168, 85, 247, 0)" />
            </radialGradient>
          </defs>
          <circle cx="28" cy="28" r="21" fill="url(#heroSparkGlow)">
            <animate attributeName="r" values="19;23;19" dur="4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.58;0.82;0.58" dur="4s" repeatCount="indefinite" />
          </circle>
          <g stroke="currentColor" strokeLinecap="round" style={{ color: "rgba(255, 255, 255, 0.82)" }}>
            <path d="M28 13v8" />
            <path d="M28 35v8" />
            <path d="M13 28h8" />
            <path d="M35 28h8" />
            <path d="M18.5 18.5l5.5 5.5" />
            <path d="M32 32l5.5 5.5" />
            <path d="M37.5 18.5 32 24" />
            <path d="M24 32l-5.5 5.5" />
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 28 28"
              to="360 28 28"
              dur="14s"
              repeatCount="indefinite"
            />
          </g>
          <circle cx="28" cy="28" r="3.4" fill="rgba(255, 255, 255, 0.88)" />
        </svg>
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

      <div className="features-strip">
        <div className="feature-item">
          <span aria-hidden="true">🎙️</span>
          <p>
            <strong>Voice-first</strong> Practice speaking out loud, not typing.
          </p>
        </div>
        <div className="feature-item">
          <span aria-hidden="true">🎯</span>
          <p>
            <strong>Role-specific</strong> Agents tuned for interviews, pitches, and lectures.
          </p>
        </div>
        <div className="feature-item">
          <span aria-hidden="true">⚡</span>
          <p>
            <strong>Instant feedback</strong> Scores and improvement notes right after each session.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
