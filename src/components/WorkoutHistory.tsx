"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  readWorkoutEdit,
  saveWorkoutEdit,
  additionalHistoryExercise,
  blankHistorySet,
  type WorkoutEdit,
} from "@/lib/history-edit";
import { getExerciseCatalog } from "@/lib/workouts";
import { deleteSession } from "@/lib/repo";
import { waitForWrites } from "@/lib/persistence";
import { formatDateShort, formatDuration } from "@/lib/dates";
import { isValidSet, sumVolume } from "@/lib/calculations";
import { RecordedSets } from "./ExerciseReference";
import Modal from "./Modal";
import type { SetEntry } from "@/lib/types";

type Field = "weight" | "reps" | "rir";
type Raw = Record<string, Partial<Record<Field, string>>>;
const textValue = (s: SetEntry, f: Field, raw: Raw) =>
  raw[s.id]?.[f] ?? (s[f] === null ? "" : String(s[f]));
function parsedSet(s: SetEntry, raw: Raw): SetEntry {
  const set = { ...s };
  for (const f of ["weight", "reps", "rir"] as Field[]) {
    const v = textValue(s, f, raw).trim().replace(",", ".");
    if (v !== "" && !/^\d+(\.\d+)?$/.test(v))
      throw new Error(
        "Revisá los valores: usá números positivos o campos vacíos.",
      );
    const n = v === "" ? null : Number(v);
    if (
      n !== null &&
      (!Number.isFinite(n) || (f === "reps" && !Number.isInteger(n)))
    )
      throw new Error(
        "Revisá los valores. Las repeticiones deben ser enteras.",
      );
    set[f] = n;
  }
  return set;
}
export default function WorkoutHistory({
  id,
  completed = false,
  onDeleted,
}: {
  id: string;
  completed?: boolean;
  onDeleted: () => void;
}) {
  const live = useLiveQuery(async () => {
    try {
      return { doc: await readWorkoutEdit(id), error: null };
    } catch {
      return {
        doc: null,
        error:
          "No se pudo leer el entrenamiento. Tus datos no fueron modificados.",
      };
    }
  }, [id]);
  const catalog = useLiveQuery(getExerciseCatalog, []);
  const [original, setOriginal] = useState<WorkoutEdit | null>(null),
    [draft, setDraft] = useState<WorkoutEdit | null>(null);
  const [raw, setRaw] = useState<Raw>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState(false);
  const [picker, setPicker] = useState<string | null>(null),
    [choice, setChoice] = useState(""),
    [omit, setOmit] = useState<string | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useRef(false);
  const dirty =
    !!draft &&
    (JSON.stringify(draft) !== JSON.stringify(original) ||
      Object.keys(raw).length > 0);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigate = (e: MouseEvent) => {
      const a = (e.target as Element)?.closest?.("a[href]");
      if (a && busy) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (
        a &&
        !window.confirm(
          "¿Descartar los cambios sin guardar de este entrenamiento?",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, busy]);
  if (!live) return <p className="empty-state">Cargando entrenamiento…</p>;
  if (live.error)
    return (
      <p role="alert" className="p-5">
        {live.error}{" "}
        <button onClick={() => location.reload()}>Reintentar</button>
      </p>
    );
  if (!live.doc)
    return <p className="empty-state">Entrenamiento no encontrado.</p>;
  const view = draft ?? live.doc,
    session = view.session;
  const editing = !!draft;
  const validSets = live.doc.session.exerciseSessions
    .filter((e) => e.status !== "omitted")
    .flatMap((e) => e.sets)
    .filter(isValidSet);
  const begin = () => {
    const doc = structuredClone(live.doc!);
    setOriginal(doc);
    setDraft(structuredClone(doc));
    setRaw({});
    setSaved(false);
    setError(null);
    setConfirmDelete(false);
  };
  const cancel = () => {
    setDraft(null);
    setOriginal(null);
    setRaw({});
    setPicker(null);
    setOmit(null);
    setError(null);
  };
  const update = (fn: (d: WorkoutEdit) => void) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  async function save() {
    if (!draft || !original || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = structuredClone(draft);
      for (const row of next.session.exerciseSessions)
        row.sets = row.sets.map((s) => parsedSet(s, raw));
      await saveWorkoutEdit(original, next);
      setDraft(null);
      setOriginal(null);
      setRaw({});
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudieron guardar los cambios. Reintentá.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function omitRow(rowId: string) {
    update((d) => {
      const row = d.session.exerciseSessions.find((e) => e.id === rowId)!;
      row.status = "omitted";
      row.sets = [];
    });
    setOmit(null);
  }
  function chooseExercise() {
    const exercise = catalog?.find((e) => e.id === choice);
    if (!exercise || !draft) return;
    update((d) => {
      const row =
        picker === "add"
          ? null
          : d.session.exerciseSessions.find((e) => e.id === picker)!;
      if (row?.exerciseId === exercise.id) return;
      const hasData = row?.sets.some((s) =>
        (["weight", "reps", "rir"] as Field[]).some(
          (f) => textValue(s, f, raw).trim() !== "",
        ),
      );
      if (row && !hasData) {
        const snap = d.snapshots.find((s) => s.id === row.id)!;
        snap.plannedExercise ??= structuredClone(row.exercise);
        snap.exercise = structuredClone(exercise);
        snap.provenance = "captured";
        row.exercise = structuredClone(exercise);
        row.exerciseId = exercise.id;
        row.origin = "substitution";
        row.status = "pending";
      } else {
        const added = additionalHistoryExercise(
          exercise,
          id,
          Math.max(0, ...d.session.exerciseSessions.map((e) => e.order)) + 1,
        );
        if (row) {
          added.row.origin = "substitution";
          added.snapshot.plannedExercise = structuredClone(row.exercise);
        }
        d.session.exerciseSessions.push(added.row);
        d.snapshots.push(added.snapshot);
      }
    });
    setPicker(null);
    setChoice("");
  }
  return (
    <main className={`px-4 py-4 ${editing ? "pb-32" : "pb-12"}`}>
      <Link href={completed ? "/" : "/historial"} className="back-link">
        ← {completed ? "Inicio" : "Historial"}
      </Link>
      <p className="eyebrow mt-3">
        {editing
          ? "Edición del entrenamiento"
          : session.finishedAt
            ? "Entrenamiento finalizado · solo lectura"
            : "Entrenamiento en curso · solo lectura"}
      </p>
      <h1 className="page-title mt-2 mb-4">
        Día {session.routineDay} · {formatDateShort(session.date)}
      </h1>
      {completed && (
        <p className="panel mb-4 text-accent-strong">
          Día {session.routineDay} completado
        </p>
      )}
      <p className="text-sm text-text-secondary mb-5">
        {editing ? "Resumen guardado · " : ""}
        {validSets.length} series válidas ·{" "}
        {Number(sumVolume(validSets).toFixed(2))} kg·reps{" "}
        {session.duration !== null
          ? `· ${formatDuration(session.duration)}`
          : ""}
      </p>
      {error && (
        <p role="alert" className="panel mb-4">
          {error}
        </p>
      )}
      {saved && !editing && (
        <p role="status" className="text-accent mb-4">
          Cambios guardados.
        </p>
      )}
      {editing && (
        <p className="reference-panel text-sm">
          Los cambios se guardan juntos al tocar “Guardar cambios”. Cancelar
          conserva el entrenamiento original. La fecha y el día original se
          mantienen.
        </p>
      )}
      <fieldset disabled={busy} className="space-y-4">
        {session.exerciseSessions.map((row) => (
          <section
            key={`${editing ? "edit" : "read"}:${row.id}`}
            aria-label={row.exercise.name}
            className="panel"
          >
            <div className="flex justify-between gap-3 items-start mb-3">
              <h2 className="font-semibold">{row.exercise.name}</h2>
              {!editing && (
                <Link
                  href={`/ejercicio/${row.exerciseId}`}
                  className="text-sm text-accent"
                >
                  Evolución ↗
                </Link>
              )}
            </div>
            {row.origin === "substitution" && (
              <p className="text-sm text-text-secondary mb-3">
                Sustitución de{" "}
                {view.snapshots.find((s) => s.id === row.id)?.plannedExercise
                  ?.name ?? "otro ejercicio"}
              </p>
            )}
            {row.origin === "additional" && (
              <p className="text-sm text-text-secondary mb-3">
                Ejercicio adicional
              </p>
            )}
            {row.status === "omitted" ? (
              <div>
                <p className="text-text-secondary">
                  Omitido · sin series registradas
                </p>
                {editing && (
                  <button
                    className="text-accent"
                    onClick={() =>
                      update((d) => {
                        const r = d.session.exerciseSessions.find(
                          (e) => e.id === row.id,
                        )!;
                        const baseline =
                          original?.session.exerciseSessions.find(
                            (e) => e.id === r.id,
                          );
                        r.status =
                          baseline?.status === "omitted"
                            ? "pending"
                            : (baseline?.status ?? "pending");
                        r.sets = baseline?.sets.length
                          ? structuredClone(baseline.sets)
                          : [blankHistorySet(r.id, 1)];
                      })
                    }
                  >
                    Reactivar ejercicio
                  </button>
                )}
              </div>
            ) : editing ? (
              <>
                <div className="grid grid-cols-[20px_1fr_1fr_1fr_44px] gap-2 text-xs text-text-secondary mb-2">
                  <span>#</span>
                  <span>Peso (kg)</span>
                  <span>Reps</span>
                  <span>RIR</span>
                  <span />
                </div>
                <div className="space-y-2">
                  {row.sets.map((s) => (
                    <div
                      key={s.id}
                      className="grid grid-cols-[20px_1fr_1fr_1fr_44px] items-center gap-2"
                    >
                      <span className="text-sm">{s.setNumber}</span>
                      {(["weight", "reps", "rir"] as Field[]).map((f) => (
                        <input
                          key={f}
                          aria-label={`${f === "weight" ? "Peso" : f === "reps" ? "Repeticiones" : "RIR"} de serie ${s.setNumber}`}
                          inputMode={f === "reps" ? "numeric" : "decimal"}
                          value={textValue(s, f, raw)}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRaw((r) => ({
                              ...r,
                              [s.id]: { ...r[s.id], [f]: value },
                            }));
                          }}
                          className="w-full rounded-lg bg-surface-2 border border-border px-2 py-3 text-center text-base"
                        />
                      ))}
                      <button
                        aria-label={`Eliminar serie ${s.setNumber}`}
                        className="text-danger"
                        onClick={() =>
                          update((d) => {
                            const r = d.session.exerciseSessions.find(
                              (e) => e.id === row.id,
                            )!;
                            r.sets = r.sets.filter((x) => x.id !== s.id);
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="text-accent mt-2"
                  onClick={() =>
                    update((d) => {
                      const r = d.session.exerciseSessions.find(
                        (e) => e.id === row.id,
                      )!;
                      r.sets.push(
                        blankHistorySet(
                          r.id,
                          Math.max(0, ...r.sets.map((s) => s.setNumber)) + 1,
                        ),
                      );
                    })
                  }
                >
                  Agregar serie
                </button>
                <div className="flex flex-wrap gap-3 mt-3 border-t border-border-soft pt-2">
                  <button
                    className="text-accent"
                    onClick={() => {
                      setPicker(row.id);
                      setChoice("");
                    }}
                  >
                    Sustituir ejercicio
                  </button>
                  <button
                    className="text-accent"
                    onClick={() => {
                      const populated = row.sets.some((s) =>
                        (["weight", "reps", "rir"] as Field[]).some(
                          (f) => textValue(s, f, raw).trim() !== "",
                        ),
                      );
                      if (populated) setOmit(row.id);
                      else omitRow(row.id);
                    }}
                  >
                    Omitir ejercicio
                  </button>
                </div>
              </>
            ) : (
              <RecordedSets sets={row.sets} />
            )}
            {editing ? (
              <label className="block mt-3 text-sm text-text-secondary">
                Nota del ejercicio
                <textarea
                  aria-label={`Nota de ${row.exercise.name}`}
                  value={row.note ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    update((d) => {
                      d.session.exerciseSessions.find(
                        (x) => x.id === row.id,
                      )!.note = value || null;
                    });
                  }}
                  className="w-full mt-2 bg-surface-2 rounded-lg p-3 text-text"
                />
              </label>
            ) : (
              row.note && (
                <p className="text-sm whitespace-pre-wrap mt-3 text-text-secondary">
                  {row.note}
                </p>
              )
            )}
          </section>
        ))}
        {editing && (
          <button
            className="panel w-full text-accent"
            onClick={() => {
              setPicker("add");
              setChoice("");
            }}
          >
            Agregar ejercicio
          </button>
        )}
        <section className="panel">
          <h2 className="font-semibold mb-2">Nota de la sesión</h2>
          {editing ? (
            <textarea
              aria-label="Nota de la sesión"
              value={session.note ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                update((d) => {
                  d.session.note = value || null;
                });
              }}
              rows={3}
              className="w-full bg-surface-2 rounded-lg p-3"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-text-secondary">
              {session.note || "Sin nota"}
            </p>
          )}
        </section>
      </fieldset>
      {!editing && (
        <div className="mt-6 flex flex-col gap-3">
          {session.finishedAt !== null ? (
            <button
              className="w-full rounded-xl bg-accent text-bg font-semibold py-3"
              onClick={begin}
            >
              Editar entrenamiento
            </button>
          ) : (
            <Link
              className="panel text-accent"
              href={`/dia/${session.routineDay}`}
            >
              Continuar entrenamiento
            </Link>
          )}
          {!confirmDelete ? (
            <button
              className="text-danger py-3 border border-danger/40 rounded-xl"
              onClick={() => setConfirmDelete(true)}
            >
              Eliminar entrenamiento
            </button>
          ) : (
            <div className="panel">
              <p className="text-sm">
                ¿Eliminar este entrenamiento y todas sus series?
              </p>
              <div className="flex gap-4 mt-3">
                <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Cancelar
                </button>
                <button
                  disabled={busy}
                  className="text-danger"
                  onClick={async () => {
                    if (saving.current) return;
                    saving.current = true;
                    setBusy(true);
                    try {
                      await waitForWrites();
                      await deleteSession(id);
                      onDeleted();
                    } catch {
                      setError(
                        "No se pudo eliminar el entrenamiento. Reintentá.",
                      );
                    } finally {
                      saving.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  Sí, eliminar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {editing && (
        <div className="fixed bottom-0 inset-x-0 mx-auto max-w-[760px] z-30 bg-bg/95 border-t border-border px-4 py-3 safe-bottom flex gap-3">
          <button
            disabled={busy}
            className="flex-1 rounded-xl border border-border py-3"
            onClick={cancel}
          >
            Cancelar edición
          </button>
          <button
            disabled={busy || !!picker || !!omit}
            className="flex-1 bg-accent text-bg rounded-xl font-semibold py-3"
            onClick={save}
          >
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      )}
      {picker && (
        <Modal titleId="history-picker-title" onDismiss={() => setPicker(null)}>
          <h2 id="history-picker-title" className="font-semibold">
            {picker === "add" ? "Agregar ejercicio" : "Sustituir ejercicio"}
          </h2>
          <p className="text-sm text-text-secondary my-3">
            Si el original tiene datos, se conserva y se agrega el sustituto.
            Podés omitir el original con confirmación.
          </p>
          <select
            aria-label="Ejercicio a seleccionar"
            className="w-full p-3 rounded-lg bg-surface-2"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Elegí un ejercicio</option>
            {catalog?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <div className="flex gap-4 mt-3">
            <button onClick={() => setPicker(null)}>Cancelar</button>
            <button
              disabled={!choice}
              className="text-accent"
              onClick={chooseExercise}
            >
              Confirmar ejercicio
            </button>
          </div>
        </Modal>
      )}
      {omit && (
        <Modal titleId="omit-title" onDismiss={() => setOmit(null)}>
          <h2 id="omit-title" className="font-semibold">
            ¿Omitir este ejercicio?
          </h2>
          <p className="text-sm my-3">
            Al guardar se quitarán sus series de este entrenamiento y de las
            estadísticas. Los cambios siguen pendientes hasta “Guardar cambios”.
          </p>
          <button onClick={() => setOmit(null)}>Conservar ejercicio</button>
          <button className="text-danger ml-3" onClick={() => omitRow(omit)}>
            Sí, omitir ejercicio
          </button>
        </Modal>
      )}
    </main>
  );
}
