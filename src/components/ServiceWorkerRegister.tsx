"use client";

import { useEffect, useState } from "react";

export default function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const inspect = () => { if (!disposed && registration?.waiting) setWaiting(true); };
    const watch = () => {
      installing?.removeEventListener("statechange", inspect);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", inspect);
      inspect();
    };
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(value => {
      if (disposed) return;
      registration = value;
      registration.addEventListener("updatefound", watch);
      watch();
    }).catch(() => { /* Offline registration is best effort; never reset data or reload. */ });
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", watch);
      installing?.removeEventListener("statechange", inspect);
    };
  }, []);
  return waiting ? <p role="status" className="px-4 py-2 text-xs text-text-secondary">
    Hay una actualización preparada. Terminá y guardá tu entrenamiento; después cerrá todas las ventanas de esta app y volvé a abrirla para actualizar. No se recargará automáticamente.
  </p> : null;
}
