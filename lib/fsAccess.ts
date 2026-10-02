// File System Access API helpers (Chromium only). Lets the app read/write the resume folder directly.

interface PermissionCapableHandle extends FileSystemDirectoryHandle {
  queryPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?(opts?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}

export function fsAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Ask the user to pick a folder. Returns null if they cancel. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** Checks current permission without prompting — safe to call anytime, including on mount. */
export async function hasPermission(handle: FileSystemDirectoryHandle, mode: "read" | "readwrite" = "readwrite"): Promise<boolean> {
  const h = handle as PermissionCapableHandle;
  return (await h.queryPermission?.({ mode })) === "granted";
}

/** True if we can use the handle now; prompts the user if permission lapsed. The prompt needs a
 * real user gesture (Chrome throws SecurityError otherwise), so only call this from a click
 * handler — never from a useEffect or other code that can run on page load. */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<boolean> {
  const h = handle as PermissionCapableHandle;
  if ((await h.queryPermission?.({ mode })) === "granted") return true;
  return (await h.requestPermission?.({ mode })) === "granted";
}

export type ResumeFormat = "docx" | "pdf";

export interface ResumeFile {
  name: string;
  format: ResumeFormat;
}

/** Word and PDF resumes in the folder. Skips Word lock files (~$...), hidden files and other file types. */
export async function listResumeFiles(handle: FileSystemDirectoryHandle): Promise<ResumeFile[]> {
  const files: ResumeFile[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || entry.name.startsWith("~$") || entry.name.startsWith(".")) continue;
    const ext = entry.name.toLowerCase().split(".").pop();
    if (ext === "docx" || ext === "pdf") files.push({ name: entry.name, format: ext });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readResumeFile(handle: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer> {
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await handle.getFileHandle(name);
  } catch (err) {
    throw new Error(`Couldn't find "${name}" in the resume folder (${describeError(err)}). Try "Check access" above.`);
  }
  let file: File;
  try {
    file = await fileHandle.getFile();
  } catch (err) {
    throw new Error(
      `Found "${name}" but couldn't read its contents (${describeError(err)}). This is usually a macOS permission issue. ` +
        `Check System Settings > Privacy & Security > Files and Folders (or "Documents Folder") and make sure Chrome is allowed there.`,
    );
  }
  try {
    return await file.arrayBuffer();
  } catch (err) {
    throw new Error(`Found "${name}" but couldn't read its bytes (${describeError(err)}).`);
  }
}

export async function writeResumeFile(handle: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const fileHandle = await handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
  } catch (err) {
    throw new Error(`Couldn't save "${name}" to the Tailored folder (${describeError(err)}).`);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The Base resume folder, resolved from whichever folder she picked in Settings. If the picked
 * folder itself has a "Base" subfolder (i.e. she picked the parent `Full-Time Resumes` folder),
 * that's used. Otherwise the picked folder is treated as the Base folder directly — this covers
 * the case where she pointed the picker straight at her Base folder, which is how folder setup
 * started in M0. Read-only: never creates or writes anything. */
export async function getBaseDir(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  const baseSub = await getSubdirectory(root, "Base");
  return baseSub ?? root;
}

/** A subfolder whose name starts with "Tailored" (any case: "Tailored", "TAILORED RESUMES"). */
async function findTailoredSub(parent: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
  const entries = (parent as unknown as { entries?(): AsyncIterable<[string, FileSystemHandle]> }).entries?.();
  if (!entries) return null;
  for await (const [name, handle] of entries) {
    if (handle.kind === "directory" && /^tailored/i.test(name.trim())) return handle as FileSystemDirectoryHandle;
  }
  return null;
}

/**
 * Where tailored resumes are saved, NEXT TO the Base folder and never inside it:
 *  - a Tailored folder she chose herself (`chosen`) always wins;
 *  - if the picked folder holds a "Base" subfolder (she picked the parent, e.g. Full-Time_Resumes),
 *    its Tailored folder is used, created there only if it doesn't exist;
 *  - if she picked the Base folder itself, the browser can't reach its parent, so this returns null
 *    and the caller asks her to choose the Tailored folder once (it never creates one inside Base).
 * Only call this when about to write: creating a folder needs readwrite permission.
 */
export async function getOrCreateTailoredDir(
  root: FileSystemDirectoryHandle,
  chosen?: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  if (chosen) return chosen;
  const base = await getSubdirectory(root, "Base");
  if (!base) return null;
  return (await findTailoredSub(root)) ?? (await getSubdirectory(root, "Tailored", true));
}

async function getSubdirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
  create = false,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotFoundError" || err.name === "TypeMismatchError")) return null;
    throw err;
  }
}
