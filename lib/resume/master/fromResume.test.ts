import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, JsonOptions } from "../../ai/provider";
import { db, getMasterProfile, getProfile, saveMasterProfile, saveProfile } from "../../db";
import { DEFAULT_PROFILE } from "../../defaults";
import { buildSystemPrompt } from "../engine/prompt";
import { validateResume } from "../engine/validate";
import { parseMasterExperiences } from "./experiences";
import { readResumeUpload, type ResumeSource } from "./extractText";
import {
  checkImport,
  CONTACT_FIELDS,
  contactOffers,
  IMPORT_SYSTEM_PROMPT,
  importResume,
  normalizeDegree,
  normalizeGraduation,
  numbersNotInSource,
  saveImport,
  type ImportedContact,
} from "./fromResume";
import { parseSkillInventory } from "./skills";

const FIXTURE = readFileSync(fileURLToPath(new URL("../../docx/__fixtures__/sample-resume.docx", import.meta.url)));
const fixtureFile = () => ({
  name: "Resume.docx",
  size: FIXTURE.byteLength,
  arrayBuffer: async () => FIXTURE.buffer.slice(FIXTURE.byteOffset, FIXTURE.byteOffset + FIXTURE.byteLength) as ArrayBuffer,
});

// What a faithful transcription of the fixture looks like (the model's answer, mocked). The en dash
// in the first heading is what a model might copy from the Word file; code turns it into " - ".
const TRANSCRIBED = `### Education
**Lakeside University**, Austin, TX
Bachelor of Computer Science, Minor in Data Science | Sep 2022 - Jun 2026
- Relevant coursework: Cloud Computing, Data Structures & Algorithms, Software Development, Operating Systems, Data Mining, Machine Learning, Business Statistics

### Experience
**Founding Software Engineer | Taskwise | Remote | Oct 2025 – Present**
- Built and deployed a habit tracking platform serving 80+ early users, enabling faster daily execution by reducing manual goal planning time by ~35%.
- Implemented basic monitoring using Prometheus and Grafana, and ran load tests with k6 simulating ~60 concurrent users, measuring API latency (p95 ~250-450 ms) and maintaining >99% uptime during test runs.

**Founding Software Engineer | DemoDeck | Remote | May 2025 - Aug 2025**
- Developed a React 18 and TypeScript frontend with protected routes, JWT-based authentication, and statedriven interview flows supporting behavioral and coding modes.
- Integrated AWS S3 for resume uploads and retrieval, implementing multipart file uploads and handling validation and error cases.

### Skills inventory
- **Programming Languages:** TypeScript, Java, Python, JavaScript
- **Frontend:** React, Next.js, Tailwind CSS, HTML/CSS
- **Backend:** Spring Boot, Node.js, REST APIs, PostgreSQL, MySQL
- **Cloud Platforms:** AWS, GCP
- **Tools:** Git, GitHub, Figma, k6, Prometheus, Grafana

### Leadership & Involvement
- Robotics Club, Team Lead at Lakeside University | Oct 2023 - Present`;

const CONTACT: ImportedContact = {
  fullName: "Alex Rivera",
  email: "mailto:alex.rivera@example.com",
  phone: "",
  location: "Austin, TX",
  linkedin: "www.linkedin.com/in/alex-rivera/",
  github: "https://github.com/alexrivera",
  portfolio: "https://alexrivera.dev/",
  school: "Lakeside University",
  degreeType: "Bachelor of Computer Science",
  major: "Computer Science",
  graduation: "Jun 2026",
};

function mockProvider(answer: unknown) {
  const completeJson = vi.fn(async <T,>(opts: JsonOptions<T>) => (opts.parse ? opts.parse(answer) : (answer as T)));
  const provider = { id: "mock", completeJson, complete: vi.fn(), listModels: vi.fn(), testConnection: vi.fn() } as unknown as AIProvider;
  return { provider, completeJson };
}

beforeEach(async () => {
  await Promise.all([db.profile.clear(), db.docs.clear()]);
});

