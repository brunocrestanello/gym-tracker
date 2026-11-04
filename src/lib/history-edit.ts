import { v4 as uuid } from "uuid";
import { db } from "./db";
import { getWorkoutSessionFull, exportBackup } from "./repo";
import { validateBackup } from "./backup";
import { waitForWrites } from "./persistence";
import type {
  Exercise,
  ExerciseSessionWithSets,
  ExerciseSnapshot,
  SetEntry,
  WorkoutSessionFull,
} from "./types";

export interface WorkoutEdit {
  session: WorkoutSessionFull;
  snapshots: ExerciseSnapshot[];
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export async function readWorkoutEdit(id: string): Promise<WorkoutEdit | null> {
  return db.transaction("r", db.tables, async () => {
    const session = await getWorkoutSessionFull(id);
    if (!session) return null;
    const snapshots = await db.exerciseSnapshots.bulkGet(
      session.exerciseSessions.map((e) => e.id),
    );
    if (snapshots.some((s) => !s))
      throw new Error(
        "Faltan metadatos históricos. No se modificó el entrenamiento.",
      );
    return { session, snapshots: snapshots as ExerciseSnapshot[] };
  });
}
export function blankHistorySet(parentId: string, number: number): SetEntry {
  return {
    id: uuid(),
    exerciseSessionId: parentId,
    setNumber: number,
    weight: null,
    reps: null,
    rir: null,
    isPr: false,
  };
}
export function additionalHistoryExercise(
  exercise: Exercise,
  workoutId: string,
  order: number,
): { row: ExerciseSessionWithSets; snapshot: ExerciseSnapshot } {
  const id = uuid();
  return {
    row: {
      id,
      workoutSessionId: workoutId,
      exerciseId: exercise.id,
      order,
      note: null,
      origin: "additional",
      status: "pending",
      exercise: structuredClone(exercise),
      sets: Array.from({ length: exercise.targetSets }, (_, i) =>
        blankHistorySet(id, i + 1),
      ),
    },
    snapshot: {
      id,
      exercise: structuredClone(exercise),
      plannedExercise: null,
      provenance: "captured",
    },
  };
}
/** One explicit Save commits everything, or nothing. Never reopens or redates a workout. */
export async function saveWorkoutEdit(
  original: WorkoutEdit,
  edited: WorkoutEdit,
): Promise<void> {
  await waitForWrites();
  await db.transaction("rw", db.tables, async () => {
    const current = await readWorkoutEdit(original.session.id);
    if (!current || current.session.finishedAt === null)
      throw new Error("Solo se pueden editar entrenamientos finalizados.");
    if (!equal(current, original))
      throw new Error(
        "El entrenamiento cambió en otra ventana o fue restaurado. Cancelá la edición y volvé a abrirlo.",
      );
    const header = (s: WorkoutSessionFull) => {
      const { exerciseSessions, note, ...rest } = s;
      void exerciseSessions;
      void note;
      return rest;
    };
    if (!equal(header(original.session), header(edited.session)))
      throw new Error(
        "No se puede cambiar la identidad, fecha, día original ni finalización.",
      );
    const rows = edited.session.exerciseSessions;
    const oldIds = new Set(original.session.exerciseSessions.map((e) => e.id));
    const oldSetIds = new Set(
      original.session.exerciseSessions.flatMap((e) => e.sets.map((s) => s.id)),
    );
    for (const row of rows) {
      if (
        row.workoutSessionId !== original.session.id ||
        row.exercise.id !== row.exerciseId
      )
        throw new Error("Ejercicio inconsistente.");
      if (!oldIds.has(row.id) && (await db.exerciseSessions.get(row.id)))
        throw new Error("Identificador de ejercicio en uso.");
      for (const set of row.sets) {
        if (set.exerciseSessionId !== row.id)
          throw new Error("Serie inconsistente.");
        if (
          oldSetIds.has(set.id) &&
          !original.session.exerciseSessions
            .find((e) => e.id === row.id)
            ?.sets.some((s) => s.id === set.id)
        )
          throw new Error("No se pueden trasladar identificadores de series.");
        if (!oldSetIds.has(set.id) && (await db.sets.get(set.id)))
          throw new Error("Identificador de serie en uso.");
      }
    }
    const candidate = await exportBackup();
    candidate.workoutSessions = candidate.workoutSessions.map((s) =>
      s.id === original.session.id ? { ...s, note: edited.session.note } : s,
    );
    candidate.exerciseSessions = candidate.exerciseSessions.filter(
      (e) => !oldIds.has(e.id),
    );
    candidate.sets = candidate.sets.filter((s) => !oldSetIds.has(s.id));
    candidate.exerciseSnapshots = candidate.exerciseSnapshots.filter(
      (s) => !oldIds.has(s.id),
    );
    for (const row of rows) {
      const { sets, exercise, ...entry } = row;
      candidate.exerciseSessions.push(entry);
      candidate.sets.push(...sets);
      if (!candidate.exercises.some((e) => e.id === exercise.id))
        candidate.exercises.push(exercise);
    }
    candidate.exerciseSnapshots.push(...edited.snapshots);
    // Existing backup rules also enforce omitted rows without fabricated zero sets.
    validateBackup(candidate);
    const wantedRows = new Set(rows.map((e) => e.id)),
      wantedSets = new Set(rows.flatMap((e) => e.sets.map((s) => s.id)));
    await db.sets.bulkDelete(
      [...oldSetIds].filter((id) => !wantedSets.has(id)),
    );
    await db.exerciseSessions.bulkDelete(
      [...oldIds].filter((id) => !wantedRows.has(id)),
    );
    await db.exerciseSnapshots.bulkDelete(
      [...oldIds].filter((id) => !wantedRows.has(id)),
    );
    for (const row of rows) {
      const { sets, exercise, ...entry } = row;
      if (!(await db.exercises.get(exercise.id)))
        await db.exercises.add(exercise);
      const existing = original.session.exerciseSessions.find(
        (e) => e.id === row.id,
      );
      const oldEntry = existing
        ? (({ sets, exercise, ...rest }) => {
            void sets;
            void exercise;
            return rest;
          })(existing)
        : undefined;
      if (!equal(entry, oldEntry)) await db.exerciseSessions.put(entry);
      for (const set of sets)
        if (
          !equal(
            set,
            existing?.sets.find((s) => s.id === set.id),
          )
        )
          await db.sets.put(set);
    }
    for (const snap of edited.snapshots)
      if (
        !equal(
          snap,
          original.snapshots.find((s) => s.id === snap.id),
        )
      )
        await db.exerciseSnapshots.put(snap);
    if (edited.session.note !== original.session.note)
      await db.workoutSessions.update(original.session.id, {
        note: edited.session.note,
      });
  });
}
