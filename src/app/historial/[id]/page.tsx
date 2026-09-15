"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  deleteSession,
  getWorkoutSessionFull,
  updateWorkoutSessionNote,
} from "@/lib/repo";
import { WorkoutSessionFull } from "@/lib/types";
import { formatDateShort, formatDuration } from "@/lib/dates";
import { sumVolume } from "@/lib/calculations";
import SetRow from "@/components/SetRow";
import { ChevronLeft, Trash2 } from "lucide-react";

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const completed = searchParams.get("completed") === "1";

  const [session, setSession] = useState<WorkoutSessionFull | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    const s = await getWorkoutSessionFull(id);
    setSession(s ?? null);
    setNoteDraft(s?.note ?? "");
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos async estándar
    load();
  }, [load]);

  async function handleDelete() {
    await deleteSession(id);
    router.push("/historial");
  }

  async function saveNote() {
    await updateWorkoutSessionNote(id, noteDraft.trim() || null);
  }

  if (session === undefined) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-surface-3 border-t-accent animate-spin" />
      </div>
    );
  }
  if (session === null) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-text-secondary text-sm">
        Sesión no encontrada.
      </div>
    );
  }

  const totalVolume = session.exerciseSessions.reduce(
    (acc, es) => acc + sumVolume(es.sets),
    0
  );
  const totalSets = session.exerciseSessions.reduce(
    (acc, es) => acc + es.sets.filter((s) => s.weight != null && s.reps != null).length,
    0
  );

  return (
    <div className="min-h-dvh pb-10">
      <header className="safe-top sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border-soft px-4 py-3 flex items-center gap-3">
        <Link href={completed ? "/" : "/historial"} className="text-text-secondary active:text-text">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-base font-semibold">
          Día {session.routineDay} · {formatDateShort(session.date)}
        </h1>
      </header>

      {completed && (
        <div className="mx-4 mt-4 rounded-2xl border border-accent/40 bg-accent-soft px-4 py-4 text-center">
          <p className="text-accent-strong text-sm font-semibold tracking-wide mb-2">
            DÍA {session.routineDay} COMPLETADO
          </p>
          <div className="flex justify-center gap-4 text-text text-sm tabular">
            <span>{searchParams.get("exercises")} ejercicios</span>
            <span>{searchParams.get("sets")} series</span>
          </div>
          <p className="text-xs text-text-secondary mt-1 tabular">
            {Number(searchParams.get("volume") ?? 0).toLocaleString("es-UY")} kg de volumen ·
            Duración {formatDuration(Number(searchParams.get("duration") ?? 0))}
            {Number(searchParams.get("prs") ?? 0) > 0
              ? ` · PRs: ${searchParams.get("prs")}`
              : ""}
          </p>
        </div>
      )}

      <div className="px-4 pt-4 flex gap-4 text-xs text-text-secondary mb-2">
        <span className="tabular">{totalSets} series</span>
        <span className="tabular">{Math.round(totalVolume).toLocaleString("es-UY")} kg volumen</span>
        {session.duration != null && <span>{formatDuration(session.duration)}</span>}
      </div>

      <div className="px-4 flex flex-col gap-3 mt-2">
        {session.exerciseSessions.map((es) => (
          <div key={es.id} className="rounded-2xl bg-surface border border-border-soft px-4 py-3">
            <h3 className="text-[15px] font-semibold text-text mb-2">{es.exercise.name}</h3>
            <div className="grid grid-cols-[28px_1fr_1fr_1fr_28px] gap-2 text-[10px] uppercase tracking-wide text-text-tertiary mb-1 px-0.5">
              <div className="text-center">#</div>
              <div className="text-center">Peso</div>
              <div className="text-center">Reps</div>
              <div className="text-center">RIR</div>
              <div />
            </div>
            <div className="divide-y divide-border-soft/60">
              {es.sets.map((s) => (
                <SetRow
                  key={s.id}
                  set={s}
                  placeholderWeight={null}
                  canDelete={es.sets.length > 1}
                  onChanged={load}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 mt-4">
        <label className="text-xs text-text-secondary mb-1 block">Nota de la sesión</label>
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={saveNote}
          placeholder="Opcional"
          rows={2}
          className="w-full rounded-lg bg-surface-2 border border-border-soft px-3 py-2 text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
        />
      </div>

      <div className="px-4 mt-6">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-danger/30 text-danger text-sm active:bg-danger-soft"
          >
            <Trash2 size={15} /> Eliminar sesión
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 py-3 rounded-xl bg-surface-2 text-text-secondary text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 py-3 rounded-xl bg-danger text-bg font-medium text-sm"
            >
              Sí, eliminar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
