import { describe, expect, it } from "vitest";
import { datedFileName, filesToPrune, KEEP_DAYS, LATEST_FILE } from "./autoBackup";
import { buildBackup } from "./backup";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./defaults";

describe("automatic backup files", () => {
  it("names one file per local day", () => {
    expect(datedFileName(new Date(2026, 8, 30, 23, 59))).toBe("job-copilot-backup-2026-09-30.json");
  });

  it("keeps the newest 14 dated files and never touches the latest file or other files", () => {
    const days = Array.from({ length: 20 }, (_, i) => datedFileName(new Date(2026, 8, i + 1)));
    const prune = filesToPrune([...days, LATEST_FILE, "resume.docx"]);
    expect(prune).toEqual(days.slice(0, 20 - KEEP_DAYS));
    expect(prune).not.toContain(LATEST_FILE);
    expect(filesToPrune(days.slice(0, 3))).toEqual([]);
  });

  it("never includes the API key or the folder itself", () => {
    const text = buildBackup({ ...DEFAULT_SETTINGS, anthropicKey: "sk-ant-test-only", backupFolder: {} as FileSystemDirectoryHandle }, DEFAULT_PROFILE, DEFAULT_PREFERENCES, {
      includeKey: false,
    });
    expect(text).not.toContain("sk-ant-test-only");
    expect(text).not.toContain("backupFolder");
  });
});
