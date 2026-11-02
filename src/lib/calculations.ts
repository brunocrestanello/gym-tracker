import { SetEntry } from "./types";

/** A captured zero load is valid; empty values and zero repetitions are not completed sets. */
export function isValidSet(s: Pick<SetEntry, "weight" | "reps">): boolean {
  return (
    typeof s.weight === "number" &&
    Number.isFinite(s.weight) &&
    s.weight >= 0 &&
    typeof s.reps === "number" &&
    Number.isInteger(s.reps) &&
    s.reps > 0
  );
}

/** e1RM estimado con fórmula de Epley. Solo tiene sentido si hay peso registrado. */
export function e1rm(weight: number, reps: number): number {
  if (!isValidSet({ weight, reps }) || weight === 0) return 0;
  return weight * (1 + reps / 30);
}

export function setVolume(set: Pick<SetEntry, "weight" | "reps">): number {
  if (!isValidSet(set)) return 0;
  return set.weight! * set.reps!;
}

export function sumVolume(sets: Pick<SetEntry, "weight" | "reps">[]): number {
  return sets.reduce((acc, s) => acc + setVolume(s), 0);
}

/** Mejor e1RM entre las series válidas (con peso) de una sesión de ejercicio. */
export function bestE1rm(sets: Pick<SetEntry, "weight" | "reps">[]): number {
  let best = 0;
  for (const s of sets) {
    if (!isValidSet(s)) continue;
    const v = e1rm(s.weight!, s.reps!);
    if (v > best) best = v;
  }
  return best;
}

export function maxWeight(sets: Pick<SetEntry, "weight" | "reps">[]): number {
  let best = 0;
  for (const s of sets) {
    if (isValidSet(s) && s.weight! > best) best = s.weight!;
  }
  return best;
}

export function maxReps(sets: Pick<SetEntry, "weight" | "reps">[]): number {
  let best = 0;
  for (const s of sets) {
    if (isValidSet(s) && s.reps! > best) best = s.reps!;
  }
  return best;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
