"use client";

import { liveQuery } from "dexie";
import { useCallback, useEffect, useRef, useState } from "react";
import { db, MASTER_ID } from "./db";
import { MasterDraftController, type MasterDraftState } from "./masterDraft";

/**
 * The "Your experience" editor's state: follows the database while she isn't typing, autosaves
 * shortly after each change (and when the tab is hidden or closed), and stops with a conflict
 * instead of writing over a version saved elsewhere. See lib/masterDraft.ts.
 */
export function useMasterDraft(delayMs = 300) {
  const [state, setState] = useState<MasterDraftState>({ text: null, status: "loading", theirs: null });
  const ctl = useRef<MasterDraftController | null>(null);
  if (!ctl.current) ctl.current = new MasterDraftController(setState);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const sub = liveQuery(() => db.docs.get(MASTER_ID)).subscribe({
      next: (doc) => ctl.current?.external(doc),
      error: () => {},
    });
    return () => sub.unsubscribe();
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    await ctl.current?.flush();
  }, []);

  const setText = useCallback(
    (text: string) => {
      ctl.current?.edit(text);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [delayMs, flush],
  );

  const resolve = useCallback((choice: "mine" | "theirs") => ctl.current?.resolve(choice) ?? Promise.resolve(), []);

  useEffect(() => {
    const onHide = () => void flush();
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      onHide();
    };
  }, [flush]);

  return { ...state, setText, flush, resolve } as const;
}
