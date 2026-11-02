import { v4 as uuid } from "uuid";
import { CURRENT_TEMPLATE } from "@/data/templates";
import { db } from "./db";
import { isoWeekInfo, nowIso, todayDateString } from "./dates";
import {
  DraftExercise,
  Exercise,
  RoutineDay,
  SetEntry,
  WorkoutDraft,
  WorkoutSession,
} from "./types";

const tables = [
  db.templates,
  db.workoutDrafts,
  db.workoutSessions,
  db.exerciseSessions,
  db.exerciseSnapshots,
  db.sets,
  db.exercises,
];
const blankSet = (id: string, n: number): SetEntry => ({
  id: uuid(),
  exerciseSessionId: id,
  setNumber: n,
  weight: null,
  reps: null,
  rir: null,
  isPr: false,
});
const hasData = (slot: DraftExercise) =>
  slot.sets.some((s) => s.weight !== null || s.reps !== null || s.rir !== null);
function slotFor(
  exercise: Exercise,
  origin: DraftExercise["origin"] = "template",
): DraftExercise {
  const id = uuid();
  return {
    id,
    exercise: structuredClone(exercise),
    plannedExercise: origin === "template" ? structuredClone(exercise) : null,
    origin,
    status: "pending",
    sets: Array.from({ length: exercise.targetSets }, (_, i) =>
      blankSet(id, i + 1),
    ),
  };
}

export async function getExerciseCatalog(): Promise<Exercise[]> {
  const catalog = new Map(
    CURRENT_TEMPLATE.exercises.map((ex) => [ex.id, structuredClone(ex)]),
  );
  for (const ex of await db.exercises.toArray())
    if (!catalog.has(ex.id)) catalog.set(ex.id, ex);
  return [...catalog.values()];
}

export async function hydrateDraft(draft: WorkoutDraft): Promise<WorkoutDraft> {
  if (!draft.sessionId) return draft;
  const session = await db.workoutSessions.get(draft.sessionId);
  if (!session || session.finishedAt !== null)
    throw new Error("Este entrenamiento ya terminó. Volvé a abrir el día.");
  for (const slot of draft.exercises) {
    slot.sets = await db.sets
      .where("exerciseSessionId")
      .equals(slot.id)
      .sortBy("setNumber");
  }
  return draft;
}

/** Opening writes only a nonhistorical draft; never a workout session. */
export async function openDay(day: RoutineDay): Promise<WorkoutDraft> {
  if (![1, 2, 3, 4].includes(day)) throw new Error("Día inválido");
  return db.transaction("rw", tables, async () => {
    let draft = await db.workoutDrafts.get(`day:${day}`);
    if (draft?.sessionId) {
      const session = await db.workoutSessions.get(draft.sessionId);
      if (!session || session.finishedAt !== null) draft = undefined;
    }
    if (draft) return hydrateDraft(draft);
    const active = await db.workoutSessions
      .filter((s) => s.finishedAt === null && s.routineDay === day)
      .first();
    if (active) {
      const slots: DraftExercise[] = [];
      const rows = await db.exerciseSessions
        .where("workoutSessionId")
        .equals(active.id)
        .sortBy("order");
      for (const row of rows) {
        const snapshot = await db.exerciseSnapshots.get(row.id);
        const exercise =
          snapshot?.exercise ?? (await db.exercises.get(row.exerciseId));
        if (!exercise)
          throw new Error(
            "Faltan metadatos del ejercicio histórico. No se modificó el entrenamiento.",
          );
        slots.push({
          id: row.id,
          exercise,
          plannedExercise: snapshot?.plannedExercise ?? exercise,
          origin: row.origin ?? "template",
          status: row.status ?? "pending",
          sets: await db.sets
            .where("exerciseSessionId")
            .equals(row.id)
            .sortBy("setNumber"),
        });
      }
      draft = {
        id: `day:${day}`,
        token: uuid(),
        day,
        templateId: active.templateId ?? "legacy",
        sessionId: active.id,
        exercises: slots,
      };
    } else {
      let template = await db.templates.get(CURRENT_TEMPLATE.id);
      if (!template) {
        template = structuredClone(CURRENT_TEMPLATE);
        await db.templates.add(template);
      }
      draft = {
        id: `day:${day}`,
        token: uuid(),
        day,
        templateId: template.id,
        sessionId: null,
        exercises: template.exercises
          .filter((ex) => ex.day === day)
          .map((ex) => slotFor(ex)),
      };
    }
    await db.workoutDrafts.put(draft);
    return draft;
  });
}

async function load(id: string, token: string): Promise<WorkoutDraft> {
  const draft = await db.workoutDrafts.get(id);
  if (!draft || draft.token !== token)
    throw new Error(
      "El borrador cambió en otra ventana. Volvé a abrir el día.",
    );
  return hydrateDraft(draft);
}

async function persistDraft(draft: WorkoutDraft): Promise<void> {
  if (draft.sessionId) {
    for (const [index, slot] of draft.exercises.entries()) {
      if (!(await db.exercises.get(slot.exercise.id)))
        await db.exercises.add(slot.exercise);
      await db.exerciseSessions.put({
        id: slot.id,
        workoutSessionId: draft.sessionId,
        exerciseId: slot.exercise.id,
        order: index + 1,
        note: (await db.exerciseSessions.get(slot.id))?.note ?? null,
        origin: slot.origin,
        status: slot.status,
      });
      // Never replace a legacy snapshot while adopting an existing active workout.
      const existing = await db.exerciseSnapshots.get(slot.id);
      if (!existing || existing.exercise.id !== slot.exercise.id) {
        await db.exerciseSnapshots.put({
          id: slot.id,
          exercise: slot.exercise,
          plannedExercise: slot.plannedExercise,
          provenance: "captured",
        });
      }
      if (slot.status === "omitted")
        await db.sets.where("exerciseSessionId").equals(slot.id).delete();
      else await db.sets.bulkPut(slot.sets);
    }
  }
  await db.workoutDrafts.put(draft);
}

