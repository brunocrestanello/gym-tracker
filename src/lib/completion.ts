import { isoWeekInfo } from "./dates";
import type { RoutineDay, WorkoutSession } from "./types";
/** Completion is derived from original workout dates; never persisted as flags. */
export function completedDaysThisWeek(
  sessions: WorkoutSession[],
  today: string,
): Set<RoutineDay> {
  const monday = isoWeekInfo(today).weekStart;
  return new Set(
    sessions
      .filter(
        (s) => s.finishedAt !== null && s.date >= monday && s.date <= today,
      )
      .map((s) => s.routineDay),
  );
}
