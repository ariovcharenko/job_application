"use client";

import { useEffect } from "react";
import { AUTO_BACKUP_EVENT, runAutoBackup } from "@/lib/autoBackup";
import { db } from "@/lib/db";

/** Seconds after the last change before writing a backup, so a burst of edits makes one file. */
const DELAY_MS = 15_000;

/**
 * Keeps the automatic backup current (lib/autoBackup.ts): once when the app opens, and shortly
 * after any change to her jobs, resumes, profile, experience, answers or contacts. Does nothing
 * until she picks a backup folder in Settings. Renders nothing.
 */
export default function AutoBackupRunner() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const run = async () => {
      timer = null;
      if (running) return;
      running = true;
      try {
        const status = await runAutoBackup();
        window.dispatchEvent(new CustomEvent(AUTO_BACKUP_EVENT, { detail: status }));
      } finally {
        running = false;
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), DELAY_MS);
    };
    // Settings changes aren't watched: saving the backup folder itself lives there.
    const tables = db.tables.filter((t) => t.name !== "settings");
    const unsubs = tables.flatMap((t) => {
      const onChange = () => {
        schedule();
      };
      t.hook("creating", onChange);
      t.hook("updating", onChange);
      t.hook("deleting", onChange);
      return [() => t.hook("creating").unsubscribe(onChange), () => t.hook("updating").unsubscribe(onChange), () => t.hook("deleting").unsubscribe(onChange)];
    });
    // Leaving the page with a change pending: write it now rather than lose it.
    const flush = () => {
      if (document.visibilityState === "hidden" && timer) {
        clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener("visibilitychange", flush);
    void run();
    return () => {
      unsubs.forEach((u) => u());
      document.removeEventListener("visibilitychange", flush);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
