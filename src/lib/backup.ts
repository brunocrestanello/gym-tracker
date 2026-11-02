import { BackupPayload } from "./types";
import { isoWeekInfo } from "./dates";

type Row = Record<string, unknown>;
function requireValid(ok: unknown): asserts ok {
  if (!ok)
    throw new Error(
      "Backup inválido o inconsistente. No se modificaron los datos.",
    );
}
function record(value: unknown): Row {
  requireValid(value && typeof value === "object" && !Array.isArray(value));
  return value as Row;
}
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const nullableText = (v: unknown) => v === null || typeof v === "string";
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const integer = (v: unknown) => number(v) && Number.isInteger(v);
const positive = (v: unknown) => integer(v) && (v as number) > 0;
const day = (v: unknown) =>
  integer(v) && (v as number) >= 1 && (v as number) <= 4;
const date = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const timestamp = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
  date(v.slice(0, 10)) &&
  Number.isFinite(Date.parse(v));

function validateExercise(r: Row): void {
  requireValid(text(r.id));
  requireValid(
    text(r.name) && day(r.day) && positive(r.order) && positive(r.targetSets),
  );
  requireValid(
    nullableText(r.supersetGroup) &&
      nullableText(r.supersetLabel) &&
      nullableText(r.videoUrl),
  );
  for (const k of [
    "targetRepsMin",
    "targetRepsMax",
    "targetRirMin",
    "targetRirMax",
  ])
    requireValid(number(r[k]));
  requireValid(integer(r.targetRepsMin) && integer(r.targetRepsMax));
  requireValid(
    (r.targetRepsMin as number) <= (r.targetRepsMax as number) &&
      (r.targetRirMin as number) <= (r.targetRirMax as number),
  );
}

