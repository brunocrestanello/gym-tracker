"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { getExerciseCatalog } from "@/lib/workouts";
import { formatDateShort } from "@/lib/dates";
import { ChevronLeft } from "lucide-react";

export default function HistorialPage() {
  const catalog = useLiveQuery(getExerciseCatalog, []);
  const [dayFilter, setDayFilter] = useState<string>("todos");
  const [exerciseFilter, setExerciseFilter] = useState<string>("todos");
  const [weekFilter, setWeekFilter] = useState<string>("todas");

  const sessions = useLiveQuery(async () => {
    const all = await db.workoutSessions
      .filter((s) => s.finishedAt !== null)
      .toArray();
    return all.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, []);

  const exSessionsByWorkout = useLiveQuery(async () => {
    const all = await db.exerciseSessions.toArray();
    const map = new Map<string, string[]>();
    for (const es of all) {
      const arr = map.get(es.workoutSessionId) ?? [];
      arr.push(es.exerciseId);
      map.set(es.workoutSessionId, arr);
    }
    return map;
  }, []);

  const weeks = useMemo(() => {
    if (!sessions) return [];
    const set = new Set<string>();
    sessions.forEach((s) =>
      set.add(`${s.isoYear}-W${String(s.isoWeek).padStart(2, "0")}`),
    );
    return Array.from(set).sort().reverse();
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    return sessions.filter((s) => {
      if (dayFilter !== "todos" && String(s.routineDay) !== dayFilter)
        return false;
      if (
        weekFilter !== "todas" &&
        `${s.isoYear}-W${String(s.isoWeek).padStart(2, "0")}` !== weekFilter
      )
        return false;
      if (exerciseFilter !== "todos") {
        const ids = exSessionsByWorkout?.get(s.id) ?? [];
        if (!ids.includes(exerciseFilter)) return false;
      }
      return true;
    });
  }, [sessions, dayFilter, weekFilter, exerciseFilter, exSessionsByWorkout]);

  return (
    <div className="min-h-dvh pb-10">
      <header className="safe-top sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border-soft px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-text-secondary active:text-text">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="page-title">Historial</h1>
      </header>

      <p className="px-4 pt-4 text-sm text-text-secondary">
        Cada entrenamiento conserva su día original.
      </p>
      <div className="px-4 pt-4 grid grid-cols-2 gap-2 pb-1">
        <select
          aria-label="Filtrar por día original"
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="shrink-0 bg-surface-2 border border-border-soft rounded-lg px-2.5 py-1.5 text-xs text-text"
        >
          <option value="todos">Todos los días</option>
          {[1, 2, 3, 4].map((d) => (
            <option key={d} value={d}>
              Día {d}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por ejercicio"
          value={exerciseFilter}
          onChange={(e) => setExerciseFilter(e.target.value)}
          className="shrink-0 bg-surface-2 border border-border-soft rounded-lg px-2.5 py-1.5 text-xs text-text w-full"
        >
          <option value="todos">Todos los ejercicios</option>
          {(catalog ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por semana"
          value={weekFilter}
          onChange={(e) => setWeekFilter(e.target.value)}
          className="shrink-0 bg-surface-2 border border-border-soft rounded-lg px-2.5 py-1.5 text-xs text-text"
        >
          <option value="todas">Todas las semanas</option>
          {weeks.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 pt-3 flex flex-col gap-2">
        {filtered.length === 0 && (
          <p className="text-sm text-text-tertiary text-center py-10">
            No hay entrenamientos para este filtro.
          </p>
        )}
        {filtered.map((s) => (
          <Link
            key={s.id}
            href={`/historial/${s.id}`}
            className="panel flex items-center justify-between gap-3 active:bg-surface-2"
          >
            <span className="text-sm text-text">{formatDateShort(s.date)}</span>
            <span className="day-pill">Día {s.routineDay}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
