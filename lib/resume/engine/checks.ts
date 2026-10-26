import type { FlagKind } from "./validate";

// The final-page checks (verify.ts) run on the download, which leaves out lines still waiting for
// her OK. So "Every skill is in your experience" could show green next to a skill waiting for her
// OK. This turns those green lines into open ones while a flag of that kind is open.

interface CheckLike {
  id: string;
  ok: boolean;
  label: string;
}

const KINDS: Record<string, { kinds: FlagKind[]; noun: string }> = {
  skills: { kinds: ["skill"], noun: "skill" },
  numbers: { kinds: ["number"], noun: "number" },
  dates: { kinds: ["employer", "education"], noun: "employer, title or date" },
};

export function withOpenFlags<T extends CheckLike>(checks: T[], openFlags: { kind: FlagKind }[]): T[] {
  return checks.map((c) => {
    const rule = KINDS[c.id];
    if (!rule || !c.ok) return c;
    const n = openFlags.filter((f) => rule.kinds.includes(f.kind)).length;
    if (n === 0) return c;
    return { ...c, ok: false, label: `${n} ${rule.noun}${n === 1 ? " is" : "s are"} waiting for your OK, marked on the page.` };
  });
}
