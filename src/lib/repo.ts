import { v4 as uuid } from "uuid";
import { db } from "./db";
import { exerciseById, exercisesForDay } from "@/data/routine";
import { isoWeekInfo, nowIso, todayDateString } from "./dates";
import { bestE1rm, maxWeight as maxW, e1rm } from "./calculations";
import {
  BackupPayload,
  Exercise,
  ExerciseSession,
  ExerciseSessionWithSets,
  RoutineDay,
  SetEntry,
  WorkoutSession,
  WorkoutSessionFull,
} from "./types";

/** Sesión en curso (finishedAt === null), si existe. */
export async function getActiveSession(): Promise<WorkoutSession | undefined> {
  const all = await db.workoutSessions.filter((s) => s.finishedAt === null).toArray();
  return all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
}

export async function getLastFinishedSession(): Promise<WorkoutSession | undefined> {
  const all = await db.workoutSessions.filter((s) => s.finishedAt !== null).toArray();
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
}

/** Crea (o reanuda) la sesión de un día, con sus exerciseSessions ya armados. */
export async function startOrResumeSession(day: RoutineDay): Promise<WorkoutSession> {
  const active = await getActiveSession();
  if (active && active.routineDay === day) return active;
  if (active) {
    // Ya hay un entrenamiento en curso de otro día: lo devolvemos igual,
    // la UI decide si ofrecer continuarlo o descartarlo.
    return active;
  }

  const date = todayDateString();
  const { isoWeek, isoYear, weekStart } = isoWeekInfo(date);
  const session: WorkoutSession = {
    id: uuid(),
    date,
    routineDay: day,
    startedAt: nowIso(),
    finishedAt: null,
    duration: null,
    isoWeek,
    isoYear,
    weekStart,
    note: null,
  };
  await db.workoutSessions.add(session);

  const exercises = exercisesForDay(day);
  const exSessions: ExerciseSession[] = exercises.map((ex, idx) => ({
    id: uuid(),
    workoutSessionId: session.id,
    exerciseId: ex.id,
    order: idx + 1,
    note: null,
  }));
  await db.exerciseSessions.bulkAdd(exSessions);

  // Tres series iniciales por ejercicio.
  const initialSets: SetEntry[] = [];
  for (const es of exSessions) {
    for (let i = 1; i <= 3; i++) {
      initialSets.push({
        id: uuid(),
        exerciseSessionId: es.id,
        setNumber: i,
        weight: null,
        reps: null,
        rir: null,
        isPr: false,
      });
    }
  }
  await db.sets.bulkAdd(initialSets);

  return session;
}

export async function discardSession(workoutSessionId: string): Promise<void> {
  await deleteSession(workoutSessionId);
}

export async function getWorkoutSessionFull(
  workoutSessionId: string
): Promise<WorkoutSessionFull | undefined> {
  const session = await db.workoutSessions.get(workoutSessionId);
  if (!session) return undefined;
  const exSessions = await db.exerciseSessions
    .where("workoutSessionId")
    .equals(workoutSessionId)
    .sortBy("order");

  const full: ExerciseSessionWithSets[] = [];
  for (const es of exSessions) {
    const sets = await db.sets.where("exerciseSessionId").equals(es.id).sortBy("setNumber");
    const exercise = exerciseById(es.exerciseId);
    if (!exercise) continue;
    full.push({ ...es, sets, exercise });
  }

  return { ...session, exerciseSessions: full };
}

export async function addSet(exerciseSessionId: string): Promise<SetEntry> {
  const existing = await db.sets.where("exerciseSessionId").equals(exerciseSessionId).toArray();
  const nextNumber = existing.length ? Math.max(...existing.map((s) => s.setNumber)) + 1 : 1;
  const set: SetEntry = {
    id: uuid(),
    exerciseSessionId,
    setNumber: nextNumber,
    weight: null,
    reps: null,
    rir: null,
    isPr: false,
  };
  await db.sets.add(set);
  return set;
}

export async function removeSet(setId: string): Promise<void> {
  await db.sets.delete(setId);
}

