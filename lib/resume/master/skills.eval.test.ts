import { describe, expect, it } from "vitest";
import { skillsMatchPercent } from "../../intake/decision";
import { ALEX_MASTER, EVAL_POSTINGS, SAM_MASTER } from "./__fixtures__/skillsEval";
import { dropSoftSkills, matchSkills, normalizeSkill, parseSkillInventory, type SkillMatch } from "./skills";

// Runs every fixture posting through the production path (extracted lists -> matchSkills ->
// dropSoftSkills -> skillsMatchPercent) for two candidates and scores it against hand labels.

const key = (s: string) => normalizeSkill(s);
const keys = (xs: string[]) => new Set(xs.map(key));

function run(raw: string[], master: string): SkillMatch {
  return dropSoftSkills(matchSkills(raw, parseSkillInventory(master), master));
}

interface Tally { tp: number; predicted: number; expected: number }
const add = (t: Tally, pred: Set<string>, exp: Set<string>) => {
  t.predicted += pred.size;
  t.expected += exp.size;
  for (const k of pred) if (exp.has(k)) t.tp++;
};
const pr = (t: Tally) => ({ precision: t.predicted ? t.tp / t.predicted : 1, recall: t.expected ? t.tp / t.expected : 1 });

function evaluate() {
  const list: Tally = { tp: 0, predicted: 0, expected: 0 };
  const have: Tally = { tp: 0, predicted: 0, expected: 0 };
  const diffs: number[] = [];
  const problems: string[] = [];
  for (const p of EVAL_POSTINGS) {
    const expList = keys([...p.expect.required, ...p.expect.preferred]);
    for (const [who, master] of [["alex", ALEX_MASTER], ["sam", SAM_MASTER]] as const) {
      const req = run(p.required, master);
      const pref = run(p.preferred, master);
      const gotList = keys([...req.have, ...req.gap, ...pref.have, ...pref.gap]);
      if (who === "alex") {
        add(list, gotList, expList);
        const missing = [...expList].filter((k) => !gotList.has(k));
        const extra = [...gotList].filter((k) => !expList.has(k));
        if (missing.length || extra.length) problems.push(`${p.id}: list missing [${missing.join("; ")}] extra [${extra.join("; ")}]`);
      }
      const gotHave = keys([...req.have, ...pref.have]);
      const expHave = keys(p.expect[who]);
      add(have, gotHave, expHave);
      for (const k of gotHave) if (!expHave.has(k)) problems.push(`${p.id}/${who}: false have "${k}"`);
      for (const k of expHave) if (!gotHave.has(k)) problems.push(`${p.id}/${who}: missed "${k}"`);
      const split = (names: string[]) => ({ have: names.filter((s) => expHave.has(key(s))), gap: names.filter((s) => !expHave.has(key(s))) });
      const exp = skillsMatchPercent(split(p.expect.required), split(p.expect.preferred)).percent!;
      const got = skillsMatchPercent(req, pref).percent!;
      diffs.push(Math.abs(exp - got));
      if (exp !== got) problems.push(`${p.id}/${who}: percent ${got} vs expected ${exp}`);
    }
  }
  return { list: pr(list), have: pr(have), meanPercentError: diffs.reduce((a, b) => a + b, 0) / diffs.length, problems };
}

describe("skills evaluation set", () => {
  const r = evaluate();
  if (process.env.EVAL_VERBOSE) console.log(JSON.stringify(r, null, 1));

  it("covers the role families with two candidates", () => {
    expect(EVAL_POSTINGS.length).toBeGreaterThanOrEqual(15);
    expect(parseSkillInventory(ALEX_MASTER).length).toBeGreaterThan(10);
    expect(parseSkillInventory(SAM_MASTER).length).toBeGreaterThan(10);
  });

  it("builds the expected skill lists (split, deduped, no soft skills, degrees or years)", () => {
    expect(r.problems.filter((p) => p.includes("list missing"))).toEqual([]);
    expect(r.list.precision).toBe(1);
    expect(r.list.recall).toBe(1);
  });

  it("matches have and gap with no false matches and no misses", () => {
    expect(r.problems).toEqual([]);
    expect(r.have.precision).toBe(1);
    expect(r.have.recall).toBe(1);
    expect(r.meanPercentError).toBe(0);
  });
});
