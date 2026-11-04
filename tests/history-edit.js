import React from "react";
import { createRoot } from "react-dom/client";
import { db } from "../src/lib/db";
import * as repo from "../src/lib/repo";
import {
  readWorkoutEdit,
  saveWorkoutEdit,
  additionalHistoryExercise,
} from "../src/lib/history-edit";
import { completedDaysThisWeek } from "../src/lib/completion";
import { todayDateString, isoWeekInfo } from "../src/lib/dates";
import { CURRENT_TEMPLATE } from "../src/data/templates";
import { readExerciseTrainings } from "../src/lib/insights";
import { validateBackup } from "../src/lib/backup";
import { openDay, saveDraftSet } from "../src/lib/workouts";
import WorkoutHistory from "../src/components/WorkoutHistory";
import DayWorkout from "../src/components/DayWorkout";
import { RestTimerProvider } from "../src/components/RestTimer";
import Home from "../src/app/page";
import legacy from "./fixtures/backup-v1.json";
const consent = { replaceExisting: true, unverifiedCopyAcknowledged: true };
const until = async (fn, label = "history UI") => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timeout " + label);
};
const snapshot = async () => {
  const p = await repo.exportBackup();
  delete p.exportedAt;
  return p;
};
const input = (el, value) => {
  Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    "value",
  ).set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (box, label) =>
  [...box.querySelectorAll("button")].find((b) => b.textContent === label);
