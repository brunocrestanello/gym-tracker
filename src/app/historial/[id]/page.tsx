"use client";
import { use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkoutHistory from "@/components/WorkoutHistory";
export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  return (
    <WorkoutHistory
      key={id}
      id={id}
      completed={search.get("completed") === "1"}
      onDeleted={() => router.push("/historial")}
    />
  );
}
