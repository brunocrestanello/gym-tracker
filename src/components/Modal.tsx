"use client";
import { useEffect, useRef } from "react";
/** Native modality keeps background controls inert and restores keyboard focus. */
export default function Modal({
  titleId,
  busy = false,
  onDismiss,
  children,
}: {
  titleId: string;
  busy?: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => {
      if (node?.open) node.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onDismiss();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-transparent p-0 text-text backdrop:bg-black/60"
    >
      <div className="panel">{children}</div>
    </dialog>
  );
}
