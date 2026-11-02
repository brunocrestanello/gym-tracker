"use client";

import { useRef, useState } from "react";
import { SetEntry } from "@/lib/types";
import { updateSet, removeSet } from "@/lib/repo";
import { persist, forgetDeletedSetFailures } from "@/lib/persistence";
import { Trash2 } from "lucide-react";

export default function SetRow({
  set,
  placeholderWeight,
  canDelete,
  onChanged,
  onSave,
  onDelete,
}: {
  set: SetEntry;
  placeholderWeight: number | null;
  canDelete: boolean;
  onChanged: () => void;
  onSave?: (
    setId: string,
    patch: Partial<Pick<SetEntry, "weight" | "reps" | "rir">>,
  ) => Promise<void>;
  onDelete?: (setId: string) => Promise<void>;
}) {
  const weightRef = useRef<HTMLInputElement>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const rirRef = useRef<HTMLInputElement>(null);

  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [status, setStatus] = useState("Guardado");
  const revision = useRef(0);
  const fieldRevision = useRef<
    Partial<Record<"weight" | "reps" | "rir", number>>
  >({});
  const inFlight = useRef(0);
  const drafts = useRef<Partial<Record<"weight" | "reps" | "rir", string>>>({});

  async function save(field: "weight" | "reps" | "rir", value: string) {
    if (deletingRef.current) return;
    drafts.current[field] = value;
    const current = ++revision.current;
    fieldRevision.current[field] = current;
    inFlight.current++;
    setStatus("Guardando…");
    try {
      await persist(
        `${set.id}:${field}`,
        async () => {
          const normalized = value.trim().replace(",", ".");
          if (normalized !== "" && !/^\d+(\.\d+)?$/.test(normalized))
            throw new Error("Valor inválido");
          const parsed = normalized === "" ? null : Number(normalized);
          if (field === "reps" && parsed !== null && !Number.isInteger(parsed))
            throw new Error("Repeticiones inválidas");
          await (onSave ?? updateSet)(set.id, { [field]: parsed });
        },
        `set:${set.id}`,
      );
      if (fieldRevision.current[field] === current)
        delete drafts.current[field];
      onChanged();
    } catch {
      // Preserve the field draft; a newer write may still succeed.
    } finally {
      inFlight.current--;
      if (!deletingRef.current)
        setStatus(
          inFlight.current
            ? "Guardando…"
            : Object.keys(drafts.current).length
              ? "No se guardó. Revisá los valores y reintentá."
              : "Guardado",
        );
    }
  }

  return (
    <div>
      <fieldset
        disabled={deleting}
        className="grid grid-cols-[24px_1fr_1fr_1fr_44px] items-center gap-2 py-1.5"
      >
        <div className="text-sm text-text-tertiary tabular text-center">
          {set.setNumber}
        </div>

        <div className="relative">
          <input
            aria-label={`Peso de serie ${set.setNumber}`}
            ref={weightRef}
            key={`${set.id}-w`}
            type="text"
            inputMode="decimal"
            defaultValue={set.weight ?? ""}
            placeholder={
              placeholderWeight != null ? String(placeholderWeight) : "kg"
            }
            onChange={(e) => save("weight", e.target.value)}
            className="w-full rounded-lg bg-surface-2 border border-border-soft px-2.5 py-2.5 text-center font-mono tabular text-base text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
        </div>

        <input
          aria-label={`Repeticiones de serie ${set.setNumber}`}
          ref={repsRef}
          key={`${set.id}-r`}
          type="text"
          inputMode="numeric"
          defaultValue={set.reps ?? ""}
          placeholder="reps"
          onChange={(e) => save("reps", e.target.value)}
          className="w-full rounded-lg bg-surface-2 border border-border-soft px-2.5 py-2.5 text-center font-mono tabular text-base text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
        />

        <input
          aria-label={`RIR de serie ${set.setNumber}`}
          ref={rirRef}
          key={`${set.id}-i`}
          type="text"
          inputMode="numeric"
          defaultValue={set.rir ?? ""}
          placeholder="RIR"
          onChange={(e) => save("rir", e.target.value)}
          className="w-full rounded-lg bg-surface-2 border border-border-soft px-2.5 py-2.5 text-center font-mono tabular text-base text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
        />

        {canDelete ? (
          <button
            onClick={async () => {
              if (deletingRef.current) return;
              deletingRef.current = true;
              setDeleting(true);
              setDeleteError(false);
              setStatus("Eliminando…");
              try {
                if (onDelete)
                  await persist(
                    `${set.id}:delete`,
                    async () => {
                      await onDelete(set.id);
                      forgetDeletedSetFailures(set.id);
                    },
                    `set:${set.id}`,
                  );
                else await removeSet(set.id);
                drafts.current = {};
                onChanged();
              } catch {
                setDeleteError(true);
                setStatus(
                  Object.keys(drafts.current).length
                    ? "No se guardó. Revisá los valores y reintentá."
                    : "Guardado",
                );
                deletingRef.current = false;
                setDeleting(false);
              }
            }}
            className="h-11 w-11 flex items-center justify-center text-text-tertiary active:text-danger"
            aria-label="Eliminar serie"
          >
            <Trash2 size={15} />
          </button>
        ) : (
          <div />
        )}
      </fieldset>
      {deleteError && (
        <p role="alert" className="text-xs text-text-secondary">
          No se pudo eliminar la serie. Reintentá con el botón de eliminar antes
          de finalizar.
        </p>
      )}
      <div
        className="text-xs text-text-secondary"
        role="status"
        aria-live="polite"
      >
        {status}
        {status.startsWith("No se guardó") && (
          <button
            type="button"
            className="ml-2 text-accent"
            onClick={() => {
              for (const [field, value] of Object.entries(drafts.current))
                void save(field as "weight" | "reps" | "rir", value!);
            }}
          >
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}
