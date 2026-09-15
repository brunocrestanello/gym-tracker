"use client";

import { useRef } from "react";
import { SetEntry } from "@/lib/types";
import { updateSet, removeSet } from "@/lib/repo";
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

  async function handleWeight(v: string) {
    const parsed = v.trim() === "" ? null : parseFloat(v.replace(",", "."));
    await updateSet(set.id, { weight: parsed === null || isNaN(parsed) ? null : parsed });
    onChanged();
  }
  async function handleReps(v: string) {
    const parsed = v.trim() === "" ? null : parseInt(v, 10);
    await updateSet(set.id, { reps: parsed === null || isNaN(parsed) ? null : parsed });
    onChanged();
  }
  async function handleRir(v: string) {
    const parsed = v.trim() === "" ? null : parseFloat(v.replace(",", "."));
    await updateSet(set.id, { rir: parsed === null || isNaN(parsed) ? null : parsed });
    onChanged();
  }

  return (
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
          onChange={(e) => handleWeight(e.target.value)}
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
        onChange={(e) => handleReps(e.target.value)}
        className="w-full rounded-lg bg-surface-2 border border-border-soft px-2.5 py-2.5 text-center font-mono tabular text-base text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
      />

      <input
        ref={rirRef}
        key={`${set.id}-i`}
        type="text"
        inputMode="numeric"
        defaultValue={set.rir ?? ""}
        placeholder="RIR"
        onChange={(e) => handleRir(e.target.value)}
        className="w-full rounded-lg bg-surface-2 border border-border-soft px-2.5 py-2.5 text-center font-mono tabular text-base text-text placeholder:text-text-tertiary focus:outline-none focus:border-accent"
      />

      {canDelete ? (
        <button
          onClick={async () => {
            await removeSet(set.id);
            onChanged();
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
  );
}
