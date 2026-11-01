import { db, GymDatabase, ensureSeeded } from '../src/lib/db';
import * as repo from '../src/lib/repo';
import { validateBackup } from '../src/lib/backup';
import { persist, waitForWrites } from '../src/lib/persistence';
import legacy from "./fixtures/backup-v1.json";
import React from "react";
import { createRoot } from "react-dom/client";
import UnsavedChangesGuard from "../src/components/UnsavedChangesGuard";
import RestoreConfirmation from "../src/components/RestoreConfirmation";
import SetRow from "../src/components/SetRow";
import { ROUTINE } from '../src/data/routine';

const restore = input => repo.importBackup(input, { replaceExisting:true, unverifiedCopyAcknowledged:true });
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
    await restore(JSON.parse(JSON.stringify(backup)));
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
      await rejects(() => restore(copy)); equal(await snapshot(), before);
    }
  });
  await test('Restoration failure after clears and partial inserts rolls back all tables', async () => {
    const before = await snapshot();
    let calls=0;
    const fail = () => { if (++calls === 2) throw Error('QuotaExceededError injected'); };
    db.sets.hook('creating',fail);
    try { await rejects(() => restore(backup)); } finally { db.sets.hook('creating').unsubscribe(fail); }
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
    await new Promise(r=>setTimeout(r,0)); assert(!done); release(); await pending; await waiting; assert(done);
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
      await restore(legacy);
      const {exportedAt, ...rows} = legacy; void exportedAt;
      equal(await snapshot(),{...rows, sets:[...rows.sets].sort((a,b)=>a.id.localeCompare(b.id))});
      await repo.startOrResumeSession(2);
      validateBackup(await repo.exportBackup());
      equal(await db.sets.get('legacy-set'), legacy.sets[0]);
    } finally { await restore(original); }
  });
  await test('Delayed older write cannot overwrite a newer edit', async () => {
    const original = await db.sets.get(set.id);
    let release;
    const gate = new Promise(resolve => release = resolve);
    const old = persist('race:weight', async () => { await gate; await repo.updateSet(set.id,{weight:10}); });
    const recent = persist('race:weight', async () => { await repo.updateSet(set.id,{weight:20}); });
    await new Promise(r=>setTimeout(r,30));
    release();
    try {
      await Promise.all([old,recent]);
      assert((await db.sets.get(set.id)).weight === 20, 'Older write replaced the latest edit');
    } finally { await repo.updateSet(set.id,{weight:original.weight}); }
  });
  await test('Original v1 clock reversal with zero duration remains importable', async () => {
    const p = structuredClone(legacy);
    p.workoutSessions[0].finishedAt = '2026-10-30T16:59:00.000Z';
    p.workoutSessions[0].duration = 0;
    equal(validateBackup(p),p);
  });
  await test('Valid v1 null/zero/partial combinations and interrupted training round trip unchanged', async () => {
    const original = await repo.exportBackup();
    try {
      const payload = structuredClone(legacy);
      payload.workoutSessions[0].finishedAt = null;
      payload.workoutSessions[0].duration = null;
      payload.workoutSessions[0].note = '';
      payload.sets = [];
      for (const weight of [null,0,42.5]) for (const reps of [null,0,8]) for (const rir of [null,0,1.5]) {
        const n=payload.sets.length+1;
        payload.sets.push({id:`combo-${String(n).padStart(2,'0')}`,exerciseSessionId:'legacy-exercise',setNumber:n,weight,reps,rir,isPr:false});
      }
      await restore(JSON.parse(JSON.stringify(payload)));
      equal((await repo.exportBackup()).sets,payload.sets);
      // Original creation could be exported before exercises or initial sets were added.
      for (const partial of [ {...payload,sets:[]}, {...payload,exerciseSessions:[],sets:[]}, {...payload,workoutSessions:[],exerciseSessions:[],sets:[]}, {...payload,exercises:[],workoutSessions:[],exerciseSessions:[],sets:[]} ]) {
        equal(validateBackup(partial),partial);
        await restore(partial);
      }
      const finishedEmpty = structuredClone(legacy); finishedEmpty.sets=[];
      equal(validateBackup(finishedEmpty),finishedEmpty);
      const gaps = structuredClone(legacy); gaps.sets[1].setNumber=5;
      equal(validateBackup(gaps),gaps);
    } finally { await restore(original); }
  });
  await test('Historically possible structural inconsistencies are rejected without repairing rows', async () => {
    const before=await snapshot();
    for (const mutate of [
      p=>{const s=p.workoutSessions[0];s.finishedAt=null;s.duration=null;p.workoutSessions.push({...s,id:'duplicate-active'});},
      p=>p.exerciseSessions.push({...p.exerciseSessions[0],id:'duplicate-exercise'}),
      p=>p.sets[1].setNumber=1,
      p=>p.workoutSessions[0].startedAt=null,
      p=>p.sets[0].weight=-1,
    ]) { const p=structuredClone(legacy); mutate(p); await rejects(()=>restore(p)); equal(await snapshot(),before); }
  });
  await test('Restoration refuses absent or partial replacement consent before modifying data', async () => {
    const before=await snapshot();
    for (const consent of [undefined,{}, {replaceExisting:true}, {replaceExisting:true,unverifiedCopyAcknowledged:false}]) {
      await rejects(()=>repo.importBackup(legacy,consent)); equal(await snapshot(),before);
    }
  });
  await test('Restore dialog warns, requires separate confirmation and exact phrase, including after download', async () => {
    const before=await snapshot();
    const container=document.createElement('div');document.body.append(container);
    const root=createRoot(container); let confirmed=0,copied=0,cancelled=0;
    const props={payload:legacy,busy:false,message:null,onCopy:()=>copied++,onCancel:()=>cancelled++,onConfirm:()=>confirmed++};
    const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Dialog timeout');};
    root.render(React.createElement(RestoreConfirmation,props));
    await until(()=>container.querySelector('[role=dialog]'));
    assert(container.textContent.includes('reemplaza'));
    const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent.includes(text));
    assert(!button('Reemplazar historial'));
    button('Descargar copia').click(); assert(copied===1 && confirmed===0);
    button('Continuar a confirmación').click();
    await until(()=>container.querySelector('input'));
    assert(button('Reemplazar historial').disabled);
    const input=container.querySelector('input');
    const type=text=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));};
    type('reemplazar');await new Promise(r=>setTimeout(r,0));assert(button('Reemplazar historial').disabled);
    type('REEMPLAZAR');await until(()=>!button('Reemplazar historial').disabled);
    assert(confirmed===0);button('Reemplazar historial').click();assert(confirmed===1);
    button('Cancelar').click();assert(cancelled===1);
    equal(await snapshot(),before);
    root.unmount();container.remove();
  });
  await test('Consecutive write failures block finishing until the latest retry succeeds', async () => {
    const current=await repo.startOrResumeSession(4);
    const full=await repo.getWorkoutSessionFull(current.id); const row=full.exerciseSessions[0].sets[0];
    for(let i=0;i<2;i++) await rejects(()=>persist(`${row.id}:weight`,async()=>{throw Error('Quota failure '+i);},`set:${row.id}`));
    await persist(`${row.id}:reps`,()=>repo.updateSet(row.id,{reps:10}),`set:${row.id}`);
    await rejects(()=>repo.finishSession(current.id));
    assert((await db.workoutSessions.get(current.id)).finishedAt===null);
    await persist(`${row.id}:weight`,()=>repo.updateSet(row.id,{weight:80}),`set:${row.id}`);
    let release; const gate=new Promise(r=>release=r);
    const writing=persist(`${row.id}:weight`,async()=>{await gate;await repo.updateSet(row.id,{weight:81});},`set:${row.id}`);
    const ending=repo.finishSession(current.id);
    await new Promise(r=>setTimeout(r,20));
    assert((await db.workoutSessions.get(current.id)).finishedAt===null);
    release();await writing;const summary=await ending;assert(summary.totalVolume===810);
    await repo.deleteSession(current.id);
  });
  await test('Failed queued edit followed by deliberate deletion leaves no phantom error or recreated row', async () => {
    const row=await repo.addSet(exercise.id);
    let release;const gate=new Promise(r=>release=r);
    const writing=persist(`${row.id}:weight`,async()=>{await gate;throw Error('Write failure');},`set:${row.id}`);
    const observed=writing.catch(()=>{});
    const deleting=repo.removeSet(row.id);
    await new Promise(r=>setTimeout(r,10));assert(await db.sets.get(row.id));
    release();await observed;await deleting;await waitForWrites();
    assert(!(await db.sets.get(row.id)));
    await rejects(()=>repo.updateSet(row.id,{weight:999}));assert(!(await db.sets.get(row.id)));
  });
  await test('Failed deletion preserves row and failed draft until deletion retry succeeds', async () => {
    const row=await repo.addSet(exercise.id);
    await rejects(()=>persist(`${row.id}:weight`,async()=>{throw Error('Write failure');},`set:${row.id}`));
    await inject('sets','deleting',()=>rejects(()=>repo.removeSet(row.id)));
    assert(await db.sets.get(row.id));await rejects(()=>waitForWrites());
    await repo.removeSet(row.id);assert(!(await db.sets.get(row.id)));await waitForWrites();
  });
  await test('Re-finalizing existing history performs no writes and keeps stored duration', async () => {
    const original=await repo.exportBackup();
    try {
      const p=structuredClone(legacy);p.workoutSessions[0].duration=17;
      await restore(p); const before=await snapshot();
      await inject('workoutSessions','updating',()=>repo.finishSession('legacy-workout'));
      equal(await snapshot(),before);
      assert((await repo.finishSession('legacy-workout')).durationSeconds===17);
    } finally { await restore(original); }
  });
  await test('Real service worker waits for old clients, never reloads them and preserves unrelated caches', async () => {
    const until=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('SW lifecycle timeout');};
    let frame, registration;
    try {
      registration=await navigator.serviceWorker.register('/sw-test/sw.js?version=1',{scope:'/sw-test/',updateViaCache:'none'});
      await until(()=>registration.active?.state==='activated');
      assert(!navigator.serviceWorker.controller, 'Worker claimed a page outside its scope');
      await caches.open('unrelated-cache');
      frame=document.createElement('iframe');frame.src='/sw-test/client';document.body.append(frame);
      await new Promise(r=>frame.onload=r);
      await until(()=>frame.contentWindow.navigator.serviceWorker.controller);
      const old=frame.contentWindow.navigator.serviceWorker.controller;
      assert(old.scriptURL.endsWith('version=1'));
      const marker=frame.contentDocument.getElementById('marker');
      await navigator.serviceWorker.register('/sw-test/sw.js?version=2',{scope:'/sw-test/',updateViaCache:'none'});
      await until(()=>registration.waiting?.state==='installed');
      assert(registration.active.scriptURL.endsWith('version=1'));
      assert(frame.contentWindow.navigator.serviceWorker.controller===old);
      assert(frame.contentDocument.getElementById('marker')===marker,'Client reloaded during update');
      frame.remove();frame=null;
      await until(()=>registration.active?.scriptURL.endsWith('version=2') && registration.active.state==='activated');
      const keys=await caches.keys();assert(keys.includes('unrelated-cache'));
      assert(!keys.includes('rutina-bruno-test-1'));
      assert(keys.includes('rutina-bruno-test-2'));
      frame=document.createElement('iframe');frame.src='/sw-test/client';document.body.append(frame);
      await new Promise(r=>frame.onload=r);
      assert(frame.contentWindow.navigator.serviceWorker.controller.scriptURL.endsWith('version=2'));
      await frame.contentWindow.fetch('/sw-test/data',{headers:{RSC:'1'}});
      const current=await caches.open('rutina-bruno-test-2');
      assert(!(await current.match('/sw-test/data')), 'New worker cached RSC as HTML');
    } finally {
      frame?.remove();await registration?.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
    }
  });
  await test('Rapid React input across fields preserves the latest values, including A-B-A edits', async () => {
    const row=await repo.addSet(exercise.id);
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    const until=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Rapid input timeout: '+container.textContent);};
    const original=db.sets.update;let calls=0,release;const gate=new Promise(r=>release=r);
    db.sets.update=async function(...args){if(++calls===1)await gate;return original.apply(this,args);};
    try {
      root.render(React.createElement(SetRow,{set:row,placeholderWeight:null,canDelete:true,onChanged:()=>{}}));
      await until(()=>container.querySelector('input'));
      const inputs=container.querySelectorAll('input');
      const type=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      type(inputs[0],'70');type(inputs[0],'70,5');type(inputs[0],'70');
      type(inputs[1],'1');type(inputs[1],'10');type(inputs[2],'0');
      await new Promise(r=>setTimeout(r,20));assert(calls===1);assert(container.textContent.includes('Guardando'));
      release();await until(()=>container.textContent.includes('Guardado'));await waitForWrites();
      const stored=await db.sets.get(row.id);assert(stored.weight===70 && stored.reps===10 && stored.rir===0);
      assert(inputs[0].value==='70');
    } finally { release();await waitForWrites();db.sets.update=original;root.unmount();container.remove();await repo.removeSet(row.id); }
  });
  await test('Deleting a React row waits for pending writes and prevents editing while deleting', async () => {
    const row=await repo.addSet(exercise.id);
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    const until=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Deletion timeout');};
    const original=db.sets.update;let release;const gate=new Promise(r=>release=r);
    db.sets.update=async function(...args){await gate;return original.apply(this,args);};
    try {
      root.render(React.createElement(SetRow,{set:row,placeholderWeight:null,canDelete:true,onChanged:()=>{}}));
      await until(()=>container.querySelector('input'));
      const input=container.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'60');input.dispatchEvent(new Event('input',{bubbles:true}));
      container.querySelector('[aria-label="Eliminar serie"]').click();
      await until(()=>input.matches(':disabled'));
      assert(await db.sets.get(row.id));
      release();await until(async()=>!(await db.sets.get(row.id)));await waitForWrites();
      assert(!(await db.sets.get(row.id)));
    } finally { release();await waitForWrites();db.sets.update=original;root.unmount();container.remove(); }
  });
  await test('Unload warning follows pending/error state and clears after successful retry', async () => {
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    root.render(React.createElement(UnsavedChangesGuard));await new Promise(r=>setTimeout(r,30));
    const warned=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
    try {
      assert(!warned());
      let release;const gate=new Promise(r=>release=r);
      const writing=persist('unload-test',async()=>{await gate;});
      assert(warned());release();await writing;assert(!warned());
      await rejects(()=>persist('unload-test',async()=>{throw Error('Storage failure');}));
      assert(warned());await persist('unload-test',async()=>{});assert(!warned());
    } finally {root.unmount();container.remove();}
  });
  await test('Deletion error remains visible after a later successful edit until deletion retry', async () => {
    const row=await repo.addSet(exercise.id);
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    const until=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Delete error UI timeout');};
    try {
      root.render(React.createElement(SetRow,{set:row,placeholderWeight:null,canDelete:true,onChanged:()=>{}}));
      await until(()=>container.querySelector('input'));
      await inject('sets','deleting',async()=>{
        container.querySelector('[aria-label="Eliminar serie"]').click();
        await until(()=>container.querySelector('[role=alert]'));
      });
      const input=container.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'11');input.dispatchEvent(new Event('input',{bubbles:true}));
      await until(()=>container.querySelector('[role=status]').textContent==='Guardado');
      assert(container.querySelector('[role=alert]'));
      await rejects(()=>waitForWrites());
      container.querySelector('[aria-label="Eliminar serie"]').click();
      await until(async()=>!(await db.sets.get(row.id)));await waitForWrites();
    } finally {root.unmount();container.remove();}
  });
  return results;
})();
