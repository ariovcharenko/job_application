import { getMasterProfileDoc, saveMasterProfileChecked } from "../../db";
import { appendRoleFact } from "./facts";
import type { RoleKey } from "./skills";

/**
 * Saves a fact she typed while tailoring to that role in "Your experience". Built on the stored
 * text as it is now (not a copy the screen loaded earlier), and saved only if nobody changed it in
 * between (another tab, the editor); then it re-reads and tries again. The text it replaces is kept
 * as an earlier version (lib/db.ts), like every tailoring addition. Returns the new text.
 */
export async function saveRoleFact(role: RoleKey, fact: string, attempts = 3): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const current = await getMasterProfileDoc();
    const text = current?.text ?? "";
    const next = appendRoleFact(text, role, fact);
    if (next === text) return text;
    const res = await saveMasterProfileChecked(next, { reason: "tailor", expectedUpdatedAt: current?.updatedAt ?? null });
    if (res.ok) return next;
  }
  throw new Error("Your experience kept changing while saving. Try again.");
}
