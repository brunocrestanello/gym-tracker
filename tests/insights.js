import React from "react";
import { createRoot } from "react-dom/client";
import { db } from "../src/lib/db";
import * as repo from "../src/lib/repo";
import {
  readExerciseTrainings,
  exerciseInsights,
  summarizeSets,
} from "../src/lib/insights";
import ExerciseInsights from "../src/components/ExerciseInsights";
import ExerciseReference from "../src/components/ExerciseReference";
import ThemeToggle from "../src/components/ThemeToggle";
import legacy from "./fixtures/backup-v1.json";
import { isoWeekInfo } from "../src/lib/dates";
const consent = { replaceExisting: true, unverifiedCopyAcknowledged: true };
const until = async (fn) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Insights UI timed out");
};
const fixture = () => {
  const p = structuredClone(legacy);
  p.sets = [];
  p.workoutSessions = [];
  p.exerciseSessions = [];
  const add = (
    id,
    date,
    day,
    sets,
    { active = false, omitted = false } = {},
  ) => {
    p.workoutSessions.push({
      ...legacy.workoutSessions[0],
      id,
      date,
      ...isoWeekInfo(date),
      routineDay: day,
      startedAt: `${date}T17:00:00.000Z`,
      finishedAt: active ? null : `${date}T18:00:00.000Z`,
      duration: active ? null : 3600,
    });
    p.exerciseSessions.push({
      ...legacy.exerciseSessions[0],
      id: `es-${id}`,
      workoutSessionId: id,
      ...(omitted ? { status: "omitted" } : {}),
    });
    sets.forEach((s, i) =>
      p.sets.push({
        id: `${id}-${i}`,
        exerciseSessionId: `es-${id}`,
        setNumber: i + 1,
        weight: null,
        reps: null,
        rir: null,
        isPr: true,
        ...s,
      }),
    );
  };
  add("old", "2026-09-01", 1, [
    { weight: 40, reps: 8, rir: 2 },
    { weight: null, reps: 4 },
  ]);
  add("new", "2026-10-01", 4, [
    { weight: 45, reps: 6, rir: 1 },
    { weight: 0, reps: 20, rir: 0 },
    { weight: null, reps: null, rir: null },
  ]);
  add("partial", "2026-10-02", 2, [{ weight: 999, reps: null, rir: 3 }]);
  add("empty", "2026-10-03", 2, [{}]);
  add("active", "2026-10-04", 3, [{ weight: 900, reps: 99 }], { active: true });
  return p;
};
export async function runInsightsTests({ test, assert, equal }) {
  const isolated = (fn) => async () => {
    const original = await repo.exportBackup();
    try {
      await fn();
    } finally {
      await repo.importBackup(original, consent);
    }
  };
  await test("Metrics: valid zeros, corresponding weights/reps, volume, nulls and incomplete entries", () => {
    const sets = [
      { weight: 30, reps: 8 },
      { weight: 40, reps: 5 },
      { weight: 0, reps: 20 },
      { weight: null, reps: 99 },
      { weight: 999, reps: null },
      { weight: 10, reps: 0 },
    ];
    const s = summarizeSets(sets);
    equal(
      [
        s.maxWeight,
        s.weightRecord.reps,
        s.maxReps,
        s.repsRecord.weight,
        s.setCount,
        s.volume,
      ],
      [40, 5, 20, 0, 3, 440],
    );
    equal(summarizeSets([{ weight: 0, reps: 8 }]).maxWeight, 0);
    equal(summarizeSets([{ weight: null, reps: 8 }]).maxWeight, null);
    equal(summarizeSets([]).setCount, 0);
  });
  await test(
    "History: across days, excludes active/empty/omitted without fake zero points; no writes",
    isolated(async () => {
      await repo.importBackup(fixture(), consent);
      // Omitted entries may contain legacy inconsistent raw data: never count them.
      await db.workoutSessions.add({
        ...legacy.workoutSessions[0],
        id: "omitted",
      });
      await db.exerciseSessions.add({
        ...legacy.exerciseSessions[0],
        id: "omitted-es",
        workoutSessionId: "omitted",
        status: "omitted",
      });
      await db.sets.add({
        ...legacy.sets[0],
        id: "omitted-set",
        exerciseSessionId: "omitted-es",
        weight: 999,
        reps: 100,
      });
      const before = await repo.exportBackup();
      const h = await readExerciseTrainings("d1-1a");
      equal(
        h.map((r) => r.session.id),
        ["partial", "new", "old"],
      );
      const i = exerciseInsights(h);
      equal(
        i.points.map((r) => r.session.routineDay),
        [4, 1],
      );
      equal(i.weightRecord.weight, 45);
      equal(i.repsRecord.weight, 0);
      equal(i.last.session.id, "partial");
      const after = await repo.exportBackup();
      for (const key of [
        "exercises",
        "workoutSessions",
        "exerciseSessions",
        "sets",
        "exerciseSnapshots",
      ])
        equal(before[key], after[key]);
    }),
  );
  await test(
    "Records recompute on edit, set deletion, workout deletion; stored flags ignored",
    isolated(async () => {
      await repo.importBackup(fixture(), consent);
      await repo.updateSet("new-0", { weight: 20 });
      equal(
        exerciseInsights(await readExerciseTrainings("d1-1a")).weightRecord.id,
        "old-0",
      );
      await repo.removeSet("old-0");
      equal(
        exerciseInsights(await readExerciseTrainings("d1-1a")).weightRecord.id,
        "new-0",
      );
      await repo.deleteSession("new");
      equal(
        exerciseInsights(await readExerciseTrainings("d1-1a")).weightRecord,
        null,
      );
      assert(
        (await db.sets.get("old-1")).isPr,
        "Legacy flags must not be rewritten",
      );
    }),
  );
  await test(
    "Frozen names and IDs survive current catalog changes; exercises without history stay empty",
    isolated(async () => {
      await repo.importBackup(fixture(), consent);
      await db.exercises.update("d1-1a", {
        name: "Changed catalog label",
        day: 3,
      });
      const h = await readExerciseTrainings("d1-1a");
      equal(h[0].exercise.name, legacy.exercises[0].name);
      equal(h[0].session.routineDay, 2);
      equal(await readExerciseTrainings("totally-new-id"), []);
      equal(
        (await readExerciseTrainings("d1-1a", "new")).map((h) => h.session.id),
        ["partial", "old"],
      );
    }),
  );
  await test(
    "Finishing workouts never rewrites raw set rows or persists new PR flags",
    isolated(async () => {
      await repo.importBackup(fixture(), consent);
      const before = await db.sets.toArray();
      await repo.finishSession("active");
      equal(await db.sets.toArray(), before);
    }),
  );
  await test(
    "Chart interaction: four metrics, periods, keyboard point detail with full RIR and original day",
    isolated(async () => {
      await repo.importBackup(fixture(), consent);
      const box = document.createElement("div");
      box.style.width = "390px";
      document.body.append(box);
      const root = createRoot(box);
      try {
        root.render(
          React.createElement(ExerciseInsights, { exerciseId: "d1-1a" }),
        );
        await until(() => box.querySelector("svg [role=button]"));
        equal(box.querySelectorAll("svg [role=button]").length, 2);
        const point = [...box.querySelectorAll("svg [role=button]")].at(-1);
        point.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        await until(() =>
          box.querySelector('[aria-label="Detalle del punto seleccionado"]'),
        );
        const detail = box.querySelector(
          '[aria-label="Detalle del punto seleccionado"]',
        );
        assert(detail.textContent.includes("Día 4"));
        assert(detail.textContent.includes("45 kg × 6"));
        assert(detail.textContent.includes("RIR 0"));
        assert(detail.textContent.includes("— kg × —"));
        equal(detail.querySelectorAll("li").length, 3);
        for (const label of [
          "Repeticiones",
          "Series",
          "Volumen",
          "Peso máximo",
        ]) {
          const b = [...box.querySelectorAll("button")].find(
            (b) => b.textContent === label,
          );
          b.click();
          await until(() => b.getAttribute("aria-pressed") === "true");
        }
        const period = [...box.querySelectorAll("button")].find(
          (b) => b.textContent === "1 mes",
        );
        period.click();
        await until(() => period.getAttribute("aria-pressed") === "true");
        await repo.deleteSession("new");
        await until(
          () =>
            !box.querySelector('[aria-label="Detalle del punto seleccionado"]'),
        );
      } finally {
        root.unmount();
        box.remove();
      }
    }),
  );
  await test(
    "Reference UI: last incomplete workout, all series and records react to historical edits/deletes",
    isolated(async () => {
      await repo.importBackup(fixture(), consent);
      const box = document.createElement("div");
      document.body.append(box);
      const root = createRoot(box);
      try {
        root.render(
          React.createElement(ExerciseReference, { exerciseId: "d1-1a" }),
        );
        await until(() => box.textContent.includes("999 kg"));
        assert(box.textContent.includes("45 kg × 6"));
        assert(box.textContent.includes("20 reps · 0 kg"));
        await repo.deleteSession("partial");
        await until(() => !box.textContent.includes("999 kg"));
        equal(box.querySelectorAll("li").length, 3);
        await repo.updateSet("new-0", { weight: 20 });
        await until(() => box.textContent.includes("40 kg × 8"));
        await repo.deleteSession("new");
        await until(() => box.textContent.includes("8 reps · 40 kg"));
      } finally {
        root.unmount();
        box.remove();
      }
    }),
  );
  await test(
    "Storage read errors show an explicit reference error, never an empty-history success",
    isolated(async () => {
      const original = db.transaction;
      db.transaction = () => Promise.reject(Error("Synthetic read failure"));
      const box = document.createElement("div");
      document.body.append(box);
      const root = createRoot(box);
      try {
        root.render(
          React.createElement(ExerciseReference, { exerciseId: "unknown" }),
        );
        await until(() => box.querySelector("[role=alert]"));
        assert(!box.textContent.includes("Sin registros anteriores"));
      } finally {
        db.transaction = original;
        root.unmount();
        box.remove();
      }
    }),
  );
  await test("Theme: switching and remount preserve preference, denied storage stays visible", async () => {
    const key = "gym-tracker:theme:v1",
      prior = localStorage.getItem(key);
    localStorage.setItem(key, "dark");
    const box = document.createElement("div");
    document.body.append(box);
    let root = createRoot(box);
    try {
      root.render(React.createElement(ThemeToggle));
      await until(() =>
        box.querySelector('[aria-label="Cambiar a modo claro"]'),
      );
      box.querySelector("button").click();
      await until(() => document.documentElement.dataset.theme === "light");
      equal(localStorage.getItem(key), "light");
      root.unmount();
      root = createRoot(box);
      root.render(React.createElement(ThemeToggle));
      await until(() =>
        box.querySelector('[aria-label="Cambiar a modo oscuro"]'),
      );
      equal(document.documentElement.dataset.theme, "light");
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw Error("denied");
      };
      try {
        box.querySelector("button").click();
        await until(() => box.querySelector("[role=status]"));
        equal(document.documentElement.dataset.theme, "dark");
      } finally {
        Storage.prototype.setItem = original;
      }
    } finally {
      root.unmount();
      box.remove();
      if (prior === null) localStorage.removeItem(key);
      else localStorage.setItem(key, prior);
    }
  });
}
