"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatDateShort } from "@/lib/dates";
import { History, LineChart, Settings } from "lucide-react";

const DAY_FOCUS: Record<number, string> = {
  1: "Pecho · Hombro · Brazo",
  2: "Pierna post. · Pecho · Espalda",
  3: "Pierna · Pecho · Espalda",
  4: "Pierna post. · Espalda · Brazo",
};

export default function Home() {
  const lastSession = useLiveQuery(async () => {
    const all = await db.workoutSessions.filter((s) => s.finishedAt !== null).toArray();
    return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  }, []);

  const activeSession = useLiveQuery(async () => {
    const all = await db.workoutSessions.filter((s) => s.finishedAt === null).toArray();
    return all[0];
  }, []);

  return (
    <div className="min-h-dvh safe-top px-5 pt-8 pb-10 flex flex-col">
      <div className="mb-7">
        <p className="text-xs text-text-tertiary tracking-wide mb-1">RUTINA</p>
        <h1 className="text-2xl font-semibold text-text">Bruno</h1>
      </div>

      {activeSession && (
        <Link
          href={`/dia/${activeSession.routineDay}`}
          className="mb-4 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 flex items-center justify-between"
        >
          <span className="text-sm text-accent-strong">
            Entrenamiento en curso · Día {activeSession.routineDay}
          </span>
          <span className="text-xs text-accent-strong">Continuar →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6">
        {[1, 2, 3, 4].map((day) => (
          <Link
            key={day}
            href={`/dia/${day}`}
            className="rounded-2xl bg-surface border border-border-soft px-4 py-6 flex flex-col items-center justify-center gap-1 active:bg-surface-2 transition-colors"
          >
            <span className="text-3xl font-semibold text-text tabular">{day}</span>
            <span className="text-[11px] text-text-tertiary text-center leading-tight">
              {DAY_FOCUS[day]}
            </span>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 mb-6">
        <Link
          href="/historial"
          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface border border-border-soft active:bg-surface-2"
        >
          <History size={17} className="text-text-secondary" />
          <span className="text-sm text-text">Historial</span>
        </Link>
        <Link
          href="/progreso"
          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface border border-border-soft active:bg-surface-2"
        >
          <LineChart size={17} className="text-text-secondary" />
          <span className="text-sm text-text">Progreso / Estadísticas</span>
        </Link>
        <Link
          href="/ajustes"
          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface border border-border-soft active:bg-surface-2"
        >
          <Settings size={17} className="text-text-secondary" />
          <span className="text-sm text-text">Ajustes y backup</span>
        </Link>
      </div>

      <div className="mt-auto">
        {lastSession && (
          <p className="text-xs text-text-tertiary text-center">
            Último entrenamiento
            <br />
            <span className="text-text-secondary">
              Día {lastSession.routineDay} · {formatDateShort(lastSession.date)}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
