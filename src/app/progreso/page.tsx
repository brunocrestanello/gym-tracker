"use client";

import Link from "next/link";
import { exercisesForDay } from "@/data/routine";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ProgresoPage() {
  return (
    <div className="min-h-dvh pb-10">
      <header className="safe-top sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border-soft px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-text-secondary active:text-text">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-base font-semibold">Progreso</h1>
      </header>

      <p className="px-4 pt-4 pb-2 text-xs text-text-tertiary">
        Elegí un ejercicio para ver su evolución.
      </p>

      {[1, 2, 3, 4].map((day) => (
        <div key={day} className="mb-4">
          <p className="px-4 text-[11px] uppercase tracking-wide text-text-tertiary mb-1.5">
            Día {day}
          </p>
          <div className="flex flex-col">
            {exercisesForDay(day as 1 | 2 | 3 | 4).map((ex) => (
              <Link
                key={ex.id}
                href={`/ejercicio/${ex.id}`}
                className="flex items-center justify-between px-4 py-3 border-b border-border-soft active:bg-surface"
              >
                <span className="text-sm text-text">{ex.name}</span>
                <ChevronRight size={16} className="text-text-tertiary" />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
