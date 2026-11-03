"use client";
import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getExerciseCatalog } from "@/lib/workouts";
import { db } from "@/lib/db";
export default function ProgressPage() {
  const [search, setSearch] = useState("");
  const catalog = useLiveQuery(async () => {
    try {
      const exercises = await getExerciseCatalog();
      // Include archived snapshot identities even if a future catalog omits them.
      for (const snapshot of await db.exerciseSnapshots.toArray())
        if (!exercises.some((e) => e.id === snapshot.exercise.id))
          exercises.push(snapshot.exercise);
      return { exercises, error: false };
    } catch {
      return { exercises: [], error: true };
    }
  }, []);
  const filtered =
    catalog?.exercises.filter((e) =>
      e.name.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")),
    ) ?? [];
  return (
    <main className="px-5 py-5 pb-12">
      <Link href="/" className="back-link">
        ← Inicio
      </Link>
      <p className="eyebrow mt-4">Cada serie cuenta</p>
      <h1 className="page-title mt-2">Tu evolución.</h1>
      <p className="text-sm text-text-secondary mt-3 mb-6">
        Peso, repeticiones y récords. Tu historial acompaña al ejercicio, aunque
        cambie de día.
      </p>
      <label className="block mb-5">
        <span className="sr-only">Buscar ejercicio</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar un ejercicio"
          className="w-full rounded-2xl bg-surface border border-border px-4 py-3"
        />
      </label>
      {catalog?.error && (
        <p role="alert">No se pudo leer el catálogo. Reintentá recargando.</p>
      )}
      <div className="space-y-2">
        {filtered.map((e) => (
          <Link
            href={`/ejercicio/${e.id}`}
            key={e.id}
            className="panel flex justify-between items-center gap-3 min-h-16"
          >
            <span className="text-sm font-medium">{e.name}</span>
            <span className="text-accent" aria-hidden="true">
              ↗
            </span>
          </Link>
        ))}
        {catalog && !filtered.length && !catalog.error && (
          <p className="empty-state">No se encontraron ejercicios.</p>
        )}
      </div>
    </main>
  );
}
