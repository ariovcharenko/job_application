import { describe, expect, it } from "vitest";
import { getOrCreateTailoredDir } from "./fsAccess";

// A tiny in-memory folder with the parts of FileSystemDirectoryHandle the code uses.
class Dir {
  kind = "directory" as const;
  children = new Map<string, Dir>();
  constructor(public name: string) {}
  add(name: string) {
    const d = new Dir(name);
    this.children.set(name, d);
    return d;
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    const found = this.children.get(name);
    if (found) return found;
    if (opts.create) return this.add(name);
    throw new DOMException("not found", "NotFoundError");
  }
  async *entries(): AsyncGenerator<[string, Dir]> {
    for (const e of this.children) yield e;
  }
}
const h = (d: Dir) => d as unknown as FileSystemDirectoryHandle;

describe("getOrCreateTailoredDir", () => {
  it("uses the existing Tailored folder next to Base when she picked the parent folder", async () => {
    const root = new Dir("Full-Time_Resumes");
    root.add("Base");
    const tailored = root.add("Tailored");
    expect(await getOrCreateTailoredDir(h(root))).toBe(tailored);
  });

  it("finds a differently named Tailored folder (any case), and creates one next to Base only if none exists", async () => {
    const root = new Dir("Resumes");
    root.add("Base");
    const existing = root.add("TAILORED RESUMES");
    expect(await getOrCreateTailoredDir(h(root))).toBe(existing);

    const fresh = new Dir("Resumes");
    fresh.add("Base");
    const made = (await getOrCreateTailoredDir(h(fresh))) as unknown as Dir;
    expect(made.name).toBe("Tailored");
    expect(fresh.children.has("Tailored")).toBe(true);
  });

  it("never creates a folder inside Base when she picked Base itself", async () => {
    const base = new Dir("Base");
    expect(await getOrCreateTailoredDir(h(base))).toBeNull();
    expect(base.children.size).toBe(0);
  });

  it("a Tailored folder she chose herself always wins", async () => {
    const base = new Dir("Base");
    const chosen = new Dir("Tailored");
    expect(await getOrCreateTailoredDir(h(base), h(chosen))).toBe(chosen);
  });
});
