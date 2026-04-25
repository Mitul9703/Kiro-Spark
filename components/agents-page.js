"use client";

import Link from "next/link";
import { AGENTS } from "../lib/agents";
import { AppShell } from "./shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AgentsPage() {
  return (
    <AppShell>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Choose your agent</h1>
        <p className="text-muted-foreground">Select the rehearsal room that fits your session.</p>
      </header>

      <div className="grid auto-rows-fr gap-4 md:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent) => {
          const isCoding = agent.slug === "coding";

          return (
            <Link
              href={`/agents/${agent.slug}`}
              key={agent.slug}
              className="group block"
            >
              <Card className="group-hover:border-primary/40 h-full transition-shadow group-hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="secondary" className="tracking-wide uppercase">
                      {agent.role}
                    </Badge>
                    <Badge variant="outline">{agent.duration}</Badge>
                  </div>

                  <div className="bg-primary/10 text-primary grid size-12 place-items-center rounded-xl text-lg font-semibold">
                    {agent.role[0]}
                  </div>

                  <div className="flex flex-col gap-1">
                    <h2 className="text-lg leading-tight font-semibold">{agent.name}</h2>
                    <p className="text-muted-foreground text-sm">{agent.description}</p>
                  </div>

                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                    {agent.focus.map((item) => (
                      <Badge key={item} variant="outline" className="font-normal">
                        {item}
                      </Badge>
                    ))}
                    {isCoding && (
                      <Badge variant="outline" className="font-normal">
                        Code editor plugin
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
