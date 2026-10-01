"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved";

/**
 * Load a record once, hold an editable copy, and save it automatically shortly after each change.
 * Pending changes are also written when the tab is hidden or closed, so nothing typed is lost on refresh.
 */
export function useAutosave<T>(load: () => Promise<T>, save: (value: T) => Promise<void>, delayMs = 200) {
  const [draft, setDraftState] = useState<T | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const latest = useRef<T | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    let alive = true;
    load().then((v) => {
      if (!alive) return;
      latest.current = v;
      setDraftState(v);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Write any pending change now. Resolves once it is stored. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current || latest.current === null) return;
    dirty.current = false;
    await saveRef.current(latest.current);
    setStatus("saved");
  }, []);

  const setDraft = useCallback(
    (value: T) => {
      latest.current = value;
      dirty.current = true;
      setDraftState(value);
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [delayMs, flush],
  );

  useEffect(() => {
    const onHide = () => void flush();
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      onHide(); // leaving the page (e.g. switching tabs in the app) also saves
    };
  }, [flush]);

  return { draft, setDraft, status, flush } as const;
}
