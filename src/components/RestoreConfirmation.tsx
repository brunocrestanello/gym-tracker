"use client";

import { useState } from "react";
import { BackupPayload } from "@/lib/types";

/** Downloads cannot be verified by the app. Always require a second, deliberate consent. */
export default function RestoreConfirmation({ payload, busy, message, onCopy, onCancel, onConfirm }: {
  payload: BackupPayload;
  busy: boolean;
  message: string | null;
  onCopy: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-6 sm:pb-0">
    <div role="dialog" aria-modal="true" aria-labelledby="restore-title" className="w-full max-w-sm rounded-2xl bg-surface border border-border p-5">
      <h2 id="restore-title" className="text-sm text-text mb-1">Reemplazar todo el historial</h2>
      <p className="text-xs text-text-tertiary mb-4">Esto elimina los datos actuales de la app y los reemplaza por los del archivo. No se puede deshacer sin otra copia.</p>
      <p className="text-xs mb-3">Archivo validado: {payload.workoutSessions.length} entrenamientos, {payload.sets.length} series.</p>
      <button disabled={busy} onClick={onCopy} className="w-full py-2 text-accent text-sm">Descargar copia de los datos actuales</button>
      <p className="text-xs mb-3">La app no puede verificar que la descarga se haya guardado. Revisá el archivo en Archivos/Descargas antes de seguir.</p>
      {message && <p role="status" className="text-xs mb-3">{message}</p>}
      {confirming && <label className="block text-xs mb-3">
        Si continuás sin una copia previa verificada, podrías perder tu historial actual definitivamente. Escribí REEMPLAZAR para confirmar que aceptás ese riesgo.
        <input aria-label="Confirmar reemplazo" value={phrase} disabled={busy} onChange={e => setPhrase(e.target.value)} autoComplete="off" autoCapitalize="characters" className="mt-2 w-full rounded-lg bg-surface-2 p-2" />
      </label>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={onCancel} className="flex-1 py-2.5 rounded-xl bg-surface-2 text-sm">Cancelar</button>
        {confirming
          ? <button disabled={busy || phrase !== "REEMPLAZAR"} onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-accent text-bg text-sm">Reemplazar historial</button>
          : <button disabled={busy} onClick={() => setConfirming(true)} className="flex-1 py-2.5 rounded-xl bg-accent text-bg text-sm">Continuar a confirmación</button>}
      </div>
    </div>
  </div>;
}
