"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useLiveQuery } from "dexie-react-hooks";
import { getExerciseCatalog } from "@/lib/workouts";
import { isValidSet } from "@/lib/calculations";
import { getExerciseHistory } from "@/lib/repo";
import { bestE1rm, maxReps as maxRepsFn, maxWeight as maxWeightFn, round1, sumVolume } from "@/lib/calculations";
import { formatDateShort } from "@/lib/dates";
import { WorkoutSession, SetEntry } from "@/lib/types";
import { ChevronLeft } from "lucide-react";

type Metric = "maxWeight" | "e1rm" | "volume" | "maxReps";
type Period = "1m" | "3m" | "6m" | "all";

const METRIC_LABEL: Record<Metric, string> = {
  maxWeight: "Peso máximo",
  e1rm: "e1RM estimado",
  volume: "Volumen total",
  maxReps: "Máx. repeticiones",
};

const PERIOD_LABEL: Record<Period, string> = {
  "1m": "1 mes",
  "3m": "3 meses",
  "6m": "6 meses",
  all: "Todo",
};

const PERIOD_DAYS: Record<Period, number | null> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  all: null,
};

export default function ExerciseHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const catalog=useLiveQuery(getExerciseCatalog,[]);
  const exercise=catalog?.find(ex=>ex.id===id);
  const [error, setError] = useState(false);
  const [history, setHistory] = useState<{ session: WorkoutSession; sets: SetEntry[] }[]>([]);
  const [metric, setMetric] = useState<Metric>("maxWeight");
  const [period, setPeriod] = useState<Period>("3m");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    getExerciseHistory(id).then(setHistory).catch(() => setError(true));
  }, [id]);

  const chartData = useMemo(() => {
    const days = PERIOD_DAYS[period];
    const cutoff = days ? now - days * 86400000 : null;
    return history
      .filter((h) => !cutoff || new Date(h.session.date).getTime() >= cutoff)
      .map((h) => {
        const validSets = h.sets.filter(isValidSet);
        let value = 0;
        if (metric === "maxWeight") value = maxWeightFn(validSets);
        if (metric === "e1rm") value = round1(bestE1rm(validSets));
        if (metric === "volume") value = Math.round(sumVolume(validSets));
        if (metric === "maxReps") value = maxRepsFn(validSets);
        return { date: h.session.date, label: formatDateShort(h.session.date), value };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [history, metric, period, now]);

  const insight = useMemo(() => {
    const days = 30;
    const cutoff = now - days * 86400000;
    const recent = history.filter((h) => new Date(h.session.date).getTime() >= cutoff);
    if (recent.length < 2) return null;
    const sorted = [...recent].sort((a, b) => (a.session.date < b.session.date ? -1 : 1));
    const first = bestE1rm(sorted[0].sets.filter(isValidSet));
    const last = bestE1rm(
      sorted[sorted.length - 1].sets.filter(isValidSet)
    );
    if (!first || !last) return null;
    const pct = ((last - first) / first) * 100;
    if (Math.abs(pct) < 2) return "Sin cambio significativo en los últimos 30 días";
    return `${pct > 0 ? "\u2191" : "\u2193"} e1RM ${pct > 0 ? "+" : ""}${round1(pct)}% en los últimos 30 días`;
  }, [history, now]);

  const lastFour = useMemo(() => history.slice(0, 4).reverse(), [history]);

  if(error)return <p role="alert" className="p-6">No se pudo leer el historial. <button onClick={()=>location.reload()}>Reintentar</button></p>;
  if(!catalog)return <p className="p-6">Cargando ejercicio…</p>;
  if (!exercise) {
  return (
      <div className="min-h-dvh flex items-center justify-center text-text-secondary text-sm">
        Ejercicio no encontrado.
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-10">
      <header className="safe-top sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border-soft px-4 py-3 flex items-center gap-3">
        <Link href="/progreso" className="text-text-secondary active:text-text">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-base font-semibold truncate">{exercise.name}</h1>
      </header>

      <div className="px-4 pt-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs border ${
                metric === m
                  ? "bg-accent-soft border-accent/40 text-accent-strong"
                  : "bg-surface-2 border-border-soft text-text-secondary"
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`shrink-0 px-3 py-1 rounded-lg text-[11px] border ${
                period === p
                  ? "border-accent/40 text-accent-strong"
                  : "border-border-soft text-text-tertiary"
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="h-56 mt-2 -ml-2">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-soft)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 10 }}
                  axisLine={{ stroke: "var(--color-border-soft)" }}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--color-text-secondary)" }}
                  itemStyle={{ color: "var(--color-accent-strong)" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--color-accent)" }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-text-tertiary">
              Sin datos suficientes en este período.
            </div>
          )}
        </div>

        {insight && (
          <div className="rounded-xl bg-surface-2/60 border border-border-soft px-3 py-2 mt-1 mb-2">
            <p className="text-xs text-text-secondary">{insight}</p>
          </div>
        )}

        {lastFour.length >= 2 && (
          <div className="rounded-xl bg-surface-2/60 border border-border-soft px-3 py-2 mb-4">
            <p className="text-[11px] text-text-tertiary mb-1">Últimas {lastFour.length} sesiones</p>
            <p className="text-xs text-text-secondary tabular">
              Peso máximo: {lastFour.map((h) => maxWeightFn(h.sets.filter(isValidSet))).join(" \u2192 ")} kg
            </p>
            <p className="text-xs text-text-secondary tabular">
              e1RM:{" "}
              {lastFour
                .map((h) => round1(bestE1rm(h.sets.filter(isValidSet))))
                .join(" \u2192 ")}{" "}
              kg
            </p>
          </div>
        )}
      </div>

      <div className="px-4">
        <p className="text-[11px] uppercase tracking-wide text-text-tertiary mb-2">Historial</p>
        <div className="flex flex-col gap-3">
          {history.map((h) => (
            <div key={h.session.id} className="rounded-xl bg-surface border border-border-soft px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-text-secondary">{formatDateShort(h.session.date)}</span>
                <span className="text-[11px] text-text-tertiary">Día {h.session.routineDay}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {h.sets
                  .filter((s) => s.weight != null || s.reps != null)
                  .map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5 text-sm font-mono tabular text-text">
                      <span>
                        {s.weight ?? "\u2014"} × {s.reps ?? "\u2014"}
                      </span>
                      {s.isPr && isValidSet(s) && (
                        <span className="text-[10px] font-semibold text-brass bg-brass-soft px-1.5 py-0.5 rounded-full leading-none">
                          PR
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-8">Sin registros anteriores</p>
          )}
        </div>
      </div>
    </div>
  );
}
