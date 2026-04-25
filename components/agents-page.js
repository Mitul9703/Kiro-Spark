"use client";

import Link from "next/link";
import { AGENTS } from "../lib/agents";
import { AppShell } from "./shell";

// All focus chips use the accent orange palette
const PILL_COLOR = "pill-accent";

export function AgentsPage() {
  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-heading">Choose your agent</h1>
        <p className="page-subheading">
          Select the rehearsal room that fits your session.
        </p>
      </div>

      <div className="agents-grid">
        {AGENTS.map((agent) => {
          const isCustom = agent.slug === "custom";
          const isCoding = agent.slug === "coding";

          return (
            <Link
              href={`/agents/${agent.slug}`}
              className={`agent-card${isCustom ? " agent-card-custom" : ""}`}
              key={agent.slug}
            >
              {/* Header row: role badge + duration pill */}
              <div className="agent-title-row">
                <div className="agent-badge">{agent.role}</div>
                <span className="pill">{agent.duration}</span>
              </div>

              {/* Agent name */}
              <h2 className="agent-title">{agent.name}</h2>

              {/* Short description */}
              <p className="agent-blurb">{agent.description}</p>

              {/* Focus chips — colourful, consistent contrast */}
              <div className="pill-row" style={{ marginTop: "auto" }}>
                {agent.focus.map((item) => (
                  <span className={`pill ${PILL_COLOR}`} key={item}>
                    {item}
                  </span>
                ))}
                {isCoding && (
                  <span className={`pill ${PILL_COLOR}`}>Code editor plugin</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
