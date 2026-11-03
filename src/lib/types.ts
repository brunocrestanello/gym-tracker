export type RoutineDay = 1 | 2 | 3 | 4;

export interface Exercise {
  id: string;
  name: string;
  day: RoutineDay;
  order: number; // 1,2,3... within the day (matches "1", "2", "3"...)
  supersetGroup: string | null; // e.g. "D1-3" groups 3A/3B together; null if standalone
  supersetLabel: string | null; // "A" | "B" | null
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRirMin: number;
  targetRirMax: number;
  videoUrl: string | null;
}

export interface WorkoutSession {
  id: string;
  date: string; // YYYY-MM-DD in America/Montevideo
  routineDay: RoutineDay;
  startedAt: string; // ISO datetime
  finishedAt: string | null; // ISO datetime, null while in progress
  duration: number | null; // seconds
  isoWeek: number;
  isoYear: number;
  weekStart: string; // YYYY-MM-DD (Monday)
  note: string | null;
  templateId?: string;
}

export interface ExerciseSession {
  origin?: ExerciseOrigin;
  status?: ExerciseStatus;
  id: string;
  workoutSessionId: string;
  exerciseId: string;
  order: number;
  note: string | null;
}

export interface SetEntry {
  id: string;
  exerciseSessionId: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
  isPr: boolean;
}

// Convenience hydrated shapes used in the UI layer (not persisted as-is)
export interface ExerciseSessionWithSets extends ExerciseSession {
  sets: SetEntry[];
  exercise: Exercise;
}

export interface WorkoutSessionFull extends WorkoutSession {
  exerciseSessions: ExerciseSessionWithSets[];
}

export interface BackupV1 {
  version: 1;
  exportedAt: string;
  exercises: Exercise[];
  workoutSessions: WorkoutSession[];
  exerciseSessions: ExerciseSession[];
  sets: SetEntry[];
}

export type MetricType = "maxWeight" | "e1rm" | "volume" | "maxReps";
export type PeriodType = "1m" | "3m" | "6m" | "all";

export interface RoutineTemplate {
  id: string;
  name: string;
  exercises: Exercise[];
}
export type ExerciseOrigin = "template" | "substitution" | "additional";
export type ExerciseStatus = "pending" | "performed" | "omitted";
export interface ExerciseSnapshot {
  id: string; // exerciseSessionId, never a position in the current routine
  exercise: Exercise;
  plannedExercise: Exercise | null;
  provenance:
    | "captured"
    | "legacy-catalog"
    | "legacy-fallback"
    | "legacy-unknown";
}
export interface DraftExercise {
  id: string;
  exercise: Exercise;
  plannedExercise: Exercise | null;
  origin: ExerciseOrigin;
  status: ExerciseStatus;
  sets: SetEntry[];
}
export interface WorkoutDraft {
  id: string; // one draft per original day
  token: string; // guards stale windows after finish/discard/restore
  day: RoutineDay;
  templateId: string;
  sessionId: string | null;
  exercises: DraftExercise[];
}
export interface BackupV2 extends Omit<BackupV1, "version"> {
  version: 2;
  templates: RoutineTemplate[];
  exerciseSnapshots: ExerciseSnapshot[];
  workoutDrafts: WorkoutDraft[];
}
export type BackupPayload = BackupV1 | BackupV2;
