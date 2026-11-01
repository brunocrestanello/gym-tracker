"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { exercisesForDay } from "@/data/routine";
import { waitForWrites } from "@/lib/persistence";
import { db } from "@/lib/db";
import {
  discardSession,
  finishSession,
  getActiveSession,
  startOrResumeSession,
} from "@/lib/repo";
import { ExerciseSession, RoutineDay, WorkoutSession } from "@/lib/types";
import ExerciseBlock from "@/components/ExerciseBlock";
import { ChevronLeft } from "lucide-react";

export default function DayPage({ params }: { params: Promise<{ day: string }> }) {
  const { day: dayParam } = use(params);
  const day = Number(dayParam) as RoutineDay;
  const router = useRouter();

  const [session, setSession] = useState<WorkoutSession | null | undefined>(undefined);
  const [conflict, setConflict] = useState<WorkoutSession | null>(null);
  const [exSessions, setExSessions] = useState<ExerciseSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const active = await getActiveSession();
      if (active && active.routineDay !== day) {
        if (mounted) {
          setConflict(active);
          setSession(null);
        }
        return;
      }
      const s = await startOrResumeSession(day);
      if (s.routineDay !== day) { if (mounted) { setConflict(s); setSession(null); } return; }
      const es = await db.exerciseSessions.where("workoutSessionId").equals(s.id).sortBy("order");
      if (mounted) {
        setSession(s);
        setExSessions(es);
      }
    })().catch(() => { if (mounted) setError("No se pudo abrir el entrenamiento. Reintentá recargando la página."); });
    return () => {
      mounted = false;
    };
  }, [day]);

  async function handleDiscardAndStart() {
    if (!conflict) return;
    try {
      await waitForWrites();
      const { s, es } = await db.transaction("rw", db.exercises, db.workoutSessions, db.exerciseSessions, db.sets, async () => {
        await discardSession(conflict.id);
        const s = await startOrResumeSession(day);
        const es = await db.exerciseSessions.where("workoutSessionId").equals(s.id).sortBy("order");
        return { s, es };
      });
      if (s.routineDay !== day) { setConflict(s); return; }
      setConflict(null);
      setSession(s);
      setExSessions(es);
      setError(null);
    } catch { setError("No se pudo cambiar de entrenamiento. Los cambios no se completaron."); }
  }

  async function handleFinish() {
    if (!session) return;
    setFinishing(true);
    try {
      await waitForWrites();
      const summary = await finishSession(session.id);
      const q = new URLSearchParams({
        completed: "1",
        exercises: String(summary.exerciseCount),
        sets: String(summary.setCount),
        volume: String(Math.round(summary.totalVolume)),
        duration: String(summary.durationSeconds),
        prs: String(summary.prCount),
      });
      router.push(`/historial/${session.id}?${q.toString()}`);
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar el entrenamiento"); }
    finally { setFinishing(false); }
  }

  const exercises = exercisesForDay(day);

  if (error && !session && !conflict) return <p role="alert" className="p-6">{error} <button onClick={() => location.reload()}>Reintentar</button></p>;

  if (conflict) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6 text-center gap-4">
        <p className="text-text">
          Tenés un entrenamiento en curso: <span className="text-accent">Día {conflict.routineDay}</span>
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <Link
            href={`/dia/${conflict.routineDay}`}
            className="w-full py-3 rounded-xl bg-accent text-bg font-medium text-center"
          >
            Continuar ese entrenamiento
          </Link>
          <button
            onClick={handleDiscardAndStart}
            className="w-full py-3 rounded-xl bg-surface-2 text-text-secondary"
          >
            Descartar y empezar Día {day}
          </button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-surface-3 border-t-accent animate-spin" />
      </div>
    );
  }

  // Agrupar ejercicios consecutivos con el mismo supersetGroup
  type Row = { exercise: (typeof exercises)[number]; es: ExerciseSession };
  const rows: Row[] = exSessions
    .map((es) => ({ es, exercise: exercises.find((e) => e.id === es.exerciseId)! }))
    .filter((r) => r.exercise);

  return (
    <div className="min-h-dvh pb-32">
      <header className="safe-top sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border-soft px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-text-secondary active:text-text">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-base font-semibold">Día {day}</h1>
      </header>

      <fieldset disabled={finishing} className="px-4 pt-4 flex flex-col gap-3">
        {rows.map((r, idx) => {
          const group = r.exercise.supersetGroup;
          const prev = rows[idx - 1];
          const next = rows[idx + 1];
          const isFirstOfGroup = group && prev?.exercise.supersetGroup !== group;
          const isLastOfGroup = group && next?.exercise.supersetGroup !== group;
          const position: "single" | "first" | "last" = !group
            ? "single"
            : isFirstOfGroup
            ? "first"
            : isLastOfGroup
            ? "last"
            : "first";
          return (
            <ExerciseBlock
              key={r.es.id}
              exerciseSessionId={r.es.id}
              exercise={r.exercise}
              workoutSessionId={session.id}
              supersetPosition={position}
            />
          );
        })}
      </fieldset>

      {error && <p role="alert" className="px-4">{error}</p>}
      <div className="fixed bottom-0 left-0 right-0 safe-bottom px-4 pb-4 pt-6 bg-gradient-to-t from-bg via-bg/95 to-transparent">
        <button
          onClick={handleFinish}
          disabled={finishing}
          className="w-full py-3.5 rounded-xl bg-accent text-bg font-semibold text-[15px] active:opacity-90 disabled:opacity-60"
        >
          {finishing ? "Guardando\u2026" : "FINALIZAR ENTRENAMIENTO"}
        </button>
      </div>
    </div>
  );
}
