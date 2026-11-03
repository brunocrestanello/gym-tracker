"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import { useEffect, useState } from "react";
import { ensureSeeded } from "@/lib/db";
import UnsavedChangesGuard from "@/components/UnsavedChangesGuard";
import { RestTimerProvider } from "@/components/RestTimer";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureSeeded()
      .then(() => setReady(true))
      .catch(() => setError(true));
  }, []);

  if (error)
    return (
      <p role="alert" className="p-6">
        No se pudo abrir el almacenamiento. Tus datos no fueron reinicializados.{" "}
        <button onClick={() => location.reload()}>Reintentar</button>
      </p>
    );

  if (!ready) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-bg">
        <div className="h-6 w-6 rounded-full border-2 border-surface-3 border-t-accent animate-spin" />
      </div>
    );
  }

  return (
    <RestTimerProvider>
      <UnsavedChangesGuard />
      <div className="app-frame">
        <div className="brand-bar safe-top">
          <Link href="/" aria-label="Inicio" className="brand">
            GYM<span>TRACKER</span>
            <small>ENTRENÁ CON INTENCIÓN</small>
          </Link>
          <ThemeToggle />
        </div>
        {children}
      </div>
    </RestTimerProvider>
  );
}
