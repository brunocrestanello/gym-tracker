"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import {
  changeDraft,
  getExerciseCatalog,
  hydrateDraft,
  openDay,
  saveDraftSet,
} from "@/lib/workouts";
import { FinishSummary, finishSession, getActiveSession } from "@/lib/repo";
import { waitForWrites } from "@/lib/persistence";
import { RoutineDay } from "@/lib/types";
import ExerciseBlock from "./ExerciseBlock";
import Modal from "./Modal";

export default function DayWorkout({
  day,
  onFinished,
}: {
  day: RoutineDay;
  onFinished: (id: string, summary: FinishSummary) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const finishing = useRef(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const draft = useLiveQuery(async () => {
    const d = await db.workoutDrafts.get(`day:${day}`);
    return d ? hydrateDraft(d) : undefined;
  }, [day]);
  const active = useLiveQuery(getActiveSession, []);
  const catalog = useLiveQuery(getExerciseCatalog, []);
  useEffect(() => {
    let mounted = true;
    openDay(day).catch((e) => {
      if (mounted)
        setError(e instanceof Error ? e.message : "No se pudo abrir el día");
    });
    return () => {
      mounted = false;
    };
  }, [day]);
  async function act(change: Parameters<typeof changeDraft>[2]) {
    if (!draft) return;
    setBusy(true);
    try {
      await waitForWrites();
      await changeDraft(draft.id, draft.token, change);
      setError(null);
      setPicker(null);
      setChoice("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el cambio");
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (!draft?.sessionId || finishing.current) return;
    finishing.current = true;
    setBusy(true);
    try {
      await waitForWrites();
      const result = await finishSession(draft.sessionId);
      onFinished(draft.sessionId, result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo finalizar");
      setBusy(false);
      finishing.current = false;
    }
  }
  if (!draft)
    return (
      <div className="p-6">
        {error ? (
          <p role="alert">
            {error}{" "}
            <button onClick={() => location.reload()}>Reintentar</button>
          </p>
        ) : (
          "Cargando plantilla…"
        )}
      </div>
    );
  return (
    <div className="min-h-dvh pb-32">
      <header className="safe-top sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border-soft px-4 py-3 flex items-center gap-3">
        <Link href="/" aria-label="Volver al inicio">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-base font-semibold">
          Día {day} · {draft.sessionId ? "En curso" : "Plantilla"}
        </h1>
      </header>
      {!draft.sessionId && (
        <p className="px-4 pt-3 text-xs text-text-secondary">
          El entrenamiento empieza cuando registrás el primer dato de una serie.
          Los cambios a esta plantilla se guardan solo para este entrenamiento.
        </p>
      )}
      {active && active.routineDay !== day && (
        <p className="p-4 text-sm">
          Hay un entrenamiento en curso del Día {active.routineDay}.{" "}
          <Link className="text-accent" href={`/dia/${active.routineDay}`}>
            Continuar ese entrenamiento
          </Link>
        </p>
      )}
      {error && !confirmFinish && (
        <p role="alert" className="p-4 text-sm text-danger">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="px-4 pt-4 flex flex-col gap-3">
        {draft.exercises.map((slot, index) => {
          const group = slot.exercise.supersetGroup;
          const prev = draft.exercises[index - 1],
            next = draft.exercises[index + 1];
          const position = !group
            ? "single"
            : prev?.exercise.supersetGroup !== group
              ? "first"
              : next?.exercise.supersetGroup !== group
                ? "last"
                : "middle";
          return (
            <section
              key={`${draft.token}:${slot.id}`}
              aria-label={slot.exercise.name}
            >
              {slot.status === "omitted" ? (
                <div className="rounded-xl border border-border-soft p-4 text-text-secondary">
                  <p>{slot.exercise.name} · Omitido</p>
                  <button
                    className="text-accent text-sm"
                    onClick={() => act({ type: "restore", slotId: slot.id })}
                  >
                    Reactivar ejercicio
                  </button>
                </div>
              ) : (
                <ExerciseBlock
                  exerciseSessionId={slot.id}
                  exercise={slot.exercise}
                  workoutSessionId={draft.sessionId ?? ""}
                  supersetPosition={position}
                  entries={slot.sets}
                  onSave={(setId, patch) =>
                    saveDraftSet(draft.id, draft.token, slot.id, setId, patch)
                  }
                  onDelete={(setId) =>
                    changeDraft(draft.id, draft.token, {
                      type: "removeSet",
                      slotId: slot.id,
                      setId,
                    })
                  }
                  onAdd={() => act({ type: "addSet", slotId: slot.id })}
                />
              )}
              {slot.origin === "substitution" && (
                <p className="text-xs text-text-secondary mt-1">
                  Sustitución de {slot.plannedExercise?.name}. Se conservan los
                  registros anteriores.
                </p>
              )}
              {slot.origin === "additional" && (
                <p className="text-xs text-text-secondary mt-1">
                  Ejercicio adicional · Día original {day}
                </p>
              )}
              {slot.status !== "omitted" && (
                <div className="flex gap-4 py-2 text-xs text-accent">
                  <button
                    onClick={() => {
                      setPicker(slot.id);
                      setChoice("");
                    }}
                  >
                    Sustituir ejercicio
                  </button>
                  <button
                    onClick={() => act({ type: "omit", slotId: slot.id })}
                  >
                    Omitir ejercicio
                  </button>
                </div>
              )}
            </section>
          );
        })}
        <button
          className="py-3 rounded-xl bg-surface-2 text-accent"
          onClick={() => {
            setPicker("add");
            setChoice("");
          }}
        >
          Agregar ejercicio
        </button>
      </fieldset>
      {picker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exercise-picker-title"
            className="w-full max-w-sm p-5 rounded-xl bg-surface"
          >
            <h2 id="exercise-picker-title">
              {picker === "add" ? "Agregar ejercicio" : "Sustituir ejercicio"}
            </h2>
            <label className="block my-3 text-sm">
              Ejercicio
              <select
                aria-label="Ejercicio a seleccionar"
                value={choice}
                disabled={busy}
                onChange={(e) => setChoice(e.target.value)}
                className="block w-full bg-surface-2 p-2 mt-2"
              >
                <option value="">Elegí un ejercicio</option>
                {catalog?.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-text-secondary mb-3">
              El cambio afecta solo este entrenamiento. Si ya hay datos, el
              ejercicio anterior se conserva.
            </p>
            <div className="flex gap-4">
              <button disabled={busy} onClick={() => setPicker(null)}>
                Cancelar
              </button>
              <button
                disabled={busy || !choice}
                className="text-accent"
                onClick={() =>
                  act(
                    picker === "add"
                      ? { type: "add", exerciseId: choice }
                      : {
                          type: "substitute",
                          slotId: picker,
                          exerciseId: choice,
                        },
                  )
                }
              >
                Confirmar ejercicio
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="fixed bottom-0 left-0 right-0 mx-auto max-w-[760px] z-30 safe-bottom px-4 pb-4 pt-6 bg-gradient-to-t from-bg via-bg/95 to-transparent">
        <button
          disabled={busy || !draft.sessionId}
          onClick={() => setConfirmFinish(true)}
          className="w-full py-3.5 rounded-xl bg-accent text-bg font-semibold disabled:opacity-60"
        >
          {busy
            ? "Guardando…"
            : draft.sessionId
              ? "FINALIZAR ENTRENAMIENTO"
              : "REGISTRÁ UNA SERIE PARA EMPEZAR"}
        </button>
      </div>
      {confirmFinish && (
        <Modal
          titleId="finish-title"
          busy={busy}
          onDismiss={() => setConfirmFinish(false)}
        >
          <h2 id="finish-title" className="font-semibold">
            ¿Finalizar el entrenamiento?
          </h2>
          <p className="text-sm text-text-secondary my-3">
            Se guardarán las series pendientes y el entrenamiento quedará en
            solo lectura. Después podrás usar “Editar entrenamiento”.
          </p>
          {error && (
            <p role="alert" className="text-sm mb-3">
              {error}
            </p>
          )}
          <div className="flex gap-4">
            <button disabled={busy} onClick={() => setConfirmFinish(false)}>
              Seguir entrenando
            </button>
            <button
              disabled={busy}
              className="text-accent font-semibold"
              onClick={finish}
            >
              {busy ? "Guardando…" : "Sí, finalizar entrenamiento"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