export async function updateSet(
  setId: string,
  patch: Partial<Pick<SetEntry, "weight" | "reps" | "rir">>
): Promise<void> {
  const clean: Partial<SetEntry> = {};
  if ("weight" in patch) clean.weight = patch.weight === null ? null : Math.max(0, patch.weight!);
  if ("reps" in patch) clean.reps = patch.reps === null ? null : Math.max(0, Math.round(patch.reps!));
  if ("rir" in patch) clean.rir = patch.rir === null ? null : Math.max(0, patch.rir!);
  await db.sets.update(setId, clean);
}

export async function updateExerciseSessionNote(
  exerciseSessionId: string,
  note: string | null
): Promise<void> {
  await db.exerciseSessions.update(exerciseSessionId, { note });
}

export async function updateWorkoutSessionNote(
  workoutSessionId: string,
  note: string | null
): Promise<void> {
  await db.workoutSessions.update(workoutSessionId, { note });
}

/** Busca la sesión anterior (finalizada) más reciente de un ejercicio, sin importar el día. */
export async function getPreviousExerciseData(
  exerciseId: string,
  excludeWorkoutSessionId?: string
): Promise<{ date: string; sets: SetEntry[] } | null> {
  const exSessions = await db.exerciseSessions.where("exerciseId").equals(exerciseId).toArray();
  const candidates: { session: WorkoutSession; es: ExerciseSession }[] = [];
  for (const es of exSessions) {
    if (es.workoutSessionId === excludeWorkoutSessionId) continue;
    const session = await db.workoutSessions.get(es.workoutSessionId);
    if (!session || session.finishedAt === null) continue;
    candidates.push({ session, es });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) =>
    a.session.date < b.session.date
      ? 1
      : a.session.date > b.session.date
      ? -1
      : a.session.startedAt < b.session.startedAt
      ? 1
      : -1
  );
  const top = candidates[0];
  const sets = await db.sets.where("exerciseSessionId").equals(top.es.id).sortBy("setNumber");
  return { date: top.session.date, sets };
}

/** Historial de e1RM/peso/volumen histórico (sesiones finalizadas) de un ejercicio, excluyendo una sesión opcional. */
async function getHistoricalExerciseSessions(
  exerciseId: string,
  excludeWorkoutSessionId?: string
) {
  const exSessions = await db.exerciseSessions.where("exerciseId").equals(exerciseId).toArray();
  const out: { session: WorkoutSession; sets: SetEntry[] }[] = [];
  for (const es of exSessions) {
    if (es.workoutSessionId === excludeWorkoutSessionId) continue;
    const session = await db.workoutSessions.get(es.workoutSessionId);
    if (!session || session.finishedAt === null) continue;
    const sets = await db.sets.where("exerciseSessionId").equals(es.id).sortBy("setNumber");
    out.push({ session, sets });
  }
  out.sort((a, b) => (a.session.date < b.session.date ? -1 : 1));
  return out;
}

export interface FinishSummary {
  exerciseCount: number;
  setCount: number;
  totalVolume: number;
  durationSeconds: number;
  prCount: number;
}