describe("importResume", () => {
  it("sends Word text (not the file) to the smart model at medium effort, with transcribe-don't-improve rules", async () => {
    const source = await readResumeUpload(fixtureFile());
    const { provider, completeJson } = mockProvider({ masterProfile: TRANSCRIBED, contact: CONTACT });
    await importResume(provider, source);
    const opts = completeJson.mock.calls[0][0];
    expect(opts).toMatchObject({ tier: "smart", effort: "medium" });
    expect(opts.attachments).toBeUndefined();
    expect(opts.prompt).toContain("Taskwise");
    expect(opts.system).toMatch(/Transcribe, don't improve/);
    expect(opts.system).toMatch(/verbatim/);
    expect(opts.system).toMatch(/numbers? exactly/);
    expect(opts.system).toContain("### Skills inventory");
    expect(opts.system).toContain("**Title | Company | City, ST | Mon YYYY - Mon YYYY**");
    expect(opts.system).toMatch(/Never include[\s\S]*Work authorization, visa status, sponsorship/);
  });

  it("sends a PDF as a document attachment", async () => {
    const source: ResumeSource = { kind: "pdf", fileName: "r.pdf", base64: "JVBERi0=", bytes: new ArrayBuffer(4) };
    const { provider, completeJson } = mockProvider({ masterProfile: TRANSCRIBED, contact: CONTACT });
    await importResume(provider, source);
    expect(completeJson.mock.calls[0][0].attachments).toEqual([{ mediaType: "application/pdf", base64: "JVBERi0=" }]);
  });

  it("round-trips the DOCX fixture into experience text the engine accepts", async () => {
    const source = await readResumeUpload(fixtureFile());
    const { provider } = mockProvider({ masterProfile: TRANSCRIBED, contact: CONTACT });
    const out = await importResume(provider, source);

    expect(out.masterProfile).toContain("**Founding Software Engineer | Taskwise | Remote | Oct 2025 - Present**");
    const check = checkImport(out.masterProfile, source.kind === "text" ? source.text : null);
    expect(check.missing).toEqual([]);
    expect(check.roles).toBe(2);
    expect(check.skills).toBeGreaterThan(10);
    expect(check.numbers).toEqual([]); // every number came from the Word file
    expect(check.legalLines).toEqual([]);

    // A resume built from it passes the engine's fact check with nothing flagged.
    const entry = parseMasterExperiences(out.masterProfile)[0];
    const bullets = out.masterProfile.split("\n").filter((l) => l.startsWith("- Built and deployed")).map((l) => l.slice(2));
    const result = validateResume(
      {
        education: [],
        experience: [{ title: entry.title, company: entry.company, location: entry.location, dates: entry.dates, bullets }],
        skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
        leadership: [],
        meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
      },
      out.masterProfile,
    );
    expect(result.flags).toEqual([]);
    expect(buildSystemPrompt(out.masterProfile)).toContain("Taskwise");
  });

  it("normalizes the contact details", async () => {
    const { provider } = mockProvider({ masterProfile: TRANSCRIBED, contact: CONTACT });
    const { contact } = await importResume(provider, { kind: "text", origin: "paste", fileName: "Pasted text", text: "x" });
    expect(contact.email).toBe("alex.rivera@example.com");
    expect(contact.linkedin).toBe("https://www.linkedin.com/in/alex-rivera/");
    expect(contact.graduation).toBe("2026-06");
    expect(contact.degreeType).toBe("Bachelor of Science (B.S.)");
  });

  it("writes nothing to the database (Cancel on the review screen leaves everything unchanged)", async () => {
    await saveMasterProfile("OLD");
    await saveProfile({ ...DEFAULT_PROFILE, fullName: "Old Name" });
    const { provider } = mockProvider({ masterProfile: TRANSCRIBED, contact: CONTACT });
    await importResume(provider, await readResumeUpload(fixtureFile()));
    expect(await getMasterProfile()).toBe("OLD");
    expect((await getProfile()).fullName).toBe("Old Name");
  });

  it("reports an answer in the wrong shape as invalid output", async () => {
    const { provider } = mockProvider({ masterProfile: 3 });
    await expect(importResume(provider, { kind: "text", origin: "paste", fileName: "p", text: "x" })).rejects.toThrow();
  });
});

describe("checkImport", () => {
  it("asks for a role and a skill when either is missing", () => {
    const c = checkImport("### Education\n**School**, City", null);
    expect(c.missing).toHaveLength(2);
    expect(c.missing[0]).toMatch(/couldn't find any roles/);
    expect(c.missing[1]).toMatch(/couldn't find any skills/);
    expect(c.numbers).toBeNull();
  });

  it("finds numbers the original doesn't have, with their line", () => {
    const source = "Grew signups 40% to 1,200 users in 2024";
    const draft = "### Experience\n**PM | Acme | Remote | Jan 2024 - Present**\n- Grew signups 45% to 1200 users";
    expect(numbersNotInSource(draft, source)).toEqual([{ number: "45", line: 3, text: "- Grew signups 45% to 1200 users" }]);
  });

  it("treats 4.00 and 4, and 1,200 and 1200, as the same number", () => {
    expect(numbersNotInSource("GPA 3.85/4 and 1200 users", "GPA: 3.85/4.00, 1,200 users")).toEqual([]);
  });

  it("points out lines about legal or identity status", () => {
    const c = checkImport("### Experience\n- US citizen, no sponsorship needed\n- Built an F1 score dashboard", null);
    expect(c.legalLines).toEqual([{ line: 2, text: "- US citizen, no sponsorship needed" }]);
  });
});

describe("contact checklist and saving", () => {
  const filled = { ...DEFAULT_PROFILE, fullName: "Typed By Her", email: "", requiresSponsorship: "yes" as const, visaStatus: "F-1 OPT" };

  it("offers only fields that are empty in the Profile, and never legal or EEO fields", () => {
    const offers = contactOffers(filled, { ...CONTACT, email: "a@b.co" });
    const keys = offers.map((o) => o.key);
    expect(keys).not.toContain("fullName");
    expect(keys).toContain("email");
    for (const legal of ["authorizedToWorkUS", "requiresSponsorship", "visaStatus", "gender", "race", "veteran", "disability"]) {
      expect(CONTACT_FIELDS.map((f) => f.key as string)).not.toContain(legal);
      expect(keys as string[]).not.toContain(legal);
    }
  });

  it("saves the experience and fills only the ticked, still-empty fields; legal answers are untouched", async () => {
    await saveProfile(filled);
    const sneaky = { ...CONTACT, email: "a@b.co", requiresSponsorship: "no", visaStatus: "US citizen" } as unknown as ImportedContact;
    await saveImport(TRANSCRIBED, sneaky, ["fullName", "email", "location", "requiresSponsorship" as never, "visaStatus" as never]);
    const p = await getProfile();
    expect(p.fullName).toBe("Typed By Her"); // already set: never overwritten
    expect(p.email).toBe("a@b.co");
    expect(p.location).toBe("Austin, TX");
    expect(p.github).toBe(""); // not ticked
    expect(p.requiresSponsorship).toBe("yes");
    expect(p.visaStatus).toBe("F-1 OPT");
    expect(await getMasterProfile()).toBe(TRANSCRIBED);
    expect(parseSkillInventory(await getMasterProfile()).length).toBeGreaterThan(0);
  });
});

describe("normalizers", () => {
  it("reads graduation dates in common shapes", () => {
    expect(normalizeGraduation("2027-5")).toBe("2027-05");
    expect(normalizeGraduation("05/2027")).toBe("2027-05");
    expect(normalizeGraduation("December 2026")).toBe("2026-12");
    expect(normalizeGraduation("2027")).toBe("");
    expect(normalizeGraduation("Spring 2027")).toBe("");
  });

  it("maps degree wording onto the Profile's choices", () => {
    expect(normalizeDegree("B.S. in Computer Science")).toBe("Bachelor of Science (B.S.)");
    expect(normalizeDegree("Bachelor of Arts")).toBe("Bachelor of Arts (B.A.)");
    expect(normalizeDegree("Master of Science")).toBe("Master of Science (M.S.)");
    expect(normalizeDegree("MBA")).toBe("Master of Business Administration (MBA)");
    expect(normalizeDegree("Ph.D.")).toBe("Doctorate (Ph.D.)");
    expect(normalizeDegree("Certificate")).toBe("");
  });

  it("the prompt lists no legal field to extract", () => {
    const contactPart = IMPORT_SYSTEM_PROMPT.slice(IMPORT_SYSTEM_PROMPT.indexOf("## contact"));
    expect(contactPart).not.toMatch(/sponsor|visa|authoriz|gender|veteran|disab/i);
  });
});
