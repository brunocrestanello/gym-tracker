"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface RestTimerState {
  remaining: number; // segundos
  total: number;
  running: boolean;
  start: (seconds: number) => void;
  stop: () => void;
  addTime: (seconds: number) => void;
}

const RestTimerContext = createContext<RestTimerState | null>(null);

const STORAGE_KEY = "rest-timer-end";
const STORAGE_TOTAL_KEY = "rest-timer-total";

export function RestTimerProvider({ children }: { children: React.ReactNode }) {
  const [remaining, setRemaining] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = useCallback(() => {
    const endStr = localStorage.getItem(STORAGE_KEY);
    if (!endStr) {
      setRunning(false);
      return;
    }
    const end = Number(endStr);
    const now = Date.now();
    const rem = Math.max(0, Math.round((end - now) / 1000));
    setRemaining(rem);
    if (rem <= 0) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_TOTAL_KEY);
      setRunning(false);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch {
        // best effort
      }
    }
  }, []);

  useEffect(() => {
    const endStr = localStorage.getItem(STORAGE_KEY);
    const totalStr = localStorage.getItem(STORAGE_TOTAL_KEY);
    if (endStr) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restaurar timer persistido al montar
      setRunning(true);
      setTotal(totalStr ? Number(totalStr) : 0);
      tick();
    }
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tick]);

  const start = useCallback((seconds: number) => {
    const end = Date.now() + seconds * 1000;
    localStorage.setItem(STORAGE_KEY, String(end));
    localStorage.setItem(STORAGE_TOTAL_KEY, String(seconds));
    setTotal(seconds);
    setRemaining(seconds);
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_TOTAL_KEY);
    setRunning(false);
    setRemaining(0);
  }, []);

  const addTime = useCallback((seconds: number) => {
    const endStr = localStorage.getItem(STORAGE_KEY);
    const base = endStr ? Number(endStr) : Date.now();
    const end = Math.max(Date.now(), base) + seconds * 1000;
    localStorage.setItem(STORAGE_KEY, String(end));
    setRemaining(Math.max(0, Math.round((end - Date.now()) / 1000)));
  }, []);

  return (
    <RestTimerContext.Provider
      value={{ remaining, total, running, start, stop, addTime }}
    >
      {children}
      {running && (
        <FloatingTimerBar
          remaining={remaining}
          total={total}
          stop={stop}
          addTime={addTime}
        />
      )}
    </RestTimerContext.Provider>
  );
}

export function useRestTimer() {
  const ctx = useContext(RestTimerContext);
  if (!ctx)
    throw new Error("useRestTimer debe usarse dentro de RestTimerProvider");
  return ctx;
}

function formatMMSS(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function FloatingTimerBar({
  remaining,
  total,
  stop,
  addTime,
}: {
  remaining: number;
  total: number;
  stop: () => void;
  addTime: (s: number) => void;
}) {
  const pct =
    total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  return (
    <div className="fixed bottom-24 left-0 right-0 mx-auto max-w-[760px] z-40 safe-bottom">
      <div className="mx-3 mb-3 rounded-xl border border-border bg-surface/95 backdrop-blur px-4 py-2.5 shadow-lg shadow-black/30 flex items-center gap-3">
        <div className="relative h-9 w-9 shrink-0">
          <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="var(--color-surface-3)"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="3"
              strokeDasharray={2 * Math.PI * 15.5}
              strokeDashoffset={2 * Math.PI * 15.5 * (1 - pct / 100)}
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-xs text-text-secondary leading-none mb-0.5">
            Descanso
          </div>
          <div className="font-mono tabular text-lg leading-none text-text">
            {formatMMSS(remaining)}
          </div>
        </div>
        <button
          onClick={() => addTime(15)}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-2 text-text-secondary active:bg-surface-3"
        >
          +15s
        </button>
        <button
          onClick={stop}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-2 text-text-secondary active:bg-surface-3"
        >
          Saltar
        </button>
      </div>
    </div>
  );
}
