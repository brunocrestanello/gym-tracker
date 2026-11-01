import { db, GymDatabase, ensureSeeded } from '../src/lib/db';
import * as repo from '../src/lib/repo';
import { validateBackup } from '../src/lib/backup';
import { persist, waitForWrites } from '../src/lib/persistence';
import legacy from "./fixtures/backup-v1.json";
import React from "react";
import { createRoot } from "react-dom/client";
import SetRow from "../src/components/SetRow";
import { ROUTINE } from '../src/data/routine';

const results = [];
const assert = (ok, message = 'Assertion failed') => { if (!ok) throw Error(message); };
const equal = (a,b) => assert(JSON.stringify(a) === JSON.stringify(b), 'Values differ');
const rejects = async fn => { let failed = false; try { await fn(); } catch { failed = true; } assert(failed, 'Expected rejection'); };
const snapshot = async () => { const {exportedAt, ...data} = await repo.exportBackup(); void exportedAt; return data; };
const test = async (name, fn) => { try { await fn(); results.push({name}); } catch (error) { results.push({name, error: error.stack || String(error)}); } };
async function inject(table, operation, fn) {
  const fail = () => { throw Error('Injected storage failure'); };
  db[table].hook(operation, fail);
  try { await fn(); } finally { db[table].hook(operation).unsubscribe(fail); }
}
window.repo = repo;
window.ensureSeeded = ensureSeeded;
if (!location.search.includes("peer")) window.testResults = (async () => {
  await ensureSeeded();
  let workout, exercise, set, backup;
  await test('Seed preserves restored exercise metadata', async () => {
    equal(await db.exercises.toArray(), [...ROUTINE].sort((a,b) => a.id.localeCompare(b.id)));
    await db.exercises.update(ROUTINE[0].id, {name:'Restored name'});
    await ensureSeeded();
    assert((await db.exercises.get(ROUTINE[0].id)).name === 'Restored name');
  });
  await test('Concurrent starts across database connections create one complete workout', async () => {
    const peer = new GymDatabase();
    const frame = document.createElement('iframe');
    frame.src = '/?peer=1'; document.body.append(frame);
    await new Promise(resolve => frame.onload = resolve);
    await frame.contentWindow.ensureSeeded();
    assert((await db.exercises.get(ROUTINE[0].id)).name === 'Restored name');
    const starts = await Promise.all(Array.from({length:15}, (_,i) => (i % 2 ? repo : frame.contentWindow.repo).startOrResumeSession(i % 2 ? 1 : 2)));
    frame.remove();
    assert(new Set(starts.map(s => s.id)).size === 1);
    workout = starts[0];
    assert(await peer.workoutSessions.count() === 1);
    const full = await repo.getWorkoutSessionFull(workout.id);
    assert(full.exerciseSessions.length === ROUTINE.filter(e => e.day === workout.routineDay).length);
    assert(full.exerciseSessions.every(e => e.sets.length === 3));
    exercise = full.exerciseSessions[0]; set = exercise.sets[0];
    peer.close();
  });
  await test('Concurrent added sets have unique consecutive numbers', async () => {
    const added = await Promise.all(Array.from({length:15}, () => repo.addSet(exercise.id)));
    equal(added.map(s=>s.setNumber).sort((a,b)=>a-b), Array.from({length:15},(_,i)=>i+4));
    await rejects(() => repo.addSet('missing'));
  });
  await test('Writes reject missing rows, nonfinite and negative values', async () => {
    await rejects(() => repo.updateSet('missing', {weight:10}));
    for (const weight of [NaN, Infinity, -1, undefined]) await rejects(() => repo.updateSet(set.id, {weight}));
    await repo.updateSet(set.id, {weight:42.5,reps:8,rir:1});
    assert((await db.sets.get(set.id)).weight === 42.5);
  });
  await test('Finish rolls back PRs and status on write failure', async () => {
    const before = await snapshot();
    await inject('workoutSessions', 'updating', () => rejects(() => repo.finishSession(workout.id)));
    equal(await snapshot(), before);
  });
  await test('Finishing twice keeps timestamp, duration and summary', async () => {
    const first = await repo.finishSession(workout.id);
    const before = await snapshot();
    equal(await repo.finishSession(workout.id), first);
    equal(await snapshot(), before);
    assert(first.setCount === 1 && first.totalVolume === 340);
  });
  await test('Export v1 round trips JSON without changing rows', async () => {
    backup = await repo.exportBackup();
    assert(backup.version === 1);
    equal(validateBackup(JSON.parse(JSON.stringify(backup))), backup);
    const before = await snapshot();
    await repo.importBackup(JSON.parse(JSON.stringify(backup)));
    equal(await snapshot(), before);
  });
  await test('Reject malformed JSON, unsupported versions, types, dates, relations and duplicate keys without changing history', async () => {
    const before = await snapshot();
    await rejects(() => Promise.resolve(JSON.parse('{bad')));
    for (const mutate of [
      p=>p.version=2, p=>delete p.sets, p=>p.sets[0].weight='5', p=>p.sets[0].reps=-1,
      p=>p.sets[0].isPr=1, p=>p.sets[0].exerciseSessionId='orphan', p=>p.exerciseSessions[0].exerciseId='unknown',
      p=>p.exerciseSessions[0].workoutSessionId='unknown', p=>p.workoutSessions[0].date='2026-02-30',
      p=>p.workoutSessions[0].isoWeek=90, p=>p.exercises[0].targetSets=0,
      p=>p.sets.push({...p.sets[0]}), p=>p.sets.push({...p.sets[0],id:'duplicate-number'}),
      p=>p.sets[0].weight=Infinity,
    ]) {
      const copy = structuredClone(backup); mutate(copy);
      await rejects(() => repo.importBackup(copy)); equal(await snapshot(), before);
    }
  });
  await test('Restoration failure after clears and partial inserts rolls back all tables', async () => {
    const before = await snapshot();
    let calls=0;
    const fail = () => { if (++calls === 2) throw Error('QuotaExceededError injected'); };
    db.sets.hook('creating',fail);
    try { await rejects(() => repo.importBackup(backup)); } finally { db.sets.hook('creating').unsubscribe(fail); }
    assert(calls >= 2); equal(await snapshot(), before);
  });
  await test('Delete failure preserves entire workout', async () => {
    const before = await snapshot();
    await inject('workoutSessions','deleting',()=>rejects(()=>repo.deleteSession(workout.id)));
    equal(await snapshot(),before);
  });
  await test('Creation failure leaves no partial workout and preserves existing history', async () => {
    const before = await snapshot();
    await inject('sets','creating',()=>rejects(()=>repo.startOrResumeSession(3)));
    equal(await snapshot(),before);
  });
  await test('Delete removes children and preserves other workouts', async () => {
    const history = await repo.getWorkoutSessionFull(workout.id);
    const second = await repo.startOrResumeSession(3);
    await repo.deleteSession(second.id);
    equal(await repo.getWorkoutSessionFull(workout.id),history);
    assert(await db.exerciseSessions.where('workoutSessionId').equals(second.id).count() === 0);
    assert(await db.sets.count() === history.exerciseSessions.reduce((n,e)=>n+e.sets.length,0));
  });
  await test('Export failure propagates instead of returning an incomplete backup', async () => {
    const original = db.sets.toArray;
    db.sets.toArray = () => Promise.reject(Error('Read failure'));
    try { await rejects(()=>repo.exportBackup()); } finally { db.sets.toArray=original; }
  });
  await test('Pending writes delay completion; failed writes block until successful retry', async () => {
    let release;
    const pending = persist('test',()=>new Promise(r=>release=r));
    let done=false;
    const waiting=waitForWrites().then(()=>done=true);
    await Promise.resolve(); assert(!done); release(); await pending; await waiting; assert(done);
    await rejects(()=>persist('test',async()=>{throw Error('QuotaExceededError');}));
    await rejects(()=>waitForWrites());
    await persist('test',async()=>{}); await waitForWrites();
  });
  await test('Autosave shows a storage failure, preserves input and retries successfully', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    root.render(React.createElement(SetRow, {set: await db.sets.get(set.id), placeholderWeight:null, canDelete:false,onChanged:()=>{}}));
    const until = async fn => { for(let i=0;i<100;i++){ if(fn())return; await new Promise(r=>setTimeout(r,10)); } throw Error('UI state timed out: '+container.textContent); };
    await until(()=>container.querySelector('input'));
    const input = container.querySelector('input');
    const enter = value => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    };
    await inject('sets','updating',async()=>{
      enter('51,5');
      await until(()=>container.textContent.includes('No se guardó'));
      assert(input.value === '51,5');
      assert((await db.sets.get(set.id)).weight === 42.5);
      await rejects(()=>waitForWrites());
    });
    container.querySelector('button').click();
    await until(()=>container.textContent.includes('Guardado'));
    assert((await db.sets.get(set.id)).weight === 51.5);
    await waitForWrites();
    enter('1x'); await until(()=>container.textContent.includes('No se guardó'));
    assert((await db.sets.get(set.id)).weight === 51.5);
    enter('52'); await until(()=>container.textContent.includes('Guardado'));
    root.unmount(); container.remove();
  });
  await test('Exports remain relationally consistent during concurrent create/delete', async () => {
    const changing = (async () => { const s = await repo.startOrResumeSession(4); await repo.deleteSession(s.id); })();
    await Promise.all(Array.from({length:10}, async () => validateBackup(await repo.exportBackup())));
    await changing;
  });
  await test('Legacy v1 fixture preserves IDs, notes, zero values and empty sets exactly', async () => {
    const original = await repo.exportBackup();
    try {
      await repo.importBackup(legacy);
      const {exportedAt, ...rows} = legacy; void exportedAt;
      equal(await snapshot(),{...rows, sets:[...rows.sets].sort((a,b)=>a.id.localeCompare(b.id))});
      await repo.startOrResumeSession(2);
      validateBackup(await repo.exportBackup());
      equal(await db.sets.get('legacy-set'), legacy.sets[0]);
    } finally { await repo.importBackup(original); }
  });
  return results;
})();
