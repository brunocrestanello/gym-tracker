"use client";

import { useEffect, useState } from "react";
import { ensureSeeded } from "@/lib/db";
import { RestTimerProvider } from "@/components/RestTimer";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureSeeded().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-bg">
        <div className="h-6 w-6 rounded-full border-2 border-surface-3 border-t-accent animate-spin" />
      </div>
    );
  }

  return <RestTimerProvider>{children}</RestTimerProvider>;
}
