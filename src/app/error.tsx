"use client";

export default function StorageError({ reset }: { reset: () => void }) {
  return <div role="alert" className="p-6 text-sm">
    <p>No se pudieron leer los datos. No se reinicializó el almacenamiento.</p>
    <button onClick={reset} className="mt-3 text-accent">Reintentar</button>
  </div>;
}
