"use client";

import { useEffect } from "react";
import { hasUnsavedWrites } from "@/lib/persistence";

export default function UnsavedChangesGuard() {
  useEffect(() => {
    // Advisory only: iOS can kill a PWA without emitting this event.
    const warn = (event: BeforeUnloadEvent) => {
      if (hasUnsavedWrites()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return null;
}
