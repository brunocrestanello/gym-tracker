import { BackupPayload } from "./types";
import { isoWeekInfo } from "./dates";

type Row = Record<string, unknown>;
function requireValid(ok: unknown): asserts ok {
  if (!ok) throw new Error("Backup inválido o inconsistente. No se modificaron los datos.");
}
function record(value: unknown): Row {
  requireValid(value && typeof value === "object" && !Array.isArray(value));
  return value as Row;
}
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const nullableText = (v: unknown) => v === null || typeof v === "string";
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const integer = (v: unknown) => number(v) && Number.isInteger(v);
const positive = (v: unknown) => integer(v) && (v as number) > 0;
const day = (v: unknown) => integer(v) && (v as number) >= 1 && (v as number) <= 4;
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const timestamp = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && date(v.slice(0,10)) && Number.isFinite(Date.parse(v));

/** Validates a detached JSON snapshot before any destructive operation. Keeps v1 fields intact. */
export function validateBackup(input: unknown): BackupPayload {
  // Detach from the caller so it cannot mutate rows while a transaction is waiting.
  const p = record(structuredClone(input));
  requireValid(p.version === 1 && timestamp(p.exportedAt));
  const tables = new Map<string, Row[]>();
  for (const key of ["exercises", "workoutSessions", "exerciseSessions", "sets"]) {
    requireValid(Array.isArray(p[key]));
    const rows = (p[key] as unknown[]).map(record);
    const ids = new Set();
    for (const r of rows) {
      requireValid(text(r.id) && !ids.has(r.id));
      ids.add(r.id);
    }
    tables.set(key, rows);
  }
  const exercises = tables.get("exercises")!;
  const workouts = tables.get("workoutSessions")!;
  const sessions = tables.get("exerciseSessions")!;
  const sets = tables.get("sets")!;
  const exerciseIds = new Set(exercises.map(r => r.id));
  const workoutIds = new Set(workouts.map(r => r.id));
  const sessionIds = new Set(sessions.map(r => r.id));
  for (const r of exercises) {
    requireValid(text(r.name) && day(r.day) && positive(r.order) && positive(r.targetSets));
    requireValid(nullableText(r.supersetGroup) && nullableText(r.supersetLabel) && nullableText(r.videoUrl));
    for (const k of ["targetRepsMin", "targetRepsMax", "targetRirMin", "targetRirMax"]) requireValid(number(r[k]));
    requireValid(integer(r.targetRepsMin) && integer(r.targetRepsMax));
    requireValid((r.targetRepsMin as number) <= (r.targetRepsMax as number) && (r.targetRirMin as number) <= (r.targetRirMax as number));
  }
  requireValid(workouts.filter(r => r.finishedAt === null).length <= 1);
  for (const r of workouts) {
    requireValid(date(r.date) && day(r.routineDay) && timestamp(r.startedAt) && nullableText(r.note));
    requireValid(date(r.weekStart) && positive(r.isoYear) && positive(r.isoWeek));
    const week = isoWeekInfo(r.date as string);
    requireValid(r.isoYear === week.isoYear && r.isoWeek === week.isoWeek && r.weekStart === week.weekStart);
    // v1 used Math.max(0, elapsed). A device clock reversal is valid legacy data.
    requireValid(r.finishedAt === null ? r.duration === null : timestamp(r.finishedAt) && integer(r.duration));
  }
  // Do not silently repair existing duplicates: users retain the original file.
  const pairs = new Set<string>();
  for (const r of sessions) {
    requireValid(workoutIds.has(r.workoutSessionId) && exerciseIds.has(r.exerciseId) && positive(r.order) && nullableText(r.note));
    const pair = JSON.stringify([r.workoutSessionId, r.exerciseId]);
    requireValid(!pairs.has(pair)); pairs.add(pair);
  }
  pairs.clear();
  for (const r of sets) {
    requireValid(sessionIds.has(r.exerciseSessionId) && positive(r.setNumber) && typeof r.isPr === "boolean");
    for (const k of ["weight", "reps", "rir"]) requireValid(r[k] === null || number(r[k]));
    requireValid(r.reps === null || integer(r.reps));
    const pair = JSON.stringify([r.exerciseSessionId, r.setNumber]);
    requireValid(!pairs.has(pair)); pairs.add(pair);
  }
  return p as unknown as BackupPayload;
}