/** Validates a detached JSON snapshot before any destructive operation. Keeps v1 fields intact. */
export function validateBackup(input: unknown): BackupPayload {
  // Detach from the caller so it cannot mutate rows while a transaction is waiting.
  const p = record(structuredClone(input));
  requireValid((p.version === 1 || p.version === 2) && timestamp(p.exportedAt));
  if (p.version === 1)
    requireValid(
      !("templates" in p) &&
        !("exerciseSnapshots" in p) &&
        !("workoutDrafts" in p),
    );
  const tables = new Map<string, Row[]>();
  for (const key of [
    "exercises",
    "workoutSessions",
    "exerciseSessions",
    "sets",
  ]) {
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
  const exerciseIds = new Set(exercises.map((r) => r.id));
  const workoutIds = new Set(workouts.map((r) => r.id));
  const sessionIds = new Set(sessions.map((r) => r.id));
  for (const r of exercises) validateExercise(r);
  requireValid(workouts.filter((r) => r.finishedAt === null).length <= 1);
  for (const r of workouts) {
    if (p.version === 1) requireValid(!("templateId" in r));
    requireValid(
      date(r.date) &&
        day(r.routineDay) &&
        timestamp(r.startedAt) &&
        nullableText(r.note),
    );
    requireValid(
      date(r.weekStart) && positive(r.isoYear) && positive(r.isoWeek),
    );
    const week = isoWeekInfo(r.date as string);
    requireValid(
      r.isoYear === week.isoYear &&
        r.isoWeek === week.isoWeek &&
        r.weekStart === week.weekStart,
    );
    // v1 used Math.max(0, elapsed). A device clock reversal is valid legacy data.
    requireValid(
      r.finishedAt === null
        ? r.duration === null
        : timestamp(r.finishedAt) && integer(r.duration),
    );
  }
  // Do not silently repair existing duplicates: users retain the original file.
  const pairs = new Set<string>();
  for (const r of sessions) {
    if (p.version === 1) requireValid(!("origin" in r) && !("status" in r));
    requireValid(
      workoutIds.has(r.workoutSessionId) &&
        exerciseIds.has(r.exerciseId) &&
        positive(r.order) &&
        nullableText(r.note),
    );
    const pair = JSON.stringify([r.workoutSessionId, r.exerciseId]);
    requireValid(p.version === 2 || !pairs.has(pair));
    pairs.add(pair);
    if (p.version === 2) {
      if ("origin" in r)
        requireValid(
          ["template", "substitution", "additional"].includes(
            r.origin as string,
          ),
        );
      if ("status" in r)
        requireValid(
          ["pending", "performed", "omitted"].includes(r.status as string),
        );
    }
  }
  pairs.clear();
  for (const r of sets) {
    requireValid(
      sessionIds.has(r.exerciseSessionId) &&
        positive(r.setNumber) &&
        typeof r.isPr === "boolean",
    );
    for (const k of ["weight", "reps", "rir"])
      requireValid(r[k] === null || number(r[k]));
    requireValid(r.reps === null || integer(r.reps));
    const pair = JSON.stringify([r.exerciseSessionId, r.setNumber]);
    requireValid(!pairs.has(pair));
    pairs.add(pair);
  }
  if (p.version === 2) validateV2(p, workouts, sessions, sets);
  return p as unknown as BackupPayload;
}

function rows(value: unknown): Row[] {
  requireValid(Array.isArray(value));
  const result = value.map(record);
  const ids = new Set();
  for (const r of result) {
    requireValid(text(r.id) && !ids.has(r.id));
    ids.add(r.id);
  }
  return result;
}
// JSON member order is irrelevant; accept semantically identical snapshots.
function sameData(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function validateV2(
  p: Row,
  workouts: Row[],
  sessions: Row[],
  sets: Row[],
): void {
  const templates = rows(p.templates),
    snapshots = rows(p.exerciseSnapshots),
    drafts = rows(p.workoutDrafts);
  const templateIds = new Set(templates.map((t) => t.id));
  for (const t of templates) {
    requireValid(text(t.name) && Array.isArray(t.exercises));
    for (const ex of t.exercises as unknown[]) validateExercise(record(ex));
  }
  for (const w of workouts)
    if ("templateId" in w)
      requireValid(
        text(w.templateId) &&
          (w.templateId === "legacy" || templateIds.has(w.templateId)),
      );
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));
  requireValid(snapshots.length === sessions.length);
  for (const snap of snapshots) {
    const es = sessionMap.get(snap.id);
    requireValid(es);
    const ex = record(snap.exercise);
    validateExercise(ex);
    requireValid(ex.id === es.exerciseId);
    requireValid(
      [
        "captured",
        "legacy-catalog",
        "legacy-fallback",
        "legacy-unknown",
      ].includes(snap.provenance as string),
    );
    if (snap.plannedExercise !== null)
      validateExercise(record(snap.plannedExercise));
    if (es.status === "omitted")
      requireValid(!sets.some((s) => s.exerciseSessionId === es.id));
  }
  const tokens = new Set();
  const draftSetIds = new Set();
  const slotIds = new Set();
  for (const d of drafts) {
    requireValid(
      day(d.day) &&
        d.id === `day:${d.day}` &&
        text(d.token) &&
        !tokens.has(d.token),
    );
    tokens.add(d.token);
    requireValid(
      text(d.templateId) &&
        (templateIds.has(d.templateId) ||
          (d.templateId === "legacy" && d.sessionId !== null)),
    );
    const workout =
      d.sessionId === null ? null : workouts.find((w) => w.id === d.sessionId);
    requireValid(
      d.sessionId === null ||
        (workout &&
          workout.finishedAt === null &&
          workout.routineDay === d.day),
    );
    if (workout && "templateId" in workout)
      requireValid(workout.templateId === d.templateId);
    const slots = rows(d.exercises);
    for (const slot of slots) {
      requireValid(!slotIds.has(slot.id));
      slotIds.add(slot.id);
      const ex = record(slot.exercise);
      validateExercise(ex);
      if (slot.plannedExercise !== null)
        validateExercise(record(slot.plannedExercise));
      requireValid(
        ["template", "substitution", "additional"].includes(
          slot.origin as string,
        ),
      );
      requireValid(
        ["pending", "performed", "omitted"].includes(slot.status as string),
      );
      if (slot.origin === "additional")
        requireValid(slot.plannedExercise === null);
      else requireValid(slot.plannedExercise !== null);
      const entries = rows(slot.sets);
      const numbers = new Set();
      if (slot.status === "omitted") requireValid(entries.length === 0);
      for (const s of entries) {
        requireValid(
          s.exerciseSessionId === slot.id &&
            positive(s.setNumber) &&
            !numbers.has(s.setNumber) &&
            !draftSetIds.has(s.id),
        );
        numbers.add(s.setNumber);
        draftSetIds.add(s.id);
        requireValid(typeof s.isPr === "boolean");
        for (const field of ["weight", "reps", "rir"])
          requireValid(s[field] === null || number(s[field]));
        requireValid(s.reps === null || integer(s.reps));
        if (workout) {
          const live = sets.find((row) => row.id === s.id);
          requireValid(
            live && Object.keys(live).every((k) => live[k] === s[k]),
          );
        } else
          requireValid(
            !sets.some((row) => row.id === s.id) &&
              s.weight === null &&
              s.reps === null &&
              s.rir === null,
          );
      }
      if (workout) {
        const es = sessionMap.get(slot.id);
        requireValid(
          es && es.workoutSessionId === workout.id && es.exerciseId === ex.id,
        );
        const snap = snapshotMap.get(slot.id);
        requireValid(snap && sameData(snap.exercise, ex));
        if (es.origin !== undefined) requireValid(es.origin === slot.origin);
        if (es.status !== undefined) requireValid(es.status === slot.status);
        if (snap.plannedExercise !== null)
          requireValid(sameData(snap.plannedExercise, slot.plannedExercise));
        requireValid(
          sets.filter((s) => s.exerciseSessionId === slot.id).length ===
            entries.length,
        );
      } else requireValid(!sessionMap.has(slot.id));
    }
    if (workout)
      requireValid(
        sessions.filter((es) => es.workoutSessionId === workout.id).length ===
          slots.length,
      );
  }
}
