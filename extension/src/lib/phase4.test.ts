import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickAdapter } from "./adapters";
import { fillForm } from "./fillEngine";
import { preflight, summarizePreflight } from "./preflight";
import { addQuestionActions, isOpenQuestion, questionFields } from "./questionActions";
import { BLANK_SYNCED_DATA, type SyncedAnswer, type SyncedProfile } from "../types";

const load = (name: string) => {
  document.documentElement.innerHTML = readFileSync(join(__dirname, "__fixtures__", `${name}.html`), "utf8");
};
const profile = (o: Partial<SyncedProfile> = {}): SyncedProfile => ({ ...BLANK_SYNCED_DATA.profile, fullName: "Alex Rivera", email: "alex@example.com", ...o });
const bank: SyncedAnswer[] = [{ question: "Why do you want to work at Taskwise?", answer: "Because of the dashboards.", tags: [] }];

describe("preflight on a Greenhouse-shaped form", () => {
  beforeEach(() => load("greenhouse"));
  const run = (p: SyncedProfile, answers: SyncedAnswer[] = []) => {
    const a = pickAdapter({ hostname: "boards.greenhouse.io" });
    return preflight(a.findFormRoot(document)!, p, answers, a.findResumeInput(document));
  };

  it("lists the written answer, dropdowns and the legal questions the Profile can't answer", () => {
    const items = run(profile());
    expect(items.filter((i) => i.kind === "essay").map((i) => i.label)).toEqual(["Why do you want to work at Brightloop?"]);
    expect(items.filter((i) => i.kind === "legal-missing").map((i) => i.label).sort()).toEqual([
      "Are you legally authorized to work in the United States?",
      "Do you currently hold an active security clearance?",
      "Will you now or in the future require sponsorship for employment visa status?",
    ]);
    expect(items.some((i) => i.kind === "choice" && /hear about/.test(i.label))).toBe(true);
    expect(items.some((i) => i.kind === "upload")).toBe(false); // the resume box is the resume, not "extra"
  });

  it("stops listing legal questions once the Profile answers them, and marks saved essays", () => {
    const items = run(profile({ authorizedToWorkUS: "yes", requiresSponsorship: "no" }), bank);
    expect(items.filter((i) => i.kind === "legal-missing").map((i) => i.label)).toEqual(["Do you currently hold an active security clearance?"]);
    expect(items.find((i) => i.kind === "essay")?.saved).toBe(true);
    const lines = summarizePreflight(items);
    expect(lines[0]).toBe("1 written answer (1 with a saved answer)");
    expect(lines.some((l) => /legal question/.test(l))).toBe(true);
  });

  it("changes nothing on the page", () => {
    const before = document.documentElement.innerHTML;
    run(profile());
    expect(document.documentElement.innerHTML).toBe(before);
  });

  it("lists extra uploads such as a cover letter", () => {
    document.getElementById("resume")!.insertAdjacentHTML("afterend", `<label for="cl">Cover Letter</label><input id="cl" type="file" />`);
    expect(summarizePreflight(run(profile())).some((l) => /Cover Letter/.test(l))).toBe(true);
  });
});

describe("saved-answer suggestions and Save to answer bank", () => {
  beforeEach(() => {
    load("greenhouse");
    questionFields.clear();
  });
  const deps = () => ({ requestDraft: vi.fn(async () => ({ ok: true })), saveAnswer: vi.fn(async () => ({ ok: true })) });
  const why = () => document.getElementById("q_why") as HTMLTextAreaElement;
  const buttons = (row: HTMLElement) => [...row.querySelectorAll("button")].map((b) => b.textContent);

  it("suggests a saved answer for a similar question but does not write it", () => {
    const outcomes = fillForm(document.getElementById("application_form")!, profile(), { answers: bank });
    const o = outcomes.find((x) => /Why do you want/.test(x.label))!;
    expect(o.suggestion?.answer).toBe("Because of the dashboards.");
    expect(why().value).toBe("");
    const row = document.createElement("div");
    addQuestionActions(row, o, deps());
    expect(buttons(row)).toEqual(["Use this saved answer", "Draft with AI in Job Copilot", "Save my answer to the answer bank"]);
    row.querySelector<HTMLButtonElement>("button")!.click();
    expect(why().value).toBe("Because of the dashboards.");
  });

  it("saves what she typed herself, and asks her to type first when the box is empty", async () => {
    const o = fillForm(document.getElementById("application_form")!, profile()).find((x) => /Why do you want/.test(x.label))!;
    const d = deps();
    const row = document.createElement("div");
    addQuestionActions(row, o, d);
    const save = [...row.querySelectorAll("button")].find((b) => /Save my answer/.test(b.textContent!))!;
    save.click();
    expect(d.saveAnswer).not.toHaveBeenCalled();
    expect(save.textContent).toMatch(/Type your answer/);
    why().value = "I like reliable systems.";
    save.click();
    await vi.waitFor(() => expect(d.saveAnswer).toHaveBeenCalledWith(o.label, "I like reliable systems."));
    await vi.waitFor(() => expect(save.textContent).toBe("Saved to your answer bank."));
  });

  it("offers no buttons for legal or identity questions, even as free text", () => {
    document.body.innerHTML = `<form><label for="x">Please explain your work authorization status and any visa sponsorship needs</label><textarea id="x"></textarea></form>`;
    const outcomes = fillForm(document.body, profile(), { answers: [{ question: "Please explain your work authorization", answer: "x", tags: [] }] });
    const o = outcomes[0];
    expect(o.legal).toBe(true);
    expect(isOpenQuestion(o)).toBe(false);
    const row = document.createElement("div");
    addQuestionActions(row, o, deps());
    expect(row.querySelectorAll("button")).toHaveLength(0);
    expect((document.getElementById("x") as HTMLTextAreaElement).value).toBe("");
  });

  it("never offers a saved essay answer for a legal question in the bank either", () => {
    document.body.innerHTML = `<label for="v">Veteran status description</label><textarea id="v"></textarea>`;
    const o = fillForm(document.body, profile(), { answers: [{ question: "Veteran status description", answer: "none", tags: [] }] })[0];
    expect(o.suggestion).toBeUndefined();
  });
});
