"use client";

import Link from "next/link";
import { useAppState } from "./app-provider";

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function AppShell({ children, compact = false }) {
  const { state, setTheme, toasts, dismissToast } = useAppState();
  const isLight = state.theme === "light";

  return (
    <div className="app-shell">
      <div className="page-frame">
        <header className="topbar">
          <Link href="/" className="brand">
            <div className="brand-mark" aria-hidden="true">SC</div>
            <div>
              <div className="brand-title">SimCoach</div>
              <div className="brand-subtitle">
                {compact
                  ? "Live rehearsal room"
                  : "Scenario-specific rehearsal rooms with live avatar feedback"}
              </div>
            </div>
          </Link>
          <button
            type="button"
            className={`theme-toggle-icon ${isLight ? "theme-is-light" : "theme-is-dark"}`}
            onClick={() => setTheme(isLight ? "dark" : "light")}
            aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
            aria-pressed={isLight}
            title={isLight ? "Switch to dark mode" : "Switch to light mode"}
          >
            <span className="theme-icon-inner">
              {isLight ? <MoonIcon /> : <SunIcon />}
            </span>
          </button>
        </header>
        {children}
        {toasts.length ? (
          <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
            {toasts.map((toast) => (
              <button
                type="button"
                key={toast.id}
                className="toast"
                onClick={() => dismissToast(toast.id)}
              >
                {toast.message}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
