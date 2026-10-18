import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { pickAdapter } from "./adapters";
import { fillForm } from "./fillEngine";
import { isAccountPage } from "./guards";
import { matchJob } from "./jobMatch";
import { BLANK_SYNCED_DATA, type SyncedExperience, type SyncedProfile } from "../types";

// Fictional pages shaped like Greenhouse, Lever, Ashby and Workday forms (see __fixtures__). They
// are NOT copies of real pages, and the real sites change their markup, so these prove the engine's
// behavior on those shapes, not that a live form works.

const load = (name: string) => {
  document.documentElement.innerHTML = readFileSync(join(__dirname, "__fixtures__", `${name}.html`), "utf8");
};
const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
const sel = (id: string) => {
  const s = document.getElementById(id) as HTMLSelectElement;
  return s.options[s.selectedIndex].text;
};

const profile = (o: Partial<SyncedProfile> = {}): SyncedProfile => ({
  ...BLANK_SYNCED_DATA.profile,
  fullName: "Alex Rivera",
  email: "alex@example.com",
  phone: "555-0100",
  location: "Chicago, IL",
  linkedin: "https://linkedin.com/in/alex-example",
  github: "https://github.com/alex-example",
  portfolio: "https://alex.example.com",
  school: "Lakeside University",
  major: "Computer Science",
  degreeType: "Bachelor's degree",
  gpa: "3.8",
  ...o,
});

const experiences: SyncedExperience[] = [
  { title: "Software Engineer Intern", company: "Brightloop", location: "Chicago, IL", dates: "May 2026 - Aug 2026", section: "Experience", bullets: ["Built a queue that cut latency **40%**.", "Wrote tests."] },
  { title: "Developer", company: "Taskwise", location: "Remote", dates: "Jun 2025 - Aug 2025", section: "Experience", bullets: ["Shipped a dashboard."] },
  { title: "Side project", company: "DemoDeck", location: "", dates: "2025", section: "Projects", bullets: ["Not a job."] },
];

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
});

describe("Greenhouse-shaped form", () => {
  beforeEach(() => load("greenhouse"));

  it("picks the greenhouse adapter, reads the job, scopes to the form and finds the resume input", () => {
    const a = pickAdapter({ hostname: "job-boards.greenhouse.io" });
    expect(a.name).toBe("greenhouse");
    expect(a.pageJobInfo?.(document)).toEqual({ company: "Brightloop", role: "Backend Engineer" });
    expect(a.findFormRoot(document)).toBe(document.getElementById("application_form"));
    expect(a.findResumeInput(document)?.id).toBe("resume");
  });

  it("fills the basics, links and EEO (decline when blank) and answers legal questions only from the profile", () => {
    const root = document.getElementById("application_form")!;
    fillForm(root, profile({ authorizedToWorkUS: "yes", requiresSponsorship: "no" }));
    expect([val("first_name"), val("last_name"), val("email"), val("phone")]).toEqual(["Alex", "Rivera", "alex@example.com", "555-0100"]);
    expect([val("q_linkedin"), val("q_site")]).toEqual(["https://linkedin.com/in/alex-example", "https://alex.example.com"]);
    expect(sel("q_auth")).toBe("Yes");
    expect(sel("q_spons")).toBe("No");
    expect(sel("eeo_gender")).toBe("Decline To Self Identify");
    expect(sel("eeo_race")).toBe("Decline To Self Identify");
    expect(sel("eeo_vet")).toBe("I don't wish to answer");
    expect(sel("eeo_dis")).toBe("I do not want to answer");
  });

  it("leaves legal questions blank and flagged when the profile has no answer, and never touches clearance", () => {
    const root = document.getElementById("application_form")!;
    const outcomes = fillForm(root, profile());
    expect(sel("q_auth")).toBe("Please select");
    expect(sel("q_spons")).toBe("Please select");
    expect(sel("q_clear")).toBe("Please select");
    expect(outcomes.filter((o) => o.status === "skipped-no-data" && /legal/i.test(o.reason ?? "")).map((o) => o.label)).toHaveLength(2);
    expect(outcomes.find((o) => /clearance/i.test(o.label))?.status).not.toBe("filled");
  });

  it("does not type into the search-as-you-type location box, the consent box, the unknown dropdown or the essay", () => {
    const root = document.getElementById("application_form")!;
    const outcomes = fillForm(root, profile());
    expect(val("candidate-location")).toBe("");
    expect((document.getElementById("q_consent") as HTMLInputElement).checked).toBe(false);
    expect(sel("q_hear")).toBe("Please select");
    expect(val("q_why")).toBe("");
    expect(outcomes.find((o) => /Location \(City\)/.test(o.label))?.status).toBe("skipped-needs-review");
    expect(outcomes.find((o) => /Why do you want/.test(o.label))?.reason).toMatch(/Free-text/);
  });

  it("never clicks Submit", () => {
    let clicked = false;
    document.getElementById("submit_app")!.addEventListener("click", () => (clicked = true));
    fillForm(document.getElementById("application_form")!, profile());
    expect(clicked).toBe(false);
  });
});

