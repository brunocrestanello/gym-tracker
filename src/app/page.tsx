"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { completedDaysThisWeek } from "@/lib/completion";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatDateShort, todayDateString } from "@/lib/dates";
import { History, LineChart, Settings } from "lucide-react";

const DAY_FOCUS: Record<number, string> = {
  1: "Femoral · Pecho · Hombro · Brazo",
  2: "Sentadilla · Pecho · Espalda · Brazo",
  3: "Pierna · Pecho · Espalda",
  4: "Pierna post. · Espalda · Brazo",
};

export default function Home() {
  const [today, setToday] = useState(todayDateString);
  useEffect(() => {
    const refresh = () => setToday(todayDateString());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const completedDays = useLiveQuery(
    async () =>
      completedDaysThisWeek(await db.workoutSessions.toArray(), today),
    [today],
  );

  const lastSession = useLiveQuery(async () => {
    const all = await db.workoutSessions
      .filter((s) => s.finishedAt !== null)
      .toArray();
    return all.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    )[0];
  }, []);

  const activeSession = useLiveQuery(async () => {
    const all = await db.workoutSessions
      .filter((s) => s.finishedAt === null)
      .toArray();
    return all[0];
  }, []);

  return (
    <div className="px-5 pt-7 pb-10 flex flex-col">
      <div className="mb-7">
        <p className="eyebrow mb-2">Tu espacio de entrenamiento</p>
        <h1 className="page-title">Hoy, un poco más fuerte.</h1>
        <p className="text-sm text-text-secondary mt-3">
          Elegí tu día. Registrá cada avance.
        </p>
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
        {([1, 2, 3, 4] as const).map((day) => (
          <Link
            key={day}
            href={`/dia/${day}`}
            aria-label={`Día ${day}${completedDays?.has(day) ? ", completado esta semana" : ""}`}
            className={`day-card ${completedDays?.has(day) ? "day-card-completed" : ""}`}
          >
            <span className="eyebrow">
              Día de rutina <span aria-hidden="true">↗</span>
            </span>
            <span className="day-number tabular">0{day}</span>
            {completedDays?.has(day) && (
              <span className="text-xs font-semibold text-accent-strong">
                ✓ Completado esta semana
              </span>
            )}
            <span className="text-xs text-text-secondary leading-relaxed">
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
          <span className="text-sm text-text">Evolución y récords</span>
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