async function mount(component, fn) {
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    root.render(component);
    await fn(box);
  } finally {
    root.unmount();
    box.remove();
  }
}
export async function runHistoryEditTests({ test, assert, equal, rejects }) {
  const isolated = (fn) => async () => {
    const p = await repo.exportBackup();
    try {
      await repo.importBackup(legacy, consent);
      await fn();
    } finally {
      await repo.importBackup(p, consent);
    }
  };
  await test(
    "Finished history opens read-only: no editable inputs, no save-on-blur and no writes",
    isolated(async () => {
      const before = await snapshot();
      await mount(
        React.createElement(WorkoutHistory, {
          id: "legacy-workout",
          onDeleted: () => {},
        }),
        async (box) => {
          await until(() => button(box, "Editar entrenamiento"));
          assert(button(box, "Eliminar entrenamiento"));
          equal(box.querySelectorAll("input,textarea,select").length, 0);
          assert(!button(box, "Sustituir ejercicio"));
          equal(await snapshot(), before);
        },
      );
    }),
  );
  await test(
    "Explicit history editing is staged; Cancel discards values, notes and structural changes",
    isolated(async () => {
      const before = await snapshot();
      await mount(
        React.createElement(WorkoutHistory, {
          id: "legacy-workout",
          onDeleted: () => {},
        }),
        async (box) => {
          await until(() => button(box, "Editar entrenamiento"));
          button(box, "Editar entrenamiento").click();
          await until(() => box.querySelector("input"));
          input(box.querySelector("input"), "45");
          input(
            box.querySelector('[aria-label="Nota de la sesión"]'),
            "draft note",
          );
          button(box, "Agregar serie").click();
          await until(() => box.querySelectorAll("input").length === 9);
          equal(await snapshot(), before);
          button(box, "Cancelar edición").click();
          await until(() => button(box, "Editar entrenamiento"));
          equal(box.querySelectorAll("input,textarea").length, 0);
          equal(await snapshot(), before);
        },
      );
    }),
  );
  await test(
    "Explicit Save retains workout/set IDs, date/day/timestamps, zeros and all unrelated records",
    isolated(async () => {
      const original = await readWorkoutEdit("legacy-workout"),
        before = await snapshot();
      const edit = structuredClone(original);
      edit.session.note = "Intentional edited note";
      edit.session.exerciseSessions[0].note = "Exercise note";
      Object.assign(edit.session.exerciseSessions[0].sets[0], {
        weight: 0,
        reps: 12,
        rir: 0,
      });
      await saveWorkoutEdit(original, edit);
      const saved = await readWorkoutEdit("legacy-workout");
      equal(saved, edit);
      equal(saved.session.finishedAt, original.session.finishedAt);
      equal(saved.session.routineDay, 1);
      equal(saved.session.date, original.session.date);
      equal(
        saved.session.exerciseSessions[0].sets[1],
        original.session.exerciseSessions[0].sets[1],
      );
      const after = await snapshot();
      equal(after.templates, before.templates);
      equal(after.workoutDrafts, before.workoutDrafts);
      validateBackup(await repo.exportBackup());
    }),
  );
  await test(
    "History omission, substitution and additions save atomically with valid snapshots and original day",
    isolated(async () => {
      const original = await readWorkoutEdit("legacy-workout"),
        edit = structuredClone(original);
      const old = edit.session.exerciseSessions[0];
      old.status = "omitted";
      old.sets = [];
      const replacement = additionalHistoryExercise(
        CURRENT_TEMPLATE.exercises[0],
        edit.session.id,
        2,
      );
      replacement.row.origin = "substitution";
      replacement.snapshot.plannedExercise = structuredClone(old.exercise);
      Object.assign(replacement.row.sets[0], { weight: 12.5, reps: 8, rir: 2 });
      const additional = additionalHistoryExercise(
        CURRENT_TEMPLATE.exercises.at(-1),
        edit.session.id,
        3,
      );
      edit.session.exerciseSessions.push(replacement.row, additional.row);
      edit.snapshots.push(replacement.snapshot, additional.snapshot);
      await saveWorkoutEdit(original, edit);
      equal((await readWorkoutEdit("legacy-workout")).session.routineDay, 1);
      equal(await db.sets.where("exerciseSessionId").equals(old.id).count(), 0);
      equal(await readExerciseTrainings(old.exerciseId), []);
      const h = await readExerciseTrainings(replacement.row.exerciseId);
      equal(h[0].session.id, original.session.id);
      equal(h[0].session.routineDay, 1);
      validateBackup(await repo.exportBackup());
    }),
  );
  await test(
    "Omitting recorded history requires confirmation; original series survive until Save",
    isolated(async () => {
      const before = await snapshot();
      await mount(
        React.createElement(WorkoutHistory, {
          id: "legacy-workout",
          onDeleted: () => {},
        }),
        async (box) => {
          await until(() => button(box, "Editar entrenamiento"));
          button(box, "Editar entrenamiento").click();
          await until(() => button(box, "Omitir ejercicio"));
          button(box, "Omitir ejercicio").click();
          await until(() => button(box, "Sí, omitir ejercicio"));
          equal(await snapshot(), before);
          button(box, "Conservar ejercicio").click();
          await until(() => !box.querySelector("[role=dialog]"));
          button(box, "Omitir ejercicio").click();
          await until(() => button(box, "Sí, omitir ejercicio"));
          button(box, "Sí, omitir ejercicio").click();
          await until(() => button(box, "Reactivar ejercicio"));
          equal(await snapshot(), before);
          button(box, "Guardar cambios").click();
          await until(() => button(box, "Editar entrenamiento"));
          equal(await db.sets.count(), 0);
          equal(
            (await db.exerciseSessions.get("legacy-exercise")).status,
            "omitted",
          );
          validateBackup(await repo.exportBackup());
        },
      );
    }),
  );
  await test(
    "History UI substitutes recorded exercises without relabeling their old sets and supports additions",
    isolated(async () => {
      await mount(
        React.createElement(WorkoutHistory, {
          id: "legacy-workout",
          onDeleted: () => {},
        }),
        async (box) => {
          await until(() => button(box, "Editar entrenamiento"));
          button(box, "Editar entrenamiento").click();
          await until(() => button(box, "Sustituir ejercicio"));
          button(box, "Sustituir ejercicio").click();
          await until(() => box.querySelector("select"));
          const select = box.querySelector("select");
          select.value = CURRENT_TEMPLATE.exercises[0].id;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await until(() => !button(box, "Confirmar ejercicio").disabled);
          button(box, "Confirmar ejercicio").click();
          await until(
            () => box.querySelectorAll("section[aria-label]").length === 2,
          );
          button(box, "Agregar ejercicio").click();
          await until(() => box.querySelector("select"));
          const pick = box.querySelector("select");
          pick.value = CURRENT_TEMPLATE.exercises.at(-1).id;
          pick.dispatchEvent(new Event("change", { bubbles: true }));
          await until(() => !button(box, "Confirmar ejercicio").disabled);
          button(box, "Confirmar ejercicio").click();
          await until(
            () => box.querySelectorAll("section[aria-label]").length === 3,
          );
          button(box, "Guardar cambios").click();
          await until(() => button(box, "Editar entrenamiento"));
          equal(
            (await db.sets.get("legacy-set")).exerciseSessionId,
            "legacy-exercise",
          );
          equal(
            (await db.exerciseSessions.get("legacy-exercise")).exerciseId,
            "d1-1a",
          );
          equal((await db.exerciseSessions.toArray()).length, 3);
          validateBackup(await repo.exportBackup());
        },
      );
    }),
  );
  await test(
    "Invalid history edits stay visible without saving; retry commits the corrected values",
    isolated(async () => {
      const before = await snapshot();
      await mount(
        React.createElement(WorkoutHistory, {
          id: "legacy-workout",
          onDeleted: () => {},
        }),
        async (box) => {
          await until(() => button(box, "Editar entrenamiento"));
          button(box, "Editar entrenamiento").click();
          await until(() => box.querySelector("input"));
          const fields = box.querySelectorAll("input");
          input(fields[1], "1.5");
          button(box, "Guardar cambios").click();
          await until(() => box.querySelector("[role=alert]"));
          equal(await snapshot(), before);
          assert(button(box, "Guardar cambios"));
          input(fields[0], "12,5");
          input(fields[1], "8");
          button(box, "Guardar cambios").click();
          await until(() => button(box, "Editar entrenamiento"));
          const s = await db.sets.get("legacy-set");
          equal([s.weight, s.reps], [12.5, 8]);
        },
      );
    }),
  );
  await test(
    "Failure while writing a history edit rolls back omissions, new rows, snapshots and notes",
    isolated(async () => {
      const original = await readWorkoutEdit("legacy-workout"),
        before = await snapshot(),
        edit = structuredClone(original);
      edit.session.note = "must rollback";
      edit.session.exerciseSessions[0].status = "omitted";
      edit.session.exerciseSessions[0].sets = [];
      const added = additionalHistoryExercise(
        CURRENT_TEMPLATE.exercises[0],
        edit.session.id,
        2,
      );
      edit.session.exerciseSessions.push(added.row);
      edit.snapshots.push(added.snapshot);
      const fail = () => {
        throw Error("Synthetic snapshot write failure");
      };
      db.exerciseSnapshots.hook("creating", fail);
      try {
        await rejects(() => saveWorkoutEdit(original, edit));
      } finally {
        db.exerciseSnapshots.hook("creating").unsubscribe(fail);
      }
      equal(await snapshot(), before);
      await saveWorkoutEdit(original, edit);
      validateBackup(await repo.exportBackup());
    }),
  );
  await test(
    "A stale historical editor cannot overwrite another edit, deletion or identity/timestamp changes",
    isolated(async () => {
      const original = await readWorkoutEdit("legacy-workout"),
        first = structuredClone(original),
        second = structuredClone(original);
      first.session.note = "newer saved";
      second.session.note = "stale";
      await saveWorkoutEdit(original, first);
      await rejects(() => saveWorkoutEdit(original, second));
      equal(
        (await db.workoutSessions.get("legacy-workout")).note,
        "newer saved",
      );
      const current = await readWorkoutEdit("legacy-workout");
      for (const field of ["routineDay", "date", "finishedAt"]) {
        const bad = structuredClone(current);
        bad.session[field] =
          field === "routineDay" ? 4 : field === "date" ? "2026-11-01" : null;
        await rejects(() => saveWorkoutEdit(current, bad));
      }
      await repo.deleteSession("legacy-workout");
      await rejects(() => saveWorkoutEdit(current, current));
      equal(await db.workoutSessions.count(), 0);
    }),
  );
  await test(
    "Failed history UI Save keeps unsaved values and allows retry or cancellation",
    isolated(async () => {
      const before = await snapshot();
      await mount(
        React.createElement(WorkoutHistory, {
          id: "legacy-workout",
          onDeleted: () => {},
        }),
        async (box) => {
          await until(() => button(box, "Editar entrenamiento"));
          button(box, "Editar entrenamiento").click();
          await until(() => box.querySelector("input"));
          input(box.querySelector("input"), "55");
          const fail = () => {
            throw Error("Synthetic storage full");
          };
          db.sets.hook("updating", fail);
          try {
            button(box, "Guardar cambios").click();
            await until(() => box.querySelector("[role=alert]"));
          } finally {
            db.sets.hook("updating").unsubscribe(fail);
          }
          equal(await snapshot(), before);
          equal(box.querySelector("input").value, "55");
          button(box, "Guardar cambios").click();
          await until(() => button(box, "Editar entrenamiento"));
          equal((await db.sets.get("legacy-set")).weight, 55);
        },
      );
    }),
  );
  await test(
    "Finishing requires a separate confirmation; cancel and rapid repeated confirmation do not double-finish",
    isolated(async () => {
      const draft = await openDay(1),
        slot = draft.exercises[0];
      await saveDraftSet(draft.id, draft.token, slot.id, slot.sets[0].id, {
        weight: 0,
        reps: 8,
      });
      let finished = 0;
      const id = (await openDay(1)).sessionId;
      await mount(
        React.createElement(
          RestTimerProvider,
          null,
          React.createElement(DayWorkout, {
            day: 1,
            onFinished: () => {
              finished++;
            },
          }),
        ),
        async (box) => {
          await until(() => button(box, "FINALIZAR ENTRENAMIENTO"));
          equal((await db.workoutSessions.get(id)).finishedAt, null);
          button(box, "FINALIZAR ENTRENAMIENTO").click();
          await until(() => button(box, "Seguir entrenando"));
          equal((await db.workoutSessions.get(id)).finishedAt, null);
          button(box, "Seguir entrenando").click();
          await until(() => !box.querySelector("[role=dialog]"));
          equal(finished, 0);
          equal((await db.workoutSessions.get(id)).finishedAt, null);
          button(box, "FINALIZAR ENTRENAMIENTO").click();
          await until(() => button(box, "Sí, finalizar entrenamiento"));
          const yes = button(box, "Sí, finalizar entrenamiento");
          yes.click();
          yes.click();
          await until(() => finished === 1);
          assert((await db.workoutSessions.get(id)).finishedAt !== null);
          equal(finished, 1);
        },
      );
    }),
  );
  await test(
    "Failed finishing keeps the workout active and reports the error inside the confirmation until retry",
    isolated(async () => {
      const d = await openDay(1);
      await saveDraftSet(
        d.id,
        d.token,
        d.exercises[0].id,
        d.exercises[0].sets[0].id,
        { weight: 0, reps: 8 },
      );
      const id = (await openDay(1)).sessionId;
      let finished = 0;
      await mount(
        React.createElement(
          RestTimerProvider,
          null,
          React.createElement(DayWorkout, {
            day: 1,
            onFinished: () => finished++,
          }),
        ),
        async (box) => {
          await until(() => button(box, "FINALIZAR ENTRENAMIENTO"));
          button(box, "FINALIZAR ENTRENAMIENTO").click();
          await until(() => button(box, "Sí, finalizar entrenamiento"));
          const fail = () => {
            throw Error("Synthetic finish storage error");
          };
          db.workoutSessions.hook("updating", fail);
          try {
            button(box, "Sí, finalizar entrenamiento").click();
            await until(() => box.querySelector("[role=dialog] [role=alert]"));
          } finally {
            db.workoutSessions.hook("updating").unsubscribe(fail);
          }
          equal((await db.workoutSessions.get(id)).finishedAt, null);
          equal(finished, 0);
          button(box, "Sí, finalizar entrenamiento").click();
          await until(() => finished === 1);
        },
      );
    }),
  );
  await test(
    "History editor cannot reopen or edit an active workout through the completed-workout save path",
    isolated(async () => {
      const d = await openDay(1);
      await saveDraftSet(
        d.id,
        d.token,
        d.exercises[0].id,
        d.exercises[0].sets[0].id,
        { weight: 10 },
      );
      const id = (await openDay(1)).sessionId,
        original = await readWorkoutEdit(id),
        before = await snapshot();
      await rejects(() => saveWorkoutEdit(original, original));
      equal(await snapshot(), before);
    }),
  );
  await test("Weekly completion uses Monday-Sunday, original day, finished-only, ISO-year boundaries and no future dates", () => {
    const s = (date, day, finished = true) => ({
      ...legacy.workoutSessions[0],
      date,
      routineDay: day,
      finishedAt: finished ? "2027-01-01T18:00:00Z" : null,
    });
    equal(
      [
        ...completedDaysThisWeek(
          [
            s("2026-12-28", 1),
            s("2027-01-01", 4),
            s("2026-12-27", 2),
            s("2027-01-02", 3),
            s("2027-01-01", 2, false),
          ],
          "2027-01-01",
        ),
      ],
      [1, 4],
    );
    equal([...completedDaysThisWeek([s("2027-01-03", 1)], "2027-01-04")], []);
    equal(
      [
        ...completedDaysThisWeek(
          [s("2027-01-03", 1), s("2027-01-03", 1)],
          "2027-01-03",
        ),
      ],
      [1],
    );
  });
  await test(
    "Home highlights completed original days reactively and removes the mark only after the last matching workout is deleted",
    isolated(async () => {
      const today = todayDateString();
      const row = {
        ...legacy.workoutSessions[0],
        date: today,
        ...isoWeekInfo(today),
        routineDay: 2,
      };
      await mount(React.createElement(Home), async (box) => {
        await until(() => box.querySelector('[aria-label="Día 2"]'));
        await db.workoutSessions.bulkAdd([
          { ...row, id: "weekly-a" },
          { ...row, id: "weekly-b" },
        ]);
        await until(() =>
          box.querySelector('[aria-label="Día 2, completado esta semana"]'),
        );
        assert(box.querySelector(".day-card-completed"));
        await db.workoutSessions.delete("weekly-a");
        await new Promise((r) => setTimeout(r, 30));
        assert(
          box.querySelector('[aria-label="Día 2, completado esta semana"]'),
        );
        await db.workoutSessions.delete("weekly-b");
        await until(() => box.querySelector('[aria-label="Día 2"]'));
        assert(
          !box
            .querySelector('[aria-label="Día 2"]')
            .classList.contains("day-card-completed"),
        );
      });
    }),
  );
}
