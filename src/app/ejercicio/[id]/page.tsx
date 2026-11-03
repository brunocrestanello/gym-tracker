"use client";
import { use } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getExerciseCatalog } from "@/lib/workouts";
import ExerciseInsights from "@/components/ExerciseInsights";
export default function ExercisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const catalog = useLiveQuery(getExerciseCatalog, []);
  const exercise = catalog?.find((e) => e.id === id);
  return (
    <main className="px-5 py-5 pb-12">
      <Link href="/progreso" className="back-link">
        ← Progreso
      </Link>
      <p className="eyebrow mt-5">Rendimiento real</p>
      <h1 className="page-title mb-6">
        {exercise?.name ?? "Historial del ejercicio"}
      </h1>
      <ExerciseInsights exerciseId={id} />
    </main>
  );
}
