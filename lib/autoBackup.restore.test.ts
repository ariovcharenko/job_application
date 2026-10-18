import { describe, expect, it } from "vitest";
import {
  beforeRestoreFileName,
  beforeShrinkFileName,
  datedFileName,
  filesToPrune,
  isSmaller,
  latestFileName,
  saveBeforeRestore,
  shrinkCopiesToPrune,
  writeAutoBackup,
} from "./autoBackup";

// A tiny in-memory folder with the parts of FileSystemDirectoryHandle the code uses.
class Dir {
  files = new Map<string, string>();
  constructor(public name = "Backups") {}
  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    if (!this.files.has(name)) {
      if (!opts.create) throw new DOMException("not found", "NotFoundError");
      this.files.set(name, "");
    }
    return {
      getFile: async () => ({ text: async () => this.files.get(name)! }),
      createWritable: async () => {
        let buf = "";
        return { write: async (t: string) => void (buf += t), close: async () => void this.files.set(name, buf) };
      },
    };
  }
  async removeEntry(name: string) {
    this.files.delete(name);
  }
  async *entries(): AsyncGenerator<[string, unknown]> {
    for (const k of [...this.files.keys()]) yield [k, {}];
  }
}
const h = (d: Dir) => d as unknown as FileSystemDirectoryHandle;
const backup = (jobs: number, resumes = 0) =>
  JSON.stringify({ app: "job-application-copilot", version: 2, tables: { applications: Array(jobs).fill({}), tailoredResumes: Array(resumes).fill({}) } });
const PREFIX = "job-copilot-backup";
const NOW = new Date(2026, 9, 17, 9, 30, 12);

describe("safety copy before a restore", () => {
  it("is written to the backup folder under a before-restore name", async () => {
    const dir = new Dir();
    const copy = await saveBeforeRestore(
      { exportText: async () => backup(9, 8), folder: async () => h(dir), canWrite: async () => true, download: () => {} },
      NOW,
      PREFIX,
    );
    expect(copy).toEqual({ where: "folder", folder: "Backups", name: "job-copilot-backup-before-restore-2026-10-17-093012.json" });
    expect(dir.files.get(beforeRestoreFileName(NOW, PREFIX))).toBe(backup(9, 8));
  });

  it("is downloaded when there is no backup folder or it can't be written without asking", async () => {
    const downloads: string[] = [];
    const copy = await saveBeforeRestore(
      { exportText: async () => backup(3), folder: async () => h(new Dir()), canWrite: async () => false, download: (_t, n) => downloads.push(n) },
      NOW,
      PREFIX,
    );
    expect(copy.where).toBe("download");
    expect(downloads).toEqual([beforeRestoreFileName(NOW, PREFIX)]);
  });

  it("throws (so the restore stops) if the current data can't be exported", async () => {
    await expect(
      saveBeforeRestore({ exportText: async () => Promise.reject(new Error("blocked")), folder: async () => undefined, canWrite: async () => true, download: () => {} }, NOW),
    ).rejects.toThrow("blocked");
  });

  it("is never pruned by the daily rotation", () => {
    const names = [beforeRestoreFileName(NOW, PREFIX), ...Array.from({ length: 20 }, (_, i) => datedFileName(new Date(2026, 8, i + 1)))];
    expect(filesToPrune(names)).not.toContain(names[0]);
    expect(shrinkCopiesToPrune(names)).toEqual([]);
  });
});

describe("automatic backup with less data than the latest file", () => {
  it("keeps the bigger latest file as a before-shrink copy before overwriting it", async () => {
    const dir = new Dir();
    dir.files.set(latestFileName(PREFIX), backup(9, 8));
    await writeAutoBackup(h(dir), backup(2, 1), NOW, PREFIX);
    expect(dir.files.get(latestFileName(PREFIX))).toBe(backup(2, 1));
    expect(dir.files.get(beforeShrinkFileName(NOW, PREFIX))).toBe(backup(9, 8));
  });

  it("keeps the first (biggest) copy of the day, not a later smaller one", async () => {
    const dir = new Dir();
    dir.files.set(latestFileName(PREFIX), backup(9));
    await writeAutoBackup(h(dir), backup(5), NOW, PREFIX);
    await writeAutoBackup(h(dir), backup(4), NOW, PREFIX);
    expect(dir.files.get(beforeShrinkFileName(NOW, PREFIX))).toBe(backup(9));
  });

  it("right after a restore, writes the restored data without a shrink copy (the before-restore copy holds the old data)", async () => {
    const dir = new Dir();
    dir.files.set(latestFileName(PREFIX), backup(9));
    await writeAutoBackup(h(dir), backup(2), NOW, PREFIX, { allowShrink: true });
    expect(dir.files.get(latestFileName(PREFIX))).toBe(backup(2));
    expect(dir.files.has(beforeShrinkFileName(NOW, PREFIX))).toBe(false);
  });

  it("growing data is just written", async () => {
    const dir = new Dir();
    dir.files.set(latestFileName(PREFIX), backup(2));
    await writeAutoBackup(h(dir), backup(3), NOW, PREFIX);
    expect([...dir.files.keys()].some((n) => n.includes("before-shrink"))).toBe(false);
  });

  it("compares jobs and tailored resumes", () => {
    expect(isSmaller(backup(3, 1), backup(3, 2))).toBe(true);
    expect(isSmaller(backup(3, 2), backup(3, 2))).toBe(false);
    expect(isSmaller(backup(3), null)).toBe(false);
    expect(isSmaller(backup(3), "not json")).toBe(false);
  });

  it("keeps only the newest before-shrink copies", () => {
    const names = Array.from({ length: 8 }, (_, i) => beforeShrinkFileName(new Date(2026, 9, i + 1), PREFIX));
    expect(shrinkCopiesToPrune(names, PREFIX)).toEqual(names.slice(0, 3));
  });
});
