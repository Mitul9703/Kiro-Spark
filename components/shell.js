"use client";

import Link from "next/link";
import { Moon, Sun, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useAppState } from "./app-provider";

export function AppShell({ children, compact = false }) {
  const { state, setTheme } = useAppState();
  const isLight = state.theme === "light";

  return (
    <div className="bg-background text-foreground min-h-screen w-full">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-6 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="group flex items-center gap-3">
            <div className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-xl shadow-sm transition-transform group-hover:scale-105">
              <Sparkles className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">SimCoach</div>
              <div className="text-muted-foreground text-xs">
                {compact
                  ? "Live rehearsal room"
                  : "Scenario-specific rehearsal rooms with live avatar feedback"}
              </div>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(isLight ? "dark" : "light")}
            aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
            aria-pressed={isLight}
            title={isLight ? "Switch to dark mode" : "Switch to light mode"}
          >
            {isLight ? <Moon className="size-5" /> : <Sun className="size-5" />}
          </Button>
        </header>
        <main className="flex flex-1 flex-col gap-8">{children}</main>
      </div>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}
