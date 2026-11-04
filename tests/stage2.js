import Dexie from "dexie";
import React from "react";
import { createRoot } from "react-dom/client";
import { db, GymDatabase } from "../src/lib/db";
import * as repo from "../src/lib/repo";
import * as workouts from "../src/lib/workouts";
import { CURRENT_TEMPLATE } from "../src/data/templates";
import {
  isValidSet,
  sumVolume,
  maxWeight,
  maxReps,
  bestE1rm,
} from "../src/lib/calculations";
import { validateBackup } from "../src/lib/backup";
import { waitForWrites } from "../src/lib/persistence";
import DayWorkout from "../src/components/DayWorkout";
import { RestTimerProvider } from "../src/components/RestTimer";
import legacy from "./fixtures/backup-v1.json";
const consent = { replaceExisting: true, unverifiedCopyAcknowledged: true };
const until = async (fn) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Stage 2 UI timed out");
};
const rowData = async (database = db) => ({
  exercises: await database.exercises.toArray(),
  workoutSessions: await database.workoutSessions.toArray(),
  exerciseSessions: await database.exerciseSessions.toArray(),
  sets: await database.sets.toArray(),
});
const oldDB = (name) => {
  const d = new Dexie(name);
  d.version(1).stores({
    exercises: "id, day, supersetGroup",
    workoutSessions: "id, date, routineDay, finishedAt, isoYear, isoWeek",
    exerciseSessions: "id, workoutSessionId, exerciseId",
    sets: "id, exerciseSessionId, setNumber",
  });
  return d;
};
async function seedLegacy(d) {
  await d.open();
  for (const table of [
    "exercises",
    "workoutSessions",
    "exerciseSessions",
    "sets",
  ])
    await d.table(table).bulkAdd(legacy[table]);
}
export async function runStage2Tests({ test, assert, equal, rejects }) {
  const isolated = (fn) => async () => {
    const original = await repo.exportBackup();
    try {
      await fn();
    } finally {
      await repo.importBackup(original, consent);
    }
  };
  await test("Workbook template: 7/7/7/6 movements, actual hyperlinks, RIR and groups preserved", async () => {
    equal(
      [1, 2, 3, 4].map(
        (day) => CURRENT_TEMPLATE.exercises.filter((e) => e.day === day).length,
      ),
      [7, 7, 7, 6],
    );
    const squat = CURRENT_TEMPLATE.exercises.find(
      (e) => e.name === "SENTADILLA + GEMELOS",
    );
    assert(squat.day === 2 && squat.id === "d1-1a");
    assert(CURRENT_TEMPLATE.exercises.filter((e) => !e.videoUrl).length === 4);
    equal(
      CURRENT_TEMPLATE.exercises
        .filter((e) => e.supersetGroup === "nov1-d2-4")
        .map((e) => e.supersetLabel),
      ["A", "B", "C"],
    );
    const first = CURRENT_TEMPLATE.exercises[0];
    assert(
      first.targetSets === 3 &&
        first.targetRirMin === 0 &&
        first.targetRirMax === 1,
    );
  });
  await test("Real v1->v2 upgrade freezes metadata and leaves every legacy row unchanged", async () => {
    const name = "synthetic-upgrade-" + crypto.randomUUID();
    const old = oldDB(name);
    await seedLegacy(old);
    const before = await rowData(old);
    old.close();
    const upgraded = new GymDatabase(name);
    try {
      await upgraded.open();
      equal(await rowData(upgraded), before);
      assert(upgraded.verno === 2);
      const snap = await upgraded.exerciseSnapshots.get("legacy-exercise");
      assert(
        snap.exercise.name === legacy.exercises[0].name &&
          snap.provenance === "legacy-catalog",
      );
      await upgraded.exercises.update("d1-1a", {
        name: "Changed after upgrade",
      });
      assert(
        (await upgraded.exerciseSnapshots.get("legacy-exercise")).exercise
          .name === legacy.exercises[0].name,
      );
    } finally {
      upgraded.close();
    }
  });
  await test("Failed v2 upgrade rolls back version, new stores and all legacy data, then retries", async () => {
    const name = "synthetic-abort-" + crypto.randomUUID();
    const old = oldDB(name);
    await seedLegacy(old);
    const before = await rowData(old);
    old.close();
    const failing = new GymDatabase(name);
    const fail = () => {
      throw Error("Injected snapshot storage failure");
    };
    failing.exerciseSnapshots.hook("creating", fail);
    await rejects(() => failing.open());
    failing.close();
    const check = oldDB(name);
    await check.open();
    equal(await rowData(check), before);
    assert(check.verno === 1 && check.tables.length === 4);
    check.close();
    const retry = new GymDatabase(name);
    await retry.open();
    assert((await retry.exerciseSnapshots.count()) === 1);
    equal(await rowData(retry), before);
    retry.close();
  });
  await test(
    "Opening all days, returning and editing blank structure never creates a workout",
    isolated(async () => {
      const before = await rowData();
      for (const day of [1, 2, 3, 4]) {
        const d = await workouts.openDay(day);
        const again = await workouts.openDay(day);
        assert(d.token === again.token && d.sessionId === null);
      }
      const d = await workouts.openDay(1);
      await workouts.changeDraft(d.id, d.token, {
        type: "addSet",
        slotId: d.exercises[0].id,
      });
      await workouts.changeDraft(d.id, d.token, {
        type: "add",
        exerciseId: CURRENT_TEMPLATE.exercises.at(-1).id,
      });
      equal(await rowData(), before);
      validateBackup(await repo.exportBackup());
    }),
  );
  await test(
    "First valid partial field including zero creates one session atomically under concurrency",
    isolated(async () => {
      const d = await workouts.openDay(1),
        slot = d.exercises[0],
        set = slot.sets[0];
      const before = await db.workoutSessions.count();
      await workouts.saveDraftSet(d.id, d.token, slot.id, set.id, {
        weight: null,
      });
      assert((await db.workoutSessions.count()) === before);
      await Promise.all([
        workouts.saveDraftSet(d.id, d.token, slot.id, set.id, { weight: 0 }),
        workouts.saveDraftSet(d.id, d.token, slot.id, set.id, { reps: 8 }),
        workouts.saveDraftSet(d.id, d.token, slot.id, set.id, { rir: 0 }),
      ]);
      assert((await db.workoutSessions.count()) === before + 1);
      const fresh = await workouts.openDay(1);
      assert(fresh.sessionId && fresh.token === d.token);
      const stored = await db.sets.get(set.id);
      assert(stored.weight === 0 && stored.reps === 8 && stored.rir === 0);
      const other = await workouts.openDay(2);
      await rejects(() =>
        workouts.saveDraftSet(
          other.id,
          other.token,
          other.exercises[0].id,
          other.exercises[0].sets[0].id,
          { weight: 5 },
        ),
      );
      assert((await db.workoutSessions.count()) === before + 1);
    }),
  );
  await test(
    "First write failure rolls back workout, snapshots, sets and draft mapping",
    isolated(async () => {
      const d = await workouts.openDay(1);
      const before = await repo.exportBackup();
      const fail = () => {
        throw Error("Quota failure");
      };
      db.sets.hook("creating", fail);
      try {
        await rejects(() =>
          workouts.saveDraftSet(
            d.id,
            d.token,
            d.exercises[0].id,
            d.exercises[0].sets[0].id,
            { reps: 8 },
          ),
        );
      } finally {
        db.sets.hook("creating").unsubscribe(fail);
      }
      const after = await repo.exportBackup();
      delete before.exportedAt;
      delete after.exportedAt;
      equal(after, before);
    }),
  );
  await test(
    "Omission creates no zero records; undo restores empty rows, recorded data cannot be omitted",
    isolated(async () => {
      const d = await workouts.openDay(1);
      const omitted = d.exercises[1];
      await workouts.changeDraft(d.id, d.token, {
        type: "omit",
        slotId: omitted.id,
      });
      const first = d.exercises[0];
      await workouts.saveDraftSet(d.id, d.token, first.id, first.sets[0].id, {
        weight: 12,
        reps: 8,
      });
      assert(
        (await db.sets
          .where("exerciseSessionId")
          .equals(omitted.id)
          .count()) === 0,
      );
      await rejects(() =>
        workouts.changeDraft(d.id, d.token, { type: "omit", slotId: first.id }),
      );
      await workouts.changeDraft(d.id, d.token, {
        type: "restore",
        slotId: omitted.id,
      });
      assert(
        (
          await db.sets.where("exerciseSessionId").equals(omitted.id).toArray()
        ).every((s) => s.weight === null && s.reps === null),
      );
      validateBackup(await repo.exportBackup());
    }),
  );
  await test(
    "Substitutions and additions keep original day, original snapshot and recorded sets",
    isolated(async () => {
      const d = await workouts.openDay(1),
        original = d.exercises[0],
        replacement = CURRENT_TEMPLATE.exercises.find((e) => e.day === 4);
      await workouts.changeDraft(d.id, d.token, {
        type: "substitute",
        slotId: original.id,
        exerciseId: replacement.id,
      });
      let fresh = await workouts.openDay(1);
      let first = fresh.exercises[0];
      assert(
        first.origin === "substitution" &&
          first.plannedExercise.id === original.exercise.id,
      );
      await workouts.saveDraftSet(d.id, d.token, first.id, first.sets[0].id, {
        weight: 30,
        reps: 10,
      });
      const stored = await db.sets.get(first.sets[0].id);
      const snap = await db.exerciseSnapshots.get(first.id);
      await workouts.changeDraft(d.id, d.token, {
        type: "substitute",
        slotId: first.id,
        exerciseId: CURRENT_TEMPLATE.exercises[2].id,
      });
      await workouts.changeDraft(d.id, d.token, {
        type: "add",
        exerciseId: replacement.id,
      });
      fresh = await workouts.openDay(1);
      assert(fresh.exercises.length === d.exercises.length + 2);
      equal(await db.sets.get(stored.id), stored);
      equal(await db.exerciseSnapshots.get(first.id), snap);
      assert((await db.workoutSessions.get(fresh.sessionId)).routineDay === 1);
      assert(fresh.exercises.at(-1).origin === "additional");
      validateBackup(await repo.exportBackup());
    }),
  );
  await test(
    "Changes to current catalog and template never rename captured history",
    isolated(async () => {
      const d = await workouts.openDay(2),
        slot = d.exercises[0];
      await workouts.saveDraftSet(d.id, d.token, slot.id, slot.sets[0].id, {
        weight: 40,
        reps: 6,
      });
      const fresh = await workouts.openDay(2);
      const full = await repo.getWorkoutSessionFull(fresh.sessionId);
      await db.exercises.update(slot.exercise.id, { name: "Renamed catalog" });
      const template = await db.templates.get(CURRENT_TEMPLATE.id);
      template.exercises[0].name = "Future template";
      await db.templates.put(template);
      equal(await repo.getWorkoutSessionFull(fresh.sessionId), full);
    }),
  );
  await test(
    "Finishing excludes pending/zero-rep/partial sets and stale draft writes cannot reopen it",
    isolated(async () => {
      const d = await workouts.openDay(3),
        a = d.exercises[0],
        b = d.exercises[1];
      await workouts.saveDraftSet(d.id, d.token, a.id, a.sets[0].id, {
        rir: 0,
      });
      await workouts.saveDraftSet(d.id, d.token, a.id, a.sets[1].id, {
        weight: 100,
        reps: 0,
      });
      await workouts.saveDraftSet(d.id, d.token, b.id, b.sets[0].id, {
        weight: 0,
        reps: 10,
      });
      const fresh = await workouts.openDay(3);
      const summary = await repo.finishSession(fresh.sessionId);
      assert(
        summary.setCount === 1 &&
          summary.exerciseCount === 1 &&
          summary.totalVolume === 0,
      );
      assert(!(await db.workoutDrafts.get(d.id)));
      await rejects(() =>
        workouts.saveDraftSet(d.id, d.token, a.id, a.sets[0].id, {
          weight: 20,
        }),
      );
      const next = await workouts.openDay(3);
      assert(next.token !== d.token && next.sessionId === null);
    }),
  );
  await test(
    "Repeated actual exercise aggregates once per workout with only valid sets",
    isolated(async () => {
      const d = await workouts.openDay(1),
        a = d.exercises[0];
      await workouts.saveDraftSet(d.id, d.token, a.id, a.sets[0].id, {
        weight: 10,
        reps: 10,
      });
      await workouts.changeDraft(d.id, d.token, {
        type: "add",
        exerciseId: a.exercise.id,
      });
      const fresh = await workouts.openDay(1),
        extra = fresh.exercises.at(-1);
      await workouts.saveDraftSet(d.id, d.token, extra.id, extra.sets[0].id, {
        weight: 20,
        reps: 5,
      });
      const summary = await repo.finishSession(fresh.sessionId);
      assert(
        summary.exerciseCount === 1 &&
          summary.totalVolume === 200 &&
          summary.setCount === 2,
      );
      const history = await repo.getExerciseHistory(a.exercise.id);
      const own = history.filter((h) => h.session.id === fresh.sessionId);
      assert(own.length === 1 && sumVolume(own[0].sets) === 200);
    }),
  );
  await test(
    "V2 backup round trip preserves draft substitutions/omissions; old form tokens cannot overwrite restoration",
    isolated(async () => {
      const d = await workouts.openDay(1);
      await workouts.changeDraft(d.id, d.token, {
        type: "omit",
        slotId: d.exercises[1].id,
      });
      await workouts.changeDraft(d.id, d.token, {
        type: "substitute",
        slotId: d.exercises[0].id,
        exerciseId: CURRENT_TEMPLATE.exercises.at(-1).id,
      });
      const fresh = await workouts.openDay(1);
      await workouts.saveDraftSet(
        d.id,
        d.token,
        fresh.exercises[0].id,
        fresh.exercises[0].sets[0].id,
        { weight: 42.5, reps: 8 },
      );
      await workouts.openDay(4);
      const before = await repo.exportBackup();
      equal(validateBackup(before), before);
      const reordered = structuredClone(before);
      for (const snap of reordered.exerciseSnapshots)
        snap.exercise = Object.fromEntries(
          Object.entries(snap.exercise).reverse(),
        );
      equal(validateBackup(reordered), reordered);
      await repo.importBackup(before, consent);
      const after = await repo.exportBackup();
      const normalize = (p) => ({
        ...p,
        exportedAt: "ignored",
        workoutDrafts: p.workoutDrafts.map((d) => ({ ...d, token: "rotated" })),
      });
      equal(normalize(after), normalize(before));
      await rejects(() =>
        workouts.saveDraftSet(
          d.id,
          d.token,
          fresh.exercises[0].id,
          fresh.exercises[0].sets[0].id,
          { weight: 99 },
        ),
      );
      assert(
        (await db.sets.get(fresh.exercises[0].sets[0].id)).weight === 42.5,
      );
    }),
  );
  await test(
    "V2 corrupt metadata and failed snapshot restoration leave all seven tables unchanged",
    isolated(async () => {
      const d = await workouts.openDay(1),
        a = d.exercises[0];
      await workouts.saveDraftSet(d.id, d.token, a.id, a.sets[0].id, {
        weight: 10,
      });
      const backup = await repo.exportBackup();
      const normalized = async () => {
        const p = await repo.exportBackup();
        delete p.exportedAt;
        return p;
      };
      const before = await normalized();
      for (const mutate of [
        (p) => (p.exerciseSnapshots[0].exercise.id = "wrong"),
        (p) => (p.workoutDrafts[0].token = ""),
        (p) => (p.workoutDrafts[0].exercises[0].sets[0].weight = 99),
        (p) => (p.workoutDrafts[0].templateId = "missing"),
        (p) => (p.version = 1),
      ]) {
        const p = structuredClone(backup);
        mutate(p);
        await rejects(() => repo.importBackup(p, consent));
        equal(await normalized(), before);
      }
      const fail = () => {
        throw Error("Injected metadata failure");
      };
      db.exerciseSnapshots.hook("creating", fail);
      try {
        await rejects(() => repo.importBackup(backup, consent));
      } finally {
        db.exerciseSnapshots.hook("creating").unsubscribe(fail);
      }
      equal(await normalized(), before);
    }),
  );
  await test("One validity rule excludes incomplete, nonfinite and zero reps while preserving zero load", async () => {
    const sets = [
      { weight: 100, reps: null },
      { weight: null, reps: 10 },
      { weight: 100, reps: 0 },
      { weight: Infinity, reps: 10 },
      { weight: 20, reps: 5 },
      { weight: 0, reps: 12 },
    ];
    assert(
      sets.filter(isValidSet).length === 2 &&
        sumVolume(sets) === 100 &&
        maxWeight(sets) === 20 &&
        maxReps(sets) === 12 &&
        bestE1rm(sets) > 20,
    );
  });
  await test(
    "Real day screen is a template until typing; omission, substitution, adding and reload preserve draft",
    isolated(async () => {
      const before = await db.workoutSessions.count();
      const container = document.createElement("div");
      document.body.append(container);
      let root = createRoot(container);
      let finished = null;
      const render = () =>
        root.render(
          React.createElement(
            RestTimerProvider,
            null,
            React.createElement(DayWorkout, { day: 1, onFinished: (id, summary) => { finished = {id,summary}; } }),
          ),
        );
      const button = (text) =>
        [...container.querySelectorAll("button")].find(
          (b) => b.textContent === text,
        );
      try {
        render();
        await until(() => container.querySelector("section input"));
        assert(
          container.textContent.includes("Plantilla") &&
            (await db.workoutSessions.count()) === before,
        );
        button("Omitir ejercicio").click();
        await until(() => container.textContent.includes("Omitido"));
        button("Sustituir ejercicio").click();
        await until(() => container.querySelector("select"));
        const select = container.querySelector("select");
        select.value = CURRENT_TEMPLATE.exercises.at(-1).id;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await until(() => !button("Confirmar ejercicio").disabled);
        button("Confirmar ejercicio").click();
        await until(() => container.textContent.includes("Sustitución de"));
        button("Agregar ejercicio").click();
        await until(() => container.querySelector("select"));
        const pick = container.querySelector("select");
        pick.value = CURRENT_TEMPLATE.exercises.at(-1).id;
        pick.dispatchEvent(new Event("change", { bubbles: true }));
        await until(() => !button("Confirmar ejercicio").disabled);
        button("Confirmar ejercicio").click();
        await until(() =>
          container.textContent.includes("Ejercicio adicional"),
        );
        assert((await db.workoutSessions.count()) === before);
        root.unmount();
        root = createRoot(container);
        render();
        await until(() => container.querySelector("section input"));
        assert(
          container.textContent.includes("Omitido") &&
            container.textContent.includes("Sustitución de") &&
            container.textContent.includes("Ejercicio adicional"),
        );
        const input = container.querySelector("section input");
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(input, "12,5");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await until(
          async () => (await db.workoutSessions.count()) === before + 1,
        );
        await waitForWrites();
        await until(() => container.textContent.includes("En curso"));
        const reps = container.querySelectorAll("section input")[1];
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(reps, "8");
        reps.dispatchEvent(new Event("input", {bubbles:true}));
        button("FINALIZAR ENTRENAMIENTO").click();
        await until(() => button("Sí, finalizar entrenamiento"));
        assert(finished === null);
        button("Sí, finalizar entrenamiento").click();
        await until(() => finished !== null);
        assert(finished.summary.setCount === 1 && finished.summary.totalVolume === 100);
        assert((await db.workoutSessions.get(finished.id)).routineDay === 1);
        validateBackup(await repo.exportBackup());
      } finally {
        root.unmount();
        container.remove();
      }
    }),
  );
  await test(
    "Two browser contexts open one draft and create one session with both first edits intact",
    isolated(async () => {
      const frame = document.createElement("iframe");
      frame.src = "/?peer=1";
      document.body.append(frame);
      await new Promise((r) => (frame.onload = r));
      try {
        const before = await db.workoutSessions.count();
        const [d, peer] = await Promise.all([
          workouts.openDay(1),
          frame.contentWindow.workouts.openDay(1),
        ]);
        assert(
          d.token === peer.token &&
            d.exercises[0].sets[0].id === peer.exercises[0].sets[0].id,
        );
        const slot = d.exercises[0],
          set = slot.sets[0];
        await Promise.all([
          workouts.saveDraftSet(d.id, d.token, slot.id, set.id, { weight: 21 }),
          frame.contentWindow.workouts.saveDraftSet(
            d.id,
            d.token,
            slot.id,
            set.id,
            { reps: 9 },
          ),
        ]);
        assert((await db.workoutSessions.count()) === before + 1);
        const stored = await db.sets.get(set.id);
        assert(stored.weight === 21 && stored.reps === 9);
      } finally {
        frame.remove();
      }
    }),
  );
  await test(
    "An active legacy workout resumes its old exercises without changing any historical row",
    isolated(async () => {
      const input = structuredClone(legacy);
      input.workoutSessions[0].finishedAt = null;
      input.workoutSessions[0].duration = null;
      await repo.importBackup(input, consent);
      const before = await rowData();
      const d = await workouts.openDay(1);
      assert(
        d.sessionId === "legacy-workout" &&
          d.exercises.length === 1 &&
          d.exercises[0].exercise.name === legacy.exercises[0].name,
      );
      equal(await rowData(), before);
      validateBackup(await repo.exportBackup());
    }),
  );
  await test(
    "Concurrent draft set additions keep unique numbering and invalid input creates no workout",
    isolated(async () => {
      const d = await workouts.openDay(4),
        slot = d.exercises[0];
      const before = await db.workoutSessions.count();
      await rejects(() =>
        workouts.saveDraftSet(d.id, d.token, slot.id, slot.sets[0].id, {
          weight: NaN,
        }),
      );
      await rejects(() =>
        workouts.saveDraftSet(d.id, d.token, slot.id, slot.sets[0].id, {
          reps: -1,
        }),
      );
      await Promise.all(
        Array.from({ length: 10 }, () =>
          workouts.changeDraft(d.id, d.token, {
            type: "addSet",
            slotId: slot.id,
          }),
        ),
      );
      const fresh = await workouts.openDay(4);
      equal(
        fresh.exercises[0].sets.map((s) => s.setNumber),
        Array.from({ length: 13 }, (_, i) => i + 1),
      );
      assert((await db.workoutSessions.count()) === before);
    }),
  );
}
