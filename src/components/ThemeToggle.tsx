"use client";
import { useEffect, useState } from "react";
const KEY = "gym-tracker:theme:v1";
export function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#101918" : "#f4f7f4");
}
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [error, setError] = useState(false);
  useEffect(() => {
    const refresh = () => {
      let next: "dark" | "light" = matchMedia("(prefers-color-scheme: light)")
        .matches
        ? "light"
        : "dark";
      try {
        const stored = localStorage.getItem(KEY);
        if (stored === "dark" || stored === "light") next = stored;
      } catch {
        setError(true);
      }
      applyTheme(next);
      setTheme(next);
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  return (
    <div>
      <button
        className="theme-toggle"
        aria-label={`Cambiar a modo ${theme === "dark" ? "claro" : "oscuro"}`}
        onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          applyTheme(next);
          setTheme(next);
          try {
            localStorage.setItem(KEY, next);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
        <span>{theme === "dark" ? "Claro" : "Oscuro"}</span>
      </button>
      {error && (
        <p role="status" className="text-xs">
          El tema se aplica, pero no se pudo recordar.
        </p>
      )}
    </div>
  );
}
