"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { exportBackup, importBackup } from "@/lib/repo";
import { todayDateString } from "@/lib/dates";
import { ChevronLeft, Download, Upload } from "lucide-react";

export default function AjustesPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<File | null>(null);

  async function handleExport() {
    const payload = await exportBackup();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rutina-bruno-backup-${todayDateString()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage("Backup exportado.");
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setConfirmImport(file);
    e.target.value = "";
  }

  async function confirmDoImport() {
    if (!confirmImport) return;
    try {
      const text = await confirmImport.text();
      const payload = JSON.parse(text);
      await importBackup(payload);
      setMessage("Backup importado. Todos tus datos anteriores fueron reemplazados.");
    } catch {
      setMessage("No se pudo importar el archivo. Verificá que sea un backup válido.");
    } finally {
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
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmImport(null)}
                className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-sm"
              >
                Cancelar
              </button>
              <button
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