describe("Lever-shaped form", () => {
  beforeEach(() => load("lever"));

  it("reads the job from the title and headline and finds the resume input", () => {
    const a = pickAdapter({ hostname: "jobs.lever.co" });
    expect(a.pageJobInfo?.(document)).toEqual({ company: "Brightloop", role: "Backend Engineer" });
    expect(a.findResumeInput(document)?.name).toBe("resume");
  });

  it("fills the single name field, links, and labelled radio questions", () => {
    fillForm(document.querySelector("form")!, profile({ authorizedToWorkUS: "yes", requiresSponsorship: "no", gender: "Female" }));
    expect((document.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Alex Rivera");
    expect((document.querySelector('input[name="email"]') as HTMLInputElement).value).toBe("alex@example.com");
    expect((document.querySelector('input[name="urls[GitHub]"]') as HTMLInputElement).value).toBe("https://github.com/alex-example");
    expect((document.querySelector('input[name="location"]') as HTMLInputElement).value).toBe("Chicago, IL");
    expect((document.querySelector('input[name="cards[a1][field0]"][value="Yes"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[name="cards[a2][field0]"][value="No"]') as HTMLInputElement).checked).toBe(true);
    expect(sel_by_name("eeo[gender]")).toBe("Female");
  });

  it("leaves both radio questions unchecked with no stored answers", () => {
    fillForm(document.querySelector("form")!, profile());
    expect(document.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0);
  });

  it("flags the open question for an AI draft instead of writing it", () => {
    const outcomes = fillForm(document.querySelector("form")!, profile());
    expect(outcomes.find((o) => /project you are proud/i.test(o.label))?.reason).toMatch(/Free-text/);
  });
});
function sel_by_name(name: string) {
  const s = document.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
  return s.options[s.selectedIndex].text;
}

/** Mimics React's controlled inputs: React keeps its own copy of `value` and only reacts to an
 * input event when the DOM value differs from that copy. A plain `el.value = x` updates the copy
 * too (so React ignores it); only the prototype's native setter gets through. */
function makeReactControlled(root: ParentNode): Map<string, string> {
  const state = new Map<string, string>();
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=file]), textarea")) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value")!;
    let tracked = "";
    Object.defineProperty(el, "value", { configurable: true, get: () => desc.get!.call(el), set: (v: string) => ((tracked = String(v)), desc.set!.call(el, v)) });
    el.addEventListener("input", () => {
      const current = desc.get!.call(el);
      if (current !== tracked) {
        tracked = current;
        state.set(el.id, current);
      }
    });
  }
  return state;
}

describe("Ashby-shaped form (React-controlled inputs)", () => {
  beforeEach(() => load("ashby"));

  it("reads the job from the title and finds the resume input", () => {
    const a = pickAdapter({ hostname: "jobs.ashbyhq.com" });
    expect(a.pageJobInfo?.(document)).toEqual({ role: "Backend Engineer", company: "Brightloop" });
    expect(a.findResumeInput(document)?.id).toBe("_systemfield_resume");
  });

  it("gets values into React state, which a plain value assignment would not", () => {
    const state = makeReactControlled(document);
    fillForm(document.querySelector("form")!, profile());
    expect(state.get("_systemfield_name")).toBe("Alex Rivera");
    expect(state.get("_systemfield_email")).toBe("alex@example.com");
    expect(state.get("f-phone")).toBe("555-0100");
    expect(state.get("f-linkedin")).toBe("https://linkedin.com/in/alex-example");
    expect(state.get("f-github")).toBe("https://github.com/alex-example");
    expect(state.has("f-why")).toBe(false);
  });

  it("does not click the Yes/No buttons or the submit button", () => {
    const clicks: string[] = [];
    document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => clicks.push(b.textContent ?? "")));
    fillForm(document.querySelector("form")!, profile({ authorizedToWorkUS: "yes" }));
    expect(clicks).toEqual([]);
  });
});

