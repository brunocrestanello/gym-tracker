"use client";

import { useRef, useState } from "react";
import { SetEntry } from "@/lib/types";
import { updateSet, removeSet } from "@/lib/repo";
import { persist } from "@/lib/persistence";
import { Trash2 } from "lucide-react";

export default function SetRow({
  set,
  placeholderWeight,
  canDelete,
  onChanged,
}: {
  set: SetEntry;
  placeholderWeight: number | null;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const weightRef = useRef<HTMLInputElement>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const rirRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState("Guardado");
  const revision = useRef(0);
  const fieldRevision = useRef<Partial<Record<"weight" | "reps" | "rir", number>>>({});
  const inFlight = useRef(0);
  const drafts = useRef<Partial<Record<"weight" | "reps" | "rir", string>>>({});

  async function save(field: "weight" | "reps" | "rir", value: string) {
    drafts.current[field] = value;
    const current = ++revision.current;
    fieldRevision.current[field] = current;
    inFlight.current++;
    setStatus("Guardando…");
    try {
      await persist(`${set.id}:${field}`, async () => {
        const normalized = value.trim().replace(",", ".");
        if (normalized !== "" && !/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Valor inválido");
        const parsed = normalized === "" ? null : Number(normalized);
        if (field === "reps" && parsed !== null && !Number.isInteger(parsed)) throw new Error("Repeticiones inválidas");
        await updateSet(set.id, { [field]: parsed });
      });
      if (fieldRevision.current[field] === current) delete drafts.current[field];
      onChanged();
    } catch {
      // Preserve the field draft; a newer write may still succeed.
    } finally {
      inFlight.current--;
      setStatus(inFlight.current ? "Guardando…" : Object.keys(drafts.current).length ? "No se guardó. Revisá los valores y reintentá." : "Guardado");
    }
  }

  return (
    <div>
      <div className="grid grid-cols-[28px_1fr_1fr_1fr_28px] items-center gap-2 py-1.5">
        <div className="text-sm text-text-tertiary tabular text-center">{set.setNumber}</div>

        <div className="relative">
          <input
            ref={weightRef}
            key={`${set.id}-w`}
            type="text"
            inputMode="decimal"
            defaultValue={set.weight ?? ""}
            placeholder={placeholderWeight != null ? String(placeholderWeight) : "kg"}
            onChange={(e) => save("weight", e.target.value)}
            className="w-full rounded-lg bg-surface-2 border border-border-soft px-2.5 py-2.5 text-center font-mono tabular text-base text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
          {set.isPr && (
            <span className="absolute -top-2 -right-1.5 text-[10px] font-semibold text-brass bg-brass-soft px-1.5 py-0.5 rounded-full leading-none">
              PR
            </span>
          )}
        </div>

        <input
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
              try {
                await removeSet(set.id);
                // A deliberate deletion also resolves this row's unsaved field drafts.
                await Promise.all((["weight", "reps", "rir"] as const).map(field => persist(`${set.id}:${field}`, async () => {})));
                onChanged();
              } catch { setStatus("No se pudo eliminar la serie. Reintentá."); }
            }}
            className="h-7 w-7 flex items-center justify-center text-text-tertiary active:text-danger"
            aria-label="Eliminar serie"
          >
            <Trash2 size={15} />
          </button>
        ) : (
          <div />
        )}
      </div>
      <div className="text-xs text-text-secondary" role="status" aria-live="polite">
        {status}
        {status.startsWith("No se guardó") && <button type="button" className="ml-2 text-accent" onClick={() => {
          for (const [field, value] of Object.entries(drafts.current)) void save(field as "weight" | "reps" | "rir", value!);
        }}>Reintentar</button>}
      </div>
    </div>
  );
}
