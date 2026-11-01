"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { exportBackup, importBackup } from "@/lib/repo";
import { validateBackup } from "@/lib/backup";
import { BackupPayload } from "@/lib/types";
import { waitForWrites } from "@/lib/persistence";
import { todayDateString } from "@/lib/dates";
import { ChevronLeft, Download, Upload } from "lucide-react";

export default function AjustesPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<BackupPayload | null>(null);

  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      await waitForWrites();
      const payload = await exportBackup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rutina-bruno-backup-${todayDateString()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("Descarga solicitada. Verificá el archivo en Archivos/Descargas antes de restaurar.");
    } catch { setMessage("No se pudo exportar. Hay cambios sin guardar o un error de almacenamiento."); }
    finally { setBusy(false); }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      setConfirmImport(validateBackup(JSON.parse(await file.text())));
      setMessage(null);
    } catch { setMessage("Archivo corrupto, incompatible o inconsistente. No se modificaron los datos."); }
    finally { setBusy(false); }
  }

  async function confirmDoImport() {
    if (!confirmImport) return;
    setBusy(true);
    try {
      await waitForWrites();
      await importBackup(confirmImport);
      setMessage("Backup importado. Todos tus datos anteriores fueron reemplazados.");
    } catch {
      setMessage("No se pudo importar el archivo. Verificá que sea un backup válido.");
    } finally {
      setBusy(false);
      setConfirmImport(null);
    }
  }

  return (
    <div className="min-h-dvh pb-10">
      <header className="safe-top sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-border-soft px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-text-secondary active:text-text">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-base font-semibold">Ajustes y backup</h1>
      </header>

      <div className="px-4 pt-4 flex flex-col gap-3">
        <button
          disabled={busy}
          onClick={handleExport}
          className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-surface border border-border-soft active:bg-surface-2"
        >
          <Download size={17} className="text-accent" />
          <div className="text-left">
            <p className="text-sm text-text">Exportar backup</p>
            <p className="text-xs text-text-tertiary">Descarga todos tus datos como JSON</p>
          </div>
        </button>

        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-surface border border-border-soft active:bg-surface-2"
        >
          <Upload size={17} className="text-accent" />
          <div className="text-left">
            <p className="text-sm text-text">Importar backup</p>
            <p className="text-xs text-text-tertiary">Restaura desde un archivo JSON exportado</p>
          </div>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          onChange={handleFileSelected}
          className="hidden"
        />

        {message && <p className="text-xs text-text-secondary px-1">{message}</p>}

        <div className="mt-4 px-1">
          <p className="text-xs text-text-tertiary leading-relaxed">
            Los datos se guardan localmente en este dispositivo (IndexedDB). Si desinstalás la
            app o borrás los datos del navegador, se pierden a menos que hayas exportado un
            backup. Importar reemplaza por completo los datos actuales.
          </p>
        </div>
      </div>

      {confirmImport && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-6 sm:pb-0">
          <div className="w-full max-w-sm rounded-2xl bg-surface border border-border p-5">
            <p className="text-sm text-text mb-1">¿Importar este backup?</p>
            <p className="text-xs text-text-tertiary mb-4">
              Esto reemplaza todos los datos actuales de la app por los del archivo. No se puede
              deshacer.
            </p>
            <p className="text-xs mb-3">Archivo validado: {confirmImport.workoutSessions.length} entrenamientos, {confirmImport.sets.length} series.</p>
            <button disabled={busy} onClick={handleExport} className="w-full py-2 text-accent text-sm">Descargar copia de los datos actuales</button>
            {message && <p role="status" className="text-xs mb-3">{message}</p>}
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => setConfirmImport(null)}
                className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-sm"
              >
                Cancelar
              </button>
              <button
                disabled={busy}
                onClick={confirmDoImport}
                className="flex-1 py-2.5 rounded-xl bg-accent text-bg font-medium text-sm"
              >
                Importar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