describe("Workday-shaped flow", () => {
  it("never fills a sign-in or account page, and says why", () => {
    load("workday-signin");
    expect(isAccountPage(document, { pathname: "/en-US/Careers/login" })).toBe(true);
    expect(isAccountPage(document)).toBe(true);
    // Even if the filler were called, a password field is never touched.
    fillForm(document.body, profile());
    expect(val("password")).toBe("");
  });

  it("recognizes account pages by URL alone", () => {
    expect(isAccountPage(document, { pathname: "/Careers/create-account" })).toBe(true);
    expect(isAccountPage(document, { pathname: "/Careers/job/Remote/Backend-Engineer_R-10234/apply" })).toBe(false);
  });

  it("fills My Information, matching the phone number but not the phone device type", () => {
    load("workday-info");
    expect(isAccountPage(document)).toBe(false);
    const a = pickAdapter({ hostname: "brightloop.wd5.myworkdayjobs.com" });
    fillForm(document.body, profile());
    expect([val("wd-first"), val("wd-last"), val("wd-email"), val("wd-phone"), val("wd-city")]).toEqual(["Alex", "Rivera", "alex@example.com", "555-0100", "Chicago, IL"]);
    expect(sel("wd-device")).toBe("Select One");
    expect(a.name).toBe("workday");
    expect(a.pageJobInfo?.(document, "brightloop.wd5.myworkdayjobs.com")).toEqual({ role: "Backend Engineer", company: "brightloop" });
  });

  it("fills repeated work blocks from Your experience in order, not the profile's home city, and skips projects and dates", () => {
    load("workday-experience");
    const outcomes = fillForm(document.body, profile(), { experiences });
    expect([val("we1-title"), val("we1-company"), val("we1-loc")]).toEqual(["Software Engineer Intern", "Brightloop", "Chicago, IL"]);
    expect(val("we1-desc")).toBe("- Built a queue that cut latency 40%.\n- Wrote tests.");
    expect([val("we2-title"), val("we2-company")]).toEqual(["Developer", "Taskwise"]);
    expect(val("we1-from")).toBe("");
    expect(outcomes.find((o) => /Work experience 1: From/.test(o.label))?.reason).toContain("May 2026 - Aug 2026");
    expect([val("ed1-school"), val("ed1-field"), val("ed1-gpa")]).toEqual(["Lakeside University", "Computer Science", "3.8"]);
    expect(val("wd-linkedin")).toBe("https://linkedin.com/in/alex-example");
    expect(outcomes.some((o) => /More work experience/.test(o.label))).toBe(false);
  });

  it("tells her to click Add herself when she has more roles than blocks, and never clicks it", () => {
    load("workday-experience");
    document.querySelector('[data-automation-id="workExperience-2"]')!.remove();
    const outcomes = fillForm(document.body, profile(), { experiences });
    expect(outcomes.find((o) => /More work experience/.test(o.label))?.reason).toMatch(/Click Add yourself/);
  });

  it("onlyEmpty leaves what is already filled alone (the next-step refill)", () => {
    load("workday-info");
    (document.getElementById("wd-first") as HTMLInputElement).value = "Alexandra";
    fillForm(document.body, profile(), { onlyEmpty: true });
    expect(val("wd-first")).toBe("Alexandra");
    expect(val("wd-last")).toBe("Rivera");
  });
});

describe("matching fixture pages to saved jobs", () => {
  it("finds the job by company and role when the saved job has no link", () => {
    load("greenhouse");
    const info = pickAdapter({ hostname: "boards.greenhouse.io" }).pageJobInfo!(document);
    const jobs = [{ id: 5, company: "Brightloop", role: "Backend Engineer", url: "", stage: "Saved" }];
    expect(matchJob(jobs, "https://boards.greenhouse.io/embed/job_app?token=1", info)?.job.id).toBe(5);
  });
});
