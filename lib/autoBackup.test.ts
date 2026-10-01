import { describe, expect, it } from "vitest";
import { backupPrefix, datedFileName, filesToPrune, KEEP_DAYS, LATEST_FILE, latestFileName } from "./autoBackup";
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

  it("gives a local copy of the app its own file names, so it never overwrites the live site's", () => {
    expect(backupPrefix("localhost")).toBe("job-copilot-localhost-backup");
    expect(backupPrefix("127.0.0.1")).toBe("job-copilot-localhost-backup");
    expect(backupPrefix("job-copilot.example.app")).toBe("job-copilot-backup");
    const live = Array.from({ length: 20 }, (_, i) => datedFileName(new Date(2026, 8, i + 1)));
    const local = [datedFileName(new Date(2026, 9, 1), "job-copilot-localhost-backup"), latestFileName("job-copilot-localhost-backup")];
    // Pruning the local copy's files never touches the live site's, and the reverse.
    expect(filesToPrune([...live, ...local], KEEP_DAYS, "job-copilot-localhost-backup")).toEqual([]);
    expect(filesToPrune([...live, ...local])).not.toContain(local[0]);
    expect(latestFileName("job-copilot-localhost-backup")).not.toBe(LATEST_FILE);
  });

  it("never includes the API key or the folder itself", () => {
    const text = buildBackup({ ...DEFAULT_SETTINGS, anthropicKey: "sk-ant-test-only", backupFolder: {} as FileSystemDirectoryHandle }, DEFAULT_PROFILE, DEFAULT_PREFERENCES, {
      includeKey: false,
    });
    expect(text).not.toContain("sk-ant-test-only");
    expect(text).not.toContain("backupFolder");
  });
});
