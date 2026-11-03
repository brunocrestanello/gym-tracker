"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { Exercise, SetEntry } from "@/lib/types";
import { addSet } from "@/lib/repo";
import ExerciseReference from "./ExerciseReference";
import {
  ExternalLink,
  Plus,
  TrendingUp,
  Timer as TimerIcon,
} from "lucide-react";
import { useRestTimer } from "@/components/RestTimer";
import SetRow from "@/components/SetRow";

export default function ExerciseBlock({
  exerciseSessionId,
  exercise,
  workoutSessionId,
  supersetPosition,
  entries,
  onSave,
  onDelete,
  onAdd,
}: {
  exerciseSessionId: string;
  exercise: Exercise;
  workoutSessionId: string;
  supersetPosition: "single" | "first" | "middle" | "last";
  entries?: SetEntry[];
  onSave?: (
    id: string,
    patch: Partial<Pick<SetEntry, "weight" | "reps" | "rir">>,
  ) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onAdd?: () => Promise<void>;
}) {
  const storedSets = useLiveQuery(
    () =>
      entries
        ? []
        : db.sets
            .where("exerciseSessionId")
            .equals(exerciseSessionId)
            .sortBy("setNumber"),
    [exerciseSessionId, Boolean(entries)],
  );
  const sets = entries ?? storedSets;
  const [error, setError] = useState<string | null>(null);
  const [showTimer, setShowTimer] = useState(false);
  const [customSeconds, setCustomSeconds] = useState("");
  const timer = useRestTimer();

  const repRange = `${exercise.targetRepsMin}\u2013${exercise.targetRepsMax}`;
  const rirRange =
    exercise.targetRirMin === exercise.targetRirMax
      ? `RIR ${exercise.targetRirMin}`
      : `RIR ${exercise.targetRirMax}\u2013${exercise.targetRirMin}`;

  const roundedTop =
    supersetPosition === "single" || supersetPosition === "first";
  const roundedBottom =
    supersetPosition === "single" || supersetPosition === "last";

  return (
    <div
      className={[
        "bg-surface border border-border-soft px-4 py-4",
        roundedTop ? "rounded-t-2xl" : "",
        roundedBottom ? "rounded-b-2xl" : "",
        supersetPosition === "first" ? "border-b-0" : "",
        supersetPosition === "last" ? "border-t-0" : "",
      ].join(" ")}
    >
      {supersetPosition !== "single" && (
        <div className="text-[11px] text-accent mb-2 flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          Superserie {exercise.supersetLabel}
        </div>
      )}

      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="text-[15px] font-semibold text-text leading-snug">
            {exercise.name}
          </h3>
          {exercise.videoUrl && (
            <a
              href={exercise.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 min-h-11 min-w-11 flex items-center justify-center text-text-secondary active:text-accent"
              aria-label="Ver técnica"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        <Link
          href={`/ejercicio/${exercise.id}`}
          className="shrink-0 min-h-11 min-w-11 text-text-secondary active:text-accent flex items-center justify-center gap-1 text-xs"
        >
          <TrendingUp size={18} />
          <span className="sr-only">Ver evolución de {exercise.name}</span>
        </Link>
      </div>
      <div className="text-xs text-text-secondary mb-3">
        {exercise.targetSets} series · {repRange} reps · {rirRange}
      </div>

      <ExerciseReference
        exerciseId={exercise.id}
        excludeWorkoutId={workoutSessionId}
      />

      {error && (
        <p role="alert" className="text-xs">
          {error}
        </p>
      )}
      {/* Tabla de series */}
      <div className="grid grid-cols-[24px_1fr_1fr_1fr_44px] gap-2 text-[10px] uppercase tracking-wide text-text-tertiary mb-1 px-0.5">
        <div className="text-center">#</div>
        <div className="text-center">Peso</div>
        <div className="text-center">Reps</div>
        <div className="text-center">RIR</div>
        <div />
      </div>
      <div className="divide-y divide-border-soft/60">
        {(sets ?? []).map((s) => (
          <SetRow
            key={s.id}
            set={s}
            placeholderWeight={null}
            canDelete={(sets?.length ?? 0) > 1}
            onChanged={() => {}}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}
      </div>

      <button
        onClick={async () => {
          try {
            await (onAdd ? onAdd() : addSet(exerciseSessionId));
            setError(null);
          } catch {
            setError("No se pudo agregar la serie. Reintentá.");
          }
        }}
        className="mt-2 w-full flex items-center justify-center gap-1.5 text-accent text-sm py-2 rounded-lg active:bg-accent-soft"
      >
        <Plus size={15} /> Agregar serie
      </button>

      {/* Nota + Timer */}
      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => setShowTimer((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-text-secondary active:text-accent"
        >
          <TimerIcon size={13} /> Descanso
        </button>
      </div>

      {showTimer && (
        <div className="mt-2 flex flex-wrap gap-2">
          {[60, 90, 120, 180].map((s) => (
            <button
              key={s}
              onClick={() => {
                timer.start(s);
                setShowTimer(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-surface-2 text-xs text-text-secondary active:bg-surface-3"
            >
              {s}s
            </button>
          ))}
          <input
            type="text"
            inputMode="numeric"
            value={customSeconds}
            onChange={(e) =>
              setCustomSeconds(e.target.value.replace(/[^0-9]/g, ""))
            }
            placeholder="Otro"
            className="w-16 px-2 py-1.5 rounded-lg bg-surface-2 border border-border-soft text-xs text-center text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
          <button
            onClick={() => {
              const n = parseInt(customSeconds, 10);
              if (n > 0) {
                timer.start(n);
                setShowTimer(false);
                setCustomSeconds("");
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-accent-soft text-accent text-xs active:opacity-80"
          >
            Iniciar
          </button>
        </div>
      )}
    </div>
  );
}
