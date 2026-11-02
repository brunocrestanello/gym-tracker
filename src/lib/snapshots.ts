import { ROUTINE } from "@/data/routine";
import { Exercise, ExerciseSession, ExerciseSnapshot } from "./types";

/** Additive metadata only: original workout, exercise-session and set rows remain untouched. */
export function legacySnapshots(
  exercises: Exercise[],
  sessions: ExerciseSession[],
): ExerciseSnapshot[] {
  return sessions.map((es) => {
    const stored = exercises.find((ex) => ex.id === es.exerciseId);
    const fallback = ROUTINE.find((ex) => ex.id === es.exerciseId);
    const exercise = stored ??
      fallback ?? {
        id: es.exerciseId,
        name: `Ejercicio histórico (${es.exerciseId})`,
        day: 1 as const,
        order: es.order,
        supersetGroup: null,
        supersetLabel: null,
        targetSets: 3,
        targetRepsMin: 0,
        targetRepsMax: 0,
        targetRirMin: 0,
        targetRirMax: 0,
        videoUrl: null,
      };
    return {
      id: es.id,
      exercise: structuredClone(exercise),
      plannedExercise: null,
      provenance: stored
        ? "legacy-catalog"
        : fallback
          ? "legacy-fallback"
          : "legacy-unknown",
    };
  });
}
