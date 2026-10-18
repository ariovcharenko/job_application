import { getMasterProfileDoc, saveMasterProfileChecked } from "./db";
import type { TextDoc } from "./types";

// The editing logic behind the "Your experience" editor, kept out of React so it can be tested
// against fake-indexeddb. The rules:
// - While she has no unsaved typing, the editor follows the database (another tab, or a skill added
//   while tailoring, shows up at once instead of being written over later).
// - A save only goes through if the stored text is still the one her edits started from. If it
//   changed meanwhile, nothing is written: the editor shows both and she picks. Whichever she
//   doesn't pick is kept as an earlier version (lib/db.ts), so either way nothing is lost.

export type MasterDraftStatus = "loading" | "idle" | "saving" | "saved" | "conflict";

export interface MasterDraftState {
  text: string | null;
  status: MasterDraftStatus;
  /** When status is "conflict": what is stored now (written elsewhere after her edits began). */
  theirs: string | null;
}

export class MasterDraftController {
  private text: string | null = null;
  private base: number | null = null; // updatedAt of the stored record her draft is based on
  private editSeq = 0;
  private savedSeq = 0;
  private status: MasterDraftStatus = "loading";
  private theirs: TextDoc | null = null;
  private saving: Promise<void> | null = null;

  constructor(private readonly notify: (s: MasterDraftState) => void) {}

  get state(): MasterDraftState {
    return { text: this.text, status: this.status, theirs: this.theirs?.text ?? null };
  }

  get dirty(): boolean {
    return this.editSeq !== this.savedSeq;
  }

  private emit() {
    this.notify(this.state);
  }

  /** The stored record changed (or was first read). Followed only when nothing is unsaved. */
  external(doc: TextDoc | undefined) {
    const updatedAt = doc?.updatedAt ?? null;
    if (this.text !== null && updatedAt === this.base) return; // our own save, or nothing new
    if (this.text !== null && this.dirty) return; // her typing wins for now; the save will check
    if (this.status === "conflict") return;
    this.text = doc?.text ?? "";
    this.base = updatedAt;
    if (this.status === "loading") this.status = "idle";
    this.emit();
  }

  edit(text: string) {
    this.text = text;
    this.editSeq++;
    if (this.status !== "conflict") this.status = "saving";
    this.emit();
  }

  /** Writes pending typing now, unless the stored text changed meanwhile (then: conflict). */
  async flush(): Promise<void> {
    if (this.saving) await this.saving;
    if (!this.dirty || this.text === null || this.status === "conflict") return;
    const seq = this.editSeq;
    const text = this.text;
    this.saving = (async () => {
      const res = await saveMasterProfileChecked(text, { reason: "edit", expectedUpdatedAt: this.base });
      if (res.ok) {
        this.base = res.updatedAt;
        this.savedSeq = seq;
        if (!this.dirty) this.status = "saved";
      } else {
        this.theirs = res.current;
        this.status = "conflict";
      }
      this.emit();
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  /** Settles a conflict: keep her edits (stored text becomes a version) or take the stored text. */
  async resolve(choice: "mine" | "theirs"): Promise<void> {
    const theirs = this.theirs;
    if (this.status !== "conflict" || !theirs || this.text === null) return;
    if (choice === "mine") {
      const res = await saveMasterProfileChecked(this.text, { reason: "other", expectedUpdatedAt: theirs.updatedAt });
      if (!res.ok) {
        // Changed yet again: show the newest one.
        this.theirs = res.current;
        this.emit();
        return;
      }
      this.base = res.updatedAt;
    } else {
      // Keep her unsaved edits as a version before showing the stored text.
      const mine = this.text;
      const res = await saveMasterProfileChecked(mine, { reason: "other", expectedUpdatedAt: theirs.updatedAt });
      if (res.ok) await saveMasterProfileChecked(theirs.text, { reason: "restore" });
      const now = await getMasterProfileDoc();
      this.text = now?.text ?? "";
      this.base = now?.updatedAt ?? null;
    }
    this.savedSeq = this.editSeq;
    this.theirs = null;
    this.status = "saved";
    this.emit();
  }
}
