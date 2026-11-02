"use client";
import { use } from "react";
import { useRouter } from "next/navigation";
import DayWorkout from "@/components/DayWorkout";
import { RoutineDay } from "@/lib/types";

export default function DayPage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const { day } = use(params);
  const router = useRouter();
  const parsed = Number(day);
  if (![1, 2, 3, 4].includes(parsed))
    return (
      <p role="alert" className="p-6">
        Día inválido
      </p>
    );
  return (
    <DayWorkout
      key={day}
      day={parsed as RoutineDay}
      onFinished={(id, summary) => {
        const q = new URLSearchParams({
          completed: "1",
          exercises: String(summary.exerciseCount),
          sets: String(summary.setCount),
          volume: String(Math.round(summary.totalVolume)),
          duration: String(summary.durationSeconds),
          prs: String(summary.prCount),
        });
        router.push(`/historial/${id}?${q}`);
      }}
    />
  );
}
