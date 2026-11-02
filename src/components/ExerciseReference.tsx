"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { exerciseInsights, readExerciseTrainings } from "@/lib/insights";
import { formatDateShort } from "@/lib/dates";
import type { SetEntry } from "@/lib/types";

export function RecordedSets({ sets }: { sets: SetEntry[] }) {
  return (
    <ol className="space-y-1 text-sm tabular">
      {sets.map((s, i) => (
        <li key={s.id} className="flex justify-between gap-3">
          <span className="text-text-secondary">Serie {i + 1}</span>
          <span>
            {s.weight ?? "—"} kg × {s.reps ?? "—"}{" "}
            <span className="text-text-secondary">· RIR {s.rir ?? "—"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
export default function ExerciseReference({
  exerciseId,
  excludeWorkoutId,
}: {
  exerciseId: string;
  excludeWorkoutId?: string;
}) {
  const result = useLiveQuery(async () => {
    try {
      return {
        data: exerciseInsights(
          await readExerciseTrainings(exerciseId, excludeWorkoutId),
        ),
        error: false,
      };
    } catch {
      return { data: null, error: true };
    }
  }, [exerciseId, excludeWorkoutId]);
  return (
    <aside className="reference-panel" aria-label="Referencia y récords">
      {!result ? (
        <p className="text-sm text-text-secondary">Cargando referencia…</p>
      ) : result.error ? (
        <p role="alert">No se pudo leer la referencia anterior.</p>
      ) : (
        <>
          <p className="eyebrow mb-2">Último entrenamiento</p>
          {result.data?.last ? (
            <>
              <p className="text-sm mb-3">
                {formatDateShort(result.data.last.session.date)} · Día{" "}
                {result.data.last.session.routineDay}
              </p>
              <RecordedSets sets={result.data.last.sets} />
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              Sin registros anteriores. Tu próxima serie inicia esta historia.
            </p>
          )}
          <div className="mt-4 pt-3 border-t border-border">
            <p className="eyebrow mb-2">Récords históricos · series válidas</p>
            {result.data?.weightRecord ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p>
                  <span className="block text-text-secondary text-xs">
                    Mayor peso
                  </span>
                  <strong>
                    {result.data.weightRecord.weight} kg ×{" "}
                    {result.data.weightRecord.reps}
                  </strong>
                </p>
                <p>
                  <span className="block text-text-secondary text-xs">
                    Más repeticiones
                  </span>
                  <strong>
                    {result.data.repsRecord!.reps} reps ·{" "}
                    {result.data.repsRecord!.weight} kg
                  </strong>
                </p>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">
                Todavía no hay series válidas para calcular récords.
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