/** Finaliza la sesión: marca PRs por serie y devuelve el resumen. */
export async function finishSession(workoutSessionId: string): Promise<FinishSummary> {
  const session = await db.workoutSessions.get(workoutSessionId);
  if (!session) throw new Error("Sesión no encontrada");

  const finishedAt = nowIso();
  const startedMs = new Date(session.startedAt).getTime();
  const finishedMs = new Date(finishedAt).getTime();
  const durationSeconds = Math.max(0, Math.round((finishedMs - startedMs) / 1000));

  const exSessions = await db.exerciseSessions
    .where("workoutSessionId")
    .equals(workoutSessionId)
    .toArray();

  let totalVolume = 0;
  let setCount = 0;
  let prCount = 0;

  for (const es of exSessions) {
    const sets = await db.sets.where("exerciseSessionId").equals(es.id).sortBy("setNumber");
    const validSets = sets.filter((s) => s.weight != null && s.reps != null);
    setCount += validSets.length;
    const sessionVolume = validSets.reduce((acc, s) => acc + s.weight! * s.reps!, 0);
    totalVolume += sessionVolume;

    if (!validSets.length) continue;

    const history = await getHistoricalExerciseSessions(es.exerciseId, workoutSessionId);
    let histMaxWeight = 0;
    let histMaxE1rm = 0;
    let histMaxVolume = 0;
    for (const h of history) {
      const validHistSets = h.sets.filter((s) => s.weight != null && s.reps != null);
      histMaxWeight = Math.max(histMaxWeight, maxW(validHistSets));
      histMaxE1rm = Math.max(histMaxE1rm, bestE1rm(validHistSets));
      const vol = validHistSets.reduce((acc, s) => acc + s.weight! * s.reps!, 0);
      histMaxVolume = Math.max(histMaxVolume, vol);
    }

    const beatsVolume = history.length > 0 && sessionVolume > histMaxVolume;
    let volumePrAssigned = false;

    for (const s of validSets) {
      let isPr = false;
      if (history.length === 0) {
        // Primera vez que se registra este ejercicio: no es "récord" comparativo.
        isPr = false;
      } else {
        if (s.weight! > histMaxWeight) isPr = true;
        if (e1rm(s.weight!, s.reps!) > histMaxE1rm) isPr = true;
        if (beatsVolume && !volumePrAssigned) {
          isPr = true;
          volumePrAssigned = true;
        }
      }
      if (isPr) {
        await db.sets.update(s.id, { isPr: true });
        prCount++;
      }
    }
  }

  await db.workoutSessions.update(workoutSessionId, {
    finishedAt,
    duration: durationSeconds,
  });

  return {
    exerciseCount: exSessions.length,
    setCount,
    totalVolume,
    durationSeconds,
    prCount,
  };
}

export async function deleteSession(workoutSessionId: string): Promise<void> {
  const exSessions = await db.exerciseSessions
    .where("workoutSessionId")
    .equals(workoutSessionId)
    .toArray();
  for (const es of exSessions) {
    await db.sets.where("exerciseSessionId").equals(es.id).delete();
  }
  await db.exerciseSessions.where("workoutSessionId").equals(workoutSessionId).delete();
  await db.workoutSessions.delete(workoutSessionId);
}

export async function listSessions(): Promise<WorkoutSession[]> {
  const all = await db.workoutSessions.filter((s) => s.finishedAt !== null).toArray();
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.startedAt < b.startedAt ? 1 : -1)));
}

export async function getExerciseHistory(
  exerciseId: string
): Promise<{ session: WorkoutSession; sets: SetEntry[] }[]> {
  const rows = await getHistoricalExerciseSessions(exerciseId);
  return rows.reverse(); // más reciente primero
}

// ---------------- Backup ----------------

export async function exportBackup(): Promise<BackupPayload> {
  const [exercises, workoutSessions, exerciseSessions, sets] = await Promise.all([
    db.exercises.toArray(),
    db.workoutSessions.toArray(),
    db.exerciseSessions.toArray(),
    db.sets.toArray(),
  ]);
  return {
    version: 1,
    exportedAt: nowIso(),
    exercises,
    workoutSessions,
    exerciseSessions,
    sets,
  };
}

export async function importBackup(payload: BackupPayload): Promise<void> {
  if (!payload || payload.version !== 1) {
    throw new Error("Archivo de backup inválido o incompatible");
  }
  await db.transaction("rw", db.exercises, db.workoutSessions, db.exerciseSessions, db.sets, async () => {
    await db.exercises.clear();
    await db.workoutSessions.clear();
    await db.exerciseSessions.clear();
    await db.sets.clear();
    await db.exercises.bulkAdd(payload.exercises);
    await db.workoutSessions.bulkAdd(payload.workoutSessions);
    await db.exerciseSessions.bulkAdd(payload.exerciseSessions);
    await db.sets.bulkAdd(payload.sets);
  });
}

export type { Exercise };
