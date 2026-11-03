import Dexie from "dexie";
import { db, GymDatabase } from "../src/lib/db";
import * as repo from "../src/lib/repo";
import { validateBackup } from "../src/lib/backup";
import { readExerciseTrainings } from "../src/lib/insights";
import { getExerciseCatalog, openDay } from "../src/lib/workouts";
import { CURRENT_TEMPLATE } from "../src/data/templates";
import { ROUTINE } from "../src/data/routine";
import { isoWeekInfo } from "../src/lib/dates";
import legacy from "./fixtures/backup-v1.json";
const consent = { replaceExisting: true, unverifiedCopyAcknowledged: true };
const tables = ["exercises", "workoutSessions", "exerciseSessions", "sets"];
const rows = async (d) =>
  Object.fromEntries(
    await Promise.all(tables.map(async (t) => [t, await d.table(t).toArray()])),
  );
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
function fixture() {
  const p = structuredClone(legacy),
    archived = ROUTINE.find(
      (e) => !CURRENT_TEMPLATE.exercises.some((c) => c.id === e.id),
    );
  p.exportedAt = "2026-11-02T12:00:00.000Z";
  p.exercises.push(structuredClone(archived));
  p.workoutSessions = [];
  p.exerciseSessions = [];
  p.sets = [];
  for (let i = 0; i < 3; i++) {
    const date = ["2026-10-30", "2026-10-31", "2026-11-01"][i],
      id = "release-workout-" + i;
    p.workoutSessions.push({
      ...legacy.workoutSessions[0],
      id,
      date,
      ...isoWeekInfo(date),
      routineDay: [1, 4, 3][i],
      startedAt: date + "T17:00:00.000Z",
      finishedAt: i === 2 ? null : date + "T18:00:00.000Z",
      duration: i === 2 ? null : 3600,
      note: i === 0 ? "Prueba sintética: áéíóú · notas\nsegunda línea" : null,
    });
    const exerciseIds =
      i === 0 ? ["d1-1a", archived.id] : [i === 1 ? "d1-1a" : archived.id];
    exerciseIds.forEach((exerciseId, j) => {
      const esid = id + "-exercise-" + j;
      p.exerciseSessions.push({
        id: esid,
        workoutSessionId: id,
        exerciseId,
        order: j + 1,
        note: "Nota sintética del ejercicio " + j,
      });
      [
        [12.5, 8, 2.5],
        [0, 15, 0],
        [99, null, 3],
        [null, 0, null],
        [null, null, null],
      ].forEach(([weight, reps, rir], k) =>
        p.sets.push({
          id: esid + "-set-" + k,
          exerciseSessionId: esid,
          setNumber: k + 1,
          weight,
          reps,
          rir,
          isPr: k === 0,
        }),
      );
    });
  }
  return { backup: validateBackup(p), archived };
}
async function seed(d, p) {
  await d.open();
  for (const t of tables) await d.table(t).bulkAdd(p[t]);
}
export async function runReleaseTests({ test, assert, equal, rejects }) {
  await test("Release migration preserves every legacy field across days, notes, active workouts and archived exercises", async () => {
    const { backup, archived } = fixture(),
      name = "release-native-" + crypto.randomUUID(),
      old = oldDB(name);
    await seed(old, backup);
    const before = await rows(old);
    old.close();
    const next = new GymDatabase(name);
    try {
      await next.open();
      equal(await rows(next), before);
      assert(next.verno === 2);
      assert(
        (await next.exerciseSnapshots.count()) ===
          backup.exerciseSessions.length,
      );
      assert((await next.templates.count()) === 0);
      assert((await next.workoutDrafts.count()) === 0);
      const captured = await next.exerciseSnapshots.get(
        backup.exerciseSessions.find((es) => es.exerciseId === archived.id).id,
      );
      equal(captured.exercise, archived);
      assert((await next.sets.count()) === 20);
    } finally {
      next.close();
    }
  });
  await test("Partial snapshot upgrade failure atomically restores v1; compatible retry keeps every original row", async () => {
    const { backup } = fixture(),
      name = "release-partial-abort-" + crypto.randomUUID(),
      old = oldDB(name);
    await seed(old, backup);
    const before = await rows(old);
    old.close();
    const broken = new GymDatabase(name);
    let writes = 0;
    broken.exerciseSnapshots.hook("creating", () => {
      if (++writes === 2) throw Error("Synthetic failure after first snapshot");
    });
    await rejects(() => broken.open());
    broken.close();
    assert(writes >= 2);
    const retained = oldDB(name);
    await retained.open();
    assert(retained.verno === 1 && retained.tables.length === 4);
    equal(await rows(retained), before);
    retained.close();
    const retry = new GymDatabase(name);
    try {
      await retry.open();
      equal(await rows(retry), before);
      assert(
        (await retry.exerciseSnapshots.count()) ===
          backup.exerciseSessions.length,
      );
    } finally {
      retry.close();
    }
  });
  await test("Rolling application code back to v1 cannot downgrade an upgraded database; v2 recovery reopens intact", async () => {
    const { backup } = fixture(),
      name = "release-downgrade-" + crypto.randomUUID(),
      old = oldDB(name);
    await seed(old, backup);
    const before = await rows(old);
    old.close();
    const next = new GymDatabase(name);
    await next.open();
    next.close();
    // A historical Dexie app explicitly requests native version 10, after upgrade to 20.
    const downgradeError = await new Promise((resolve) => {
      const request = indexedDB.open(name, 10);
      request.onerror = () => {
        request.onerror = null;
        resolve(request.error?.name);
      };
      request.onsuccess = () => {
        request.result.close();
        resolve("unexpected success");
      };
    });
    equal(downgradeError, "VersionError");
    const recovery = new GymDatabase(name);
    try {
      await recovery.open();
      equal(await rows(recovery), before);
    } finally {
      recovery.close();
    }
  });
  const isolated = (fn) => async () => {
    const original = await repo.exportBackup();
    try {
      await fn();
    } finally {
      await repo.importBackup(original, consent);
    }
  };
  await test(
    "Release v1->v2 backup recovery preserves raw records and distinguishes moved, archived and new exercise identities",
    isolated(async () => {
      const { backup, archived } = fixture();
      await repo.importBackup(backup, consent);
      const before = await rows(db);
      const squat = await readExerciseTrainings("d1-1a");
      equal(
        squat.map((h) => h.session.routineDay),
        [4, 1],
      );
      assert(
        CURRENT_TEMPLATE.exercises.find((e) => e.id === "d1-1a").day === 2,
      );
      const catalog = await getExerciseCatalog();
      assert(catalog.some((e) => e.id === archived.id));
      assert((await readExerciseTrainings(archived.id)).length === 1);
      const newlyAdded = CURRENT_TEMPLATE.exercises.find(
        (e) => !ROUTINE.some((old) => old.id === e.id),
      );
      equal(await readExerciseTrainings(newlyAdded.id), []);
      await openDay(2);
      equal(await rows(db), before);
      const v2 = validateBackup(
        JSON.parse(JSON.stringify(await repo.exportBackup())),
      );
      assert(v2.version === 2);
      await repo.importBackup(v2, consent);
      equal(await rows(db), before);
      const after = await repo.exportBackup();
      equal(after.exerciseSnapshots, v2.exerciseSnapshots);
      equal(after.templates, v2.templates);
    }),
  );
}
