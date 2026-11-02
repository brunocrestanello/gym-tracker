"use client";
import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  readExerciseTrainings,
  exerciseInsights,
  summarizeSets,
} from "@/lib/insights";
import { formatDateShort } from "@/lib/dates";
import { RecordedSets } from "./ExerciseReference";

type Metric = "maxWeight" | "maxReps" | "setCount" | "volume";
const metrics: Record<Metric, string> = {
  maxWeight: "Peso máximo",
  maxReps: "Repeticiones",
  setCount: "Series",
  volume: "Volumen",
};
const periods = { "1m": 30, "3m": 90, "6m": 180, all: null };
export default function ExerciseInsights({
  exerciseId,
}: {
  exerciseId: string;
}) {
  const [metric, setMetric] = useState<Metric>("maxWeight");
  const [period, setPeriod] = useState<keyof typeof periods>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const result = useLiveQuery(async () => {
    try {
      return { data: await readExerciseTrainings(exerciseId), error: false };
    } catch {
      return { data: [], error: true };
    }
  }, [exerciseId]);
  if (!result) return <p className="empty-state">Cargando evolución…</p>;
  if (result.error)
    return (
      <p role="alert" className="empty-state">
        No se pudo leer el historial.{" "}
        <button onClick={() => location.reload()}>Reintentar</button>
      </p>
    );
  const history = result.data;
  const insights = exerciseInsights(history);
  const cutoff =
    periods[period] === null ? null : now - periods[period]! * 86400000;
  const points = insights.points
    .filter(
      (h) =>
        cutoff === null ||
        new Date(`${h.session.date}T23:59:59`).getTime() >= cutoff,
    )
    .slice()
    .reverse()
    .map((h) => ({
      id: h.session.id,
      label: formatDateShort(h.session.date),
      value: summarizeSets(h.sets)[metric],
    }));
  const detail = history.find((h) => h.session.id === selected);
  const units =
    metric === "maxWeight"
      ? "kg"
      : metric === "volume"
        ? "kg·reps"
        : metric === "maxReps"
          ? "reps"
          : "series";
  return (
    <div className="space-y-5">
      <section aria-label="Récords actuales" className="grid grid-cols-2 gap-3">
        <div className="stat-card">
          <p className="eyebrow">Mayor peso</p>
          <p className="stat-value">
            {insights.weightRecord?.weight ?? "—"} <small>kg</small>
          </p>
          <p className="text-sm text-text-secondary">
            {insights.weightRecord
              ? `${insights.weightRecord.reps} repeticiones`
              : "Sin series válidas"}
          </p>
        </div>
        <div className="stat-card">
          <p className="eyebrow">Más repeticiones</p>
          <p className="stat-value">
            {insights.repsRecord?.reps ?? "—"} <small>reps</small>
          </p>
          <p className="text-sm text-text-secondary">
            {insights.repsRecord
              ? `con ${insights.repsRecord.weight} kg`
              : "Sin series válidas"}
          </p>
        </div>
      </section>
      <section className="panel" aria-label="Evolución">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">Tu evolución</h2>
          <span className="eyebrow">{units}</span>
        </div>
        <div className="segmented" aria-label="Métrica">
          {(Object.keys(metrics) as Metric[]).map((m) => (
            <button
              key={m}
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
            >
              {metrics[m]}
            </button>
          ))}
        </div>
        <div className="flex gap-1 my-3" aria-label="Período">
          {(Object.keys(periods) as (keyof typeof periods)[]).map((p) => (
            <button
              key={p}
              aria-pressed={period === p}
              className={`period-button ${period === p ? "selected" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {p === "all"
                ? "Todo"
                : `${p.slice(0, 1)} ${p === "1m" ? "mes" : "meses"}`}
            </button>
          ))}
        </div>
        {points.length ? (
          <>
            <div className="h-60 w-full min-w-0" data-testid="evolution-chart">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart
                  data={points}
                  margin={{ left: -18, right: 20, top: 18, bottom: 8 }}
                >
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                    minTickGap={35}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={
                      metric === "maxWeight" || metric === "volume"
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                    formatter={(value) => [
                      `${value} ${units}`,
                      metrics[metric],
                    ]}
                  />
                  <Line
                    type="linear"
                    dataKey="value"
                    stroke="var(--accent)"
                    strokeWidth={3}
                    isAnimationActive={false}
                    activeDot={false}
                    dot={(props) => {
                      const { cx, cy, payload } = props as {
                        cx?: number;
                        cy?: number;
                        payload?: { id: string; label: string; value: number };
                      };
                      if (cx === undefined || cy === undefined || !payload)
                        return <g />;
                      return (
                        <g
                          key={payload.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Ver entrenamiento ${payload.label}: ${payload.value} ${units}`}
                          onClick={() => setSelected(payload.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelected(payload.id);
                            }
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <circle cx={cx} cy={cy} r={22} fill="transparent" />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={selected === payload.id ? 7 : 5}
                            fill="var(--accent)"
                            stroke="var(--surface)"
                            strokeWidth={2}
                          />
                        </g>
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-text-secondary">
              Tocá un punto para ver todas las series. Solo entrenamientos
              finalizados con series válidas.
            </p>
          </>
        ) : (
          <p className="empty-state">
            {history.length
              ? "No hay series válidas en este período."
              : "Este ejercicio todavía no tiene registros. Al entrenar, su evolución aparecerá acá."}
          </p>
        )}
      </section>
      {detail && (
        <section
          className="panel border-accent"
          aria-label="Detalle del punto seleccionado"
          aria-live="polite"
        >
          <p className="eyebrow mb-2">
            {formatDateShort(detail.session.date)} · Día{" "}
            {detail.session.routineDay}
          </p>
          <h2 className="font-semibold mb-3">{detail.exercise.name}</h2>
          <RecordedSets sets={detail.sets} />
          <Link
            className="text-accent mt-3 inline-flex min-h-11 items-center"
            href={`/historial/${detail.session.id}`}
          >
            Abrir entrenamiento →
          </Link>
        </section>
      )}
      <section aria-label="Entrenamientos del ejercicio">
        <h2 className="font-semibold mb-3">Historial del ejercicio</h2>
        <p className="text-sm text-text-secondary mb-4">
          Incluye todos los días y conserva las series incompletas. — significa
          campo vacío.
        </p>
        <div className="space-y-3">
          {history.map((h) => {
            const stats = summarizeSets(h.sets);
            return (
              <article className="panel" key={h.session.id}>
                <button
                  className="w-full text-left"
                  aria-label={`Detalle del entrenamiento ${h.session.date}`}
                  aria-pressed={selected === h.session.id}
                  onClick={() => setSelected(h.session.id)}
                >
                  <span className="flex justify-between gap-2">
                    <strong>{formatDateShort(h.session.date)}</strong>
                    <span className="day-pill">Día {h.session.routineDay}</span>
                  </span>
                  <span className="block text-sm text-text-secondary mt-2">
                    {h.exercise.name}
                  </span>
                </button>
                {stats.setCount > 0 ? (
                  <dl className="grid grid-cols-2 gap-3 mt-4 mb-4 text-sm">
                    <div>
                      <dt className="text-text-secondary">Peso máximo</dt>
                      <dd>{stats.maxWeight} kg</dd>
                    </div>
                    <div>
                      <dt className="text-text-secondary">Más repeticiones</dt>
                      <dd>
                        {stats.maxReps} con {stats.repsRecord!.weight} kg
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-secondary">Series válidas</dt>
                      <dd>{stats.setCount}</dd>
                    </div>
                    <div>
                      <dt className="text-text-secondary">Volumen</dt>
                      <dd>{Number(stats.volume.toFixed(2))} kg·reps</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-text-secondary my-3">
                    Registro incompleto · no participa en estadísticas.
                  </p>
                )}
                <RecordedSets sets={h.sets} />
              </article>
            );
          })}
          {!history.length && (
            <p className="empty-state">
              Sin entrenamientos anteriores para este ejercicio.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
