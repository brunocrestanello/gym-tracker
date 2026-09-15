const TZ = "America/Montevideo";

/** Devuelve la fecha/hora actual "vista" en America/Montevideo como Date local-equivalente. */
function nowInTz(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")) === 24 ? 0 : Number(get("hour")),
    Number(get("minute")),
    Number(get("second"))
  );
}

export function todayDateString(): string {
  return toDateString(nowInTz());
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week: semana empieza lunes. Devuelve { isoYear, isoWeek, weekStart } */
export function isoWeekInfo(dateStr: string): {
  isoYear: number;
  isoWeek: number;
  weekStart: string;
} {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7; // Monday=1 ... Sunday=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // move to Thursday of this week
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const monday = new Date(Date.UTC(y, m - 1, d));
  const mondayDayNum = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - (mondayDayNum - 1));
  const weekStart = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(monday.getUTCDate()).padStart(2, "0")}`;

  return { isoYear, isoWeek, weekStart };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const months = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

export function daysAgo(dateStr: string, days: number): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const cutoff = new Date(nowInTz());
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffUtc = new Date(Date.UTC(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate()));
  return target.getTime() >= cutoffUtc.getTime();
}