export async function saveDraftSet(
  id: string,
  token: string,
  slotId: string,
  setId: string,
  patch: Partial<Pick<SetEntry, "weight" | "reps" | "rir">>,
): Promise<void> {
  for (const [field, value] of Object.entries(patch)) {
    if (
      !["weight", "reps", "rir"].includes(field) ||
      (value !== null &&
        (typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          (field === "reps" && !Number.isInteger(value))))
    )
      throw new Error("Valor inválido");
  }
  await db.transaction("rw", tables, async () => {
    const draft = await load(id, token);
    const slot = draft.exercises.find((ex) => ex.id === slotId);
    const set = slot?.sets.find((s) => s.id === setId);
    if (!slot || !set || slot.status === "omitted")
      throw new Error("La serie ya no está disponible");
    Object.assign(set, patch);
    if (!draft.sessionId && Object.values(patch).some((v) => v !== null)) {
      const active = await db.workoutSessions
        .filter((s) => s.finishedAt === null)
        .first();
      if (active)
        throw new Error(
          `Hay un entrenamiento activo del Día ${active.routineDay}. Continuá o finalizá ese entrenamiento.`,
        );
      const date = todayDateString();
      const session: WorkoutSession = {
        id: uuid(),
        routineDay: draft.day,
        templateId: draft.templateId,
        date,
        ...isoWeekInfo(date),
        startedAt: nowIso(),
        finishedAt: null,
        duration: null,
        note: null,
      };
      draft.sessionId = session.id;
      await db.workoutSessions.add(session);
    }
    slot.status = hasData(slot) ? "performed" : "pending";
    await persistDraft(draft);
  });
}

type Change =
  | { type: "add"; exerciseId: string }
  | { type: "substitute"; slotId: string; exerciseId: string }
  | { type: "omit" | "restore" | "addSet"; slotId: string }
  | { type: "removeSet"; slotId: string; setId: string };
export async function changeDraft(
  id: string,
  token: string,
  change: Change,
): Promise<void> {
  await db.transaction("rw", tables, async () => {
    const draft = await load(id, token);
    const slot =
      "slotId" in change
        ? draft.exercises.find((ex) => ex.id === change.slotId)
        : undefined;
    if ("slotId" in change && !slot) throw new Error("Ejercicio no disponible");
    if (change.type === "add" || change.type === "substitute") {
      const replacement = (await getExerciseCatalog()).find(
        (ex) => ex.id === change.exerciseId,
      );
      if (!replacement) throw new Error("Ejercicio no encontrado");
      if (change.type === "add") {
        draft.exercises.push(
          slotFor(
            { ...replacement, supersetGroup: null, supersetLabel: null },
            "additional",
          ),
        );
      } else if (slot) {
        if (slot.status === "omitted")
          throw new Error("Reactivá el ejercicio antes de sustituirlo");
        if (slot.exercise.id === replacement.id)
          throw new Error("Elegí un ejercicio distinto");
        const next = slotFor(
          {
            ...replacement,
            supersetGroup: slot.exercise.supersetGroup,
            supersetLabel: slot.exercise.supersetLabel,
          },
          "substitution",
        );
        next.plannedExercise = slot.plannedExercise ?? slot.exercise;
        const index = draft.exercises.indexOf(slot);
        if (hasData(slot))
          draft.exercises.splice(index + 1, 0, next); // Keep all recorded data.
        else {
          next.id = slot.id;
          next.sets = next.sets.map((s) => ({
            ...s,
            exerciseSessionId: slot.id,
          }));
          if (draft.sessionId)
            await db.sets.where("exerciseSessionId").equals(slot.id).delete();
          draft.exercises.splice(index, 1, next);
        }
      }
    } else if (slot) {
      if (change.type === "omit") {
        if (hasData(slot))
          throw new Error(
            "Este ejercicio tiene datos registrados. Se conservan; solo se pueden omitir ejercicios sin datos.",
          );
        slot.status = "omitted";
        slot.sets = [];
      } else if (change.type === "restore") {
        if (slot.status !== "omitted")
          throw new Error("El ejercicio ya está activo");
        slot.status = "pending";
        slot.sets = Array.from({ length: slot.exercise.targetSets }, (_, i) =>
          blankSet(slot.id, i + 1),
        );
      } else if (change.type === "addSet") {
        if (slot.status === "omitted") throw new Error("Ejercicio omitido");
        slot.sets.push(
          blankSet(
            slot.id,
            Math.max(0, ...slot.sets.map((s) => s.setNumber)) + 1,
          ),
        );
      } else if (change.type === "removeSet") {
        if (!slot.sets.some((s) => s.id === change.setId))
          throw new Error("Serie no encontrada");
        slot.sets = slot.sets.filter((s) => s.id !== change.setId);
        if (draft.sessionId) await db.sets.delete(change.setId);
        slot.status = hasData(slot) ? "performed" : "pending";
      }
    }
    await persistDraft(draft);
  });
}
