import Dexie, { Table } from "dexie";
import {
  Exercise,
  ExerciseSession,
  SetEntry,
  WorkoutSession,
  RoutineTemplate,
  ExerciseSnapshot,
  WorkoutDraft,
} from "./types";
import { legacySnapshots } from "./snapshots";
import { ROUTINE } from "@/data/routine";

export class GymDatabase extends Dexie {
  exercises!: Table<Exercise, string>;
  workoutSessions!: Table<WorkoutSession, string>;
  exerciseSessions!: Table<ExerciseSession, string>;
  sets!: Table<SetEntry, string>;

  templates!: Table<RoutineTemplate, string>;
  exerciseSnapshots!: Table<ExerciseSnapshot, string>;
  workoutDrafts!: Table<WorkoutDraft, string>;

  constructor(name = "gym-tracker-db") {
    super(name);
    this.version(1).stores({
      exercises: "id, day, supersetGroup",
      workoutSessions: "id, date, routineDay, finishedAt, isoYear, isoWeek",
      exerciseSessions: "id, workoutSessionId, exerciseId",
      sets: "id, exerciseSessionId, setNumber",
    });
    this.version(2)
      .stores({
        templates: "id",
        exerciseSnapshots: "id",
        workoutDrafts: "id, day, sessionId",
      })
      .upgrade(async (tx) => {
        const exercises = await tx.table("exercises").toArray();
        const sessions = await tx.table("exerciseSessions").toArray();
        await tx
          .table("exerciseSnapshots")
          .bulkAdd(legacySnapshots(exercises, sessions));
      });
  }
}

export const db = new GymDatabase();

let seedPromise: Promise<void> | null = null;

/** Asegura que la rutina esté cargada en IndexedDB en la primera apertura. */
export async function ensureSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = db
    .transaction("rw", db.exercises, async () => {
      // Solo cargar una base nueva. Nunca sobrescribir metadatos restaurados.
      if ((await db.exercises.count()) === 0)
        await db.exercises.bulkAdd(ROUTINE);
    })
    .catch((error) => {
      seedPromise = null;
      throw error;
    });
  return seedPromise;
}
