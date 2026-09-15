import { SetEntry } from "./types";

/** e1RM estimado con fórmula de Epley. Solo tiene sentido si hay peso registrado. */
export function e1rm(weight: number, reps: number): number {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

export function setVolume(set: Pick<SetEntry, "weight" | "reps">): number {
  if (!set.weight || !set.reps) return 0;
  return set.weight * set.reps;
}

export function sumVolume(sets: Pick<SetEntry, "weight" | "reps">[]): number {
  return sets.reduce((acc, s) => acc + setVolume(s), 0);
}

/** Mejor e1RM entre las series válidas (con peso) de una sesión de ejercicio. */
export function bestE1rm(sets: Pick<SetEntry, "weight" | "reps">[]): number {
  let best = 0;
  for (const s of sets) {
    if (!s.weight || !s.reps) continue;
    const v = e1rm(s.weight, s.reps);
    if (v > best) best = v;
  }
  return best;
}

export function maxWeight(sets: Pick<SetEntry, "weight">[]): number {
  let best = 0;
  for (const s of sets) {
    if (s.weight && s.weight > best) best = s.weight;
  }
  return best;
}

export function maxReps(sets: Pick<SetEntry, "reps">[]): number {
  let best = 0;
  for (const s of sets) {
    if (s.reps && s.reps > best) best = s.reps;
  }
  return best;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
