import { describe, expect, it } from "vitest";
import { getBaseDir, getOrCreateTailoredDir, listResumeFiles } from "./fsAccess";

type Entry = { kind: "file" | "directory"; name: string };

function fakeFolder(entries: Entry[], subdirs: Record<string, FileSystemDirectoryHandle> = {}): FileSystemDirectoryHandle {
  const handle = {
    name: "root",
    async *values() {
      for (const e of entries) yield e;
    },
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      if (subdirs[name]) return subdirs[name];
      if (opts?.create) {
        const created = fakeFolder([]);
        subdirs[name] = created;
        return created;
      }
      throw new DOMException("not found", "NotFoundError");
    },
  } as unknown as FileSystemDirectoryHandle;
  return handle;
}

describe("listResumeFiles", () => {
  it("returns Word and PDF resumes with their format, sorted by name", async () => {
    const files = await listResumeFiles(
      fakeFolder([
        { kind: "file", name: "Base_SWE.pdf" },
        { kind: "file", name: "Base_AI.docx" },
        { kind: "file", name: "Base_Product.DOCX" },
      ]),
    );
    expect(files).toEqual([
      { name: "Base_AI.docx", format: "docx" },
      { name: "Base_Product.DOCX", format: "docx" },
      { name: "Base_SWE.pdf", format: "pdf" },
    ]);
  });

  it("skips Word lock files, hidden files, folders and other types", async () => {
    const files = await listResumeFiles(
      fakeFolder([
        { kind: "file", name: "~$Base_SWE.docx" },
        { kind: "file", name: ".DS_Store" },
        { kind: "file", name: "notes.txt" },
        { kind: "file", name: "resume.doc" },
        { kind: "directory", name: "Base.pdf" },
        { kind: "file", name: "Real.pdf" },
      ]),
    );
    expect(files).toEqual([{ name: "Real.pdf", format: "pdf" }]);
  });
});

describe("getBaseDir", () => {
  it("uses the Base subfolder when the picked folder is its parent", async () => {
    const baseDir = fakeFolder([{ kind: "file", name: "Resume.pdf" }]);
    const root = fakeFolder([], { Base: baseDir });
    expect(await getBaseDir(root)).toBe(baseDir);
  });

  it("treats the picked folder itself as Base when it has no Base subfolder", async () => {
    const root = fakeFolder([{ kind: "file", name: "Resume.pdf" }]);
    expect(await getBaseDir(root)).toBe(root);
  });

  it("never creates or writes anything (no getDirectoryHandle call with create:true)", async () => {
    let createCalled = false;
    const root = {
      name: "root",
      async *values() {},
      async getDirectoryHandle(_name: string, opts?: { create?: boolean }) {
        if (opts?.create) createCalled = true;
        throw new DOMException("not found", "NotFoundError");
      },
    } as unknown as FileSystemDirectoryHandle;
    await getBaseDir(root);
    expect(createCalled).toBe(false);
  });
});

describe("getOrCreateTailoredDir", () => {
  it("creates Tailored next to Base", async () => {
    const root = fakeFolder([]);
    const tailored = await getOrCreateTailoredDir(root);
    expect(tailored).not.toBe(root);
  });

  it("reuses an existing Tailored folder on a second call", async () => {
    const root = fakeFolder([]);
    const first = await getOrCreateTailoredDir(root);
    const second = await getOrCreateTailoredDir(root);
    expect(second).toBe(first);
  });
});
