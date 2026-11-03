import { db } from "./db";
import { isValidSet } from "./calculations";
import type { Exercise, SetEntry, WorkoutSession } from "./types";

export type ExerciseTraining = {
  session: WorkoutSession;
  exercise: Exercise;
  sets: SetEntry[];
};
export const hasRecordedValue = (s: SetEntry) =>
  s.weight !== null || s.reps !== null || s.rir !== null;
export function summarizeSets(sets: SetEntry[]) {
  const valid = sets.filter(isValidSet);
  const weightRecord =
    [...valid].sort((a, b) => b.weight! - a.weight! || b.reps! - a.reps!)[0] ??
    null;
  const repsRecord =
    [...valid].sort((a, b) => b.reps! - a.reps! || b.weight! - a.weight!)[0] ??
    null;
  return {
    weightRecord,
    repsRecord,
    maxWeight: weightRecord?.weight ?? null,
    maxReps: repsRecord?.reps ?? null,
    setCount: valid.length,
    volume: valid.reduce((n, s) => n + s.weight! * s.reps!, 0),
  };
}
/** Read only. Identity is the stored exercise ID, never its label or current day. */
export async function readExerciseTrainings(
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<ExerciseTraining[]> {
  return db.transaction(
    "r",
    [
      db.workoutSessions,
      db.exerciseSessions,
      db.sets,
      db.exercises,
      db.exerciseSnapshots,
    ],
    async () => {
      const entries = await db.exerciseSessions
        .where("exerciseId")
        .equals(exerciseId)
        .sortBy("order");
      const grouped = new Map<string, ExerciseTraining>();
      for (const entry of entries) {
        if (
          entry.workoutSessionId === excludeWorkoutId ||
          entry.status === "omitted"
        )
          continue;
        const session = await db.workoutSessions.get(entry.workoutSessionId);
        if (!session || session.finishedAt === null) continue;
        const sets = await db.sets
          .where("exerciseSessionId")
          .equals(entry.id)
          .sortBy("setNumber");
        if (!sets.some(hasRecordedValue)) continue;
        const exercise =
          (await db.exerciseSnapshots.get(entry.id))?.exercise ??
          (await db.exercises.get(exerciseId));
        if (!exercise)
          throw new Error("Faltan metadatos históricos del ejercicio.");
        const row = grouped.get(session.id) ?? { session, exercise, sets: [] };
        row.sets.push(...sets);
        grouped.set(session.id, row);
      }
      return [...grouped.values()].sort(
        (a, b) =>
          b.session.date.localeCompare(a.session.date) ||
          b.session.startedAt.localeCompare(a.session.startedAt) ||
          b.session.id.localeCompare(a.session.id),
      );
    },
  );
}
export function exerciseInsights(history: ExerciseTraining[]) {
  const records = summarizeSets(history.flatMap((h) => h.sets));
  return {
    ...records,
    last: history[0] ?? null,
    points: history.filter((h) => summarizeSets(h.sets).setCount > 0),
  };
}
