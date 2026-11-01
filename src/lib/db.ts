import Dexie, { Table } from "dexie";
import { Exercise, ExerciseSession, SetEntry, WorkoutSession } from "./types";
import { ROUTINE } from "@/data/routine";

export class GymDatabase extends Dexie {
  exercises!: Table<Exercise, string>;
  workoutSessions!: Table<WorkoutSession, string>;
  exerciseSessions!: Table<ExerciseSession, string>;
  sets!: Table<SetEntry, string>;

  constructor() {
    super("gym-tracker-db");
    this.version(1).stores({
      exercises: "id, day, supersetGroup",
      workoutSessions: "id, date, routineDay, finishedAt, isoYear, isoWeek",
      exerciseSessions: "id, workoutSessionId, exerciseId",
      sets: "id, exerciseSessionId, setNumber",
    });
  }
}

export const db = new GymDatabase();

let seedPromise: Promise<void> | null = null;

/** Asegura que la rutina esté cargada en IndexedDB en la primera apertura. */
export async function ensureSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = db.transaction("rw", db.exercises, async () => {
    // Solo cargar una base nueva. Nunca sobrescribir metadatos restaurados.
    if (await db.exercises.count() === 0) await db.exercises.bulkAdd(ROUTINE);
  }).catch((error) => {
    seedPromise = null;
    throw error;
  });
  return seedPromise;
}
