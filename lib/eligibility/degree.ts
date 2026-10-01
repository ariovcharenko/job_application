import type { JobSignals } from "../scoring/signals";
import type { DegreeLevel } from "./candidate";

// "My degree meets the requirement": the degree a posting requires against the one in her
// Profile. A higher requirement fails; an unknown candidate degree is unclear, never a pass.

export const DEGREE_RANK: Record<DegreeLevel, number> = { none: 0, associate: 1, bachelors: 2, masters: 3, phd: 4 };

export const DEGREE_LABEL: Record<DegreeLevel, string> = {
  none: "no degree",
  associate: "an associate degree",
  bachelors: "a bachelor's degree",
  masters: "a master's degree",
  phd: "a PhD",
};

export function evaluateDegree(required: JobSignals["degreeRequired"], candidate: DegreeLevel | "unknown"): { status: "pass" | "fail" | "unknown"; detail: string } {
  if (required === "none") return { status: "pass", detail: "No degree requirement." };
  const needs = `Requires ${DEGREE_LABEL[required]}`;
  if (candidate === "unknown") return { status: "unknown", detail: `${needs}. Add your degree in Profile to check this.` };
  if (DEGREE_RANK[candidate] >= DEGREE_RANK[required]) return { status: "pass", detail: `${needs}, and you have one.` };
  return { status: "fail", detail: `${needs}.` };
}
