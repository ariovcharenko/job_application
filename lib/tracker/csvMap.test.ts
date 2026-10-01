import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../csv";
import { blankApplication } from "./blank";
import { dedupeKey, exportCsv, importCsv, normalizeStage, normalizeWorkMode, parseDate } from "./csvMap";

describe("csv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields", () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi"""\n"line1\nline2",z\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["line1\nline2", "z"],
    ]);
  });

  it("round-trips through toCsv", () => {
    const rows = [["a", "b"], ["1,2", 'q"r'], ["multi\nline", ""]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("strips a BOM and CRLF line endings", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseDate", () => {
  it("reads ISO and Notion-style dates and date ranges", () => {
    expect(parseDate("2026-09-19")).toBe("2026-09-19");
    expect(parseDate("September 19, 2026")).toBe("2026-09-19");
    expect(parseDate("September 19, 2026 → September 25, 2026")).toBe("2026-09-19");
  });
  it("returns empty string for junk or blank", () => {
    expect(parseDate("")).toBe("");
    expect(parseDate("soon")).toBe("");
  });
});

describe("normalizeStage", () => {
  it.each([
    ["Applied", "Applied"],
    ["Rejected", "Rejected"],
    ["Waiting for the interview", "Waiting for interview"],
    ["Interview scheduled", "Waiting for interview"],
    ["Offer received", "Offer"],
    ["", "Saved"],
    ["something else", "Saved"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeStage(input)).toBe(expected);
  });
});

const NOTION_CSV = [
  "Company,Stage,Job Position,Job Position Link,Location,Apply Date,Respond Date,Referral,Tailored URL,Name of the person to reach out to,Their LinkedIn link,Priority",
  'Stripe,Applied,Software Engineer New Grad,https://stripe.com/jobs/1,"San Francisco, CA","September 19, 2026",,No,https://drive/x,Jane Doe,https://linkedin.com/in/jane,High',
  "Google,Rejected,UX Designer,https://g.co/2,Remote,2026-08-01,2026-08-15,Yes,,,,",
  ",,,,,,,,,,,",
].join("\n");

describe("importCsv with Alex's Notion columns", () => {
  const result = importCsv(NOTION_CSV, 1000);

  it("maps every column she listed", () => {
    expect(result.mapped["Company"]).toBe("company");
    expect(result.mapped["Job Position Link"]).toBe("url");
    expect(result.mapped["Name of the person to reach out to"]).toBe("contactName");
    expect(result.mapped["Their LinkedIn link"]).toBe("contactLinkedin");
    expect(result.mapped["Apply Date"]).toBe("appliedDate");
    expect(result.mapped["Respond Date"]).toBe("respondDate");
  });

  it("imports rows, skips the empty one and keeps quoted commas", () => {
    expect(result.applications).toHaveLength(2);
    const [stripe, google] = result.applications;
    expect(stripe).toMatchObject({
      company: "Stripe",
      stage: "Applied",
      role: "Software Engineer New Grad",
      location: "San Francisco, CA",
      appliedDate: "2026-09-19",
      referral: "No",
      contactName: "Jane Doe",
      contactLinkedin: "https://linkedin.com/in/jane",
      roleType: "Software Engineering",
    });
    expect(google).toMatchObject({ stage: "Rejected", respondDate: "2026-08-15", roleType: "Design (UX/UI)" });
  });

  it("keeps data from unmapped columns in notes instead of dropping it", () => {
    expect(result.unmapped).toEqual(["Priority"]);
    expect(result.applications[0].notes).toContain("Priority: High");
  });

  it("uses a Notion 'Name' title column as the company when there is no Company column", () => {
    const r = importCsv("Name,Stage\nAcme,Applied\n");
    expect(r.applications[0].company).toBe("Acme");
  });
});

describe("exportCsv", () => {
  it("round-trips through importCsv", () => {
    const a = {
      ...blankApplication(5),
      company: "Acme, Inc.",
      role: "AI Engineer",
      stage: "Waiting for interview" as const,
      appliedDate: "2026-09-01",
      respondDate: "2026-09-10",
      notes: 'said "call back"\nsecond line',
      roleType: "AI / ML" as const,
      visa: "opt-friendly" as const,
      fitScore: 82,
    };
    const back = importCsv(exportCsv([a]), 5).applications[0];
    expect(back).toMatchObject({
      company: a.company,
      role: a.role,
      stage: a.stage,
      appliedDate: a.appliedDate,
      respondDate: a.respondDate,
      notes: a.notes,
      roleType: "AI / ML",
      visa: "opt-friendly",
      fitScore: 82,
    });
  });
});

describe("work mode", () => {
  it.each([
    ["Remote", "Remote"],
    ["Hybrid (3 days)", "Hybrid"],
    ["On-site", "On-site"],
    ["In person", "On-site"],
    ["", "Unknown"],
    ["whatever", "Unknown"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeWorkMode(input)).toBe(expected);
  });

  it("uses the Work Mode column when present", () => {
    const r = importCsv("Company,Job Position,Location,Work Mode\nAcme,SWE,Irvine CA,Hybrid\n");
    expect(r.applications[0].workMode).toBe("Hybrid");
  });

  it("infers Remote from the location text when there is no Work Mode column", () => {
    const r = importCsv("Company,Job Position,Location\nAcme,SWE,Remote (US)\nBeta,SWE,Irvine CA\n");
    expect(r.applications.map((a) => a.workMode)).toEqual(["Remote", "Unknown"]);
  });

  it("round-trips through export", () => {
    const a = { ...blankApplication(1), company: "Acme", role: "SWE", workMode: "Hybrid" as const };
    expect(importCsv(exportCsv([a])).applications[0].workMode).toBe("Hybrid");
  });
});

describe("dedupeKey", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(dedupeKey({ company: " Stripe ", role: "SWE", url: "HTTPS://X" })).toBe(
      dedupeKey({ company: "stripe", role: "swe ", url: "https://x" }),
    );
  });
});

describe("importCsv with common tracker headers (Airtable, Google Sheets, Excel)", () => {
  it("maps Company Name, Title, Status, Date Applied and Link", () => {
    const csv = "Company Name,Title,Status,Date Applied,Link\nAcme,Data Analyst,Applied,2026-09-01,https://acme.example/jobs/1\n";
    const { applications, unmapped } = importCsv(csv, 1);
    expect(unmapped).toEqual([]);
    expect(applications[0]).toMatchObject({
      company: "Acme",
      role: "Data Analyst",
      stage: "Applied",
      appliedDate: "2026-09-01",
      url: "https://acme.example/jobs/1",
      roleType: "Data & Analytics",
    });
  });

  it("maps Job Title and URL", () => {
    const { applications } = importCsv("Company,Job Title,URL\nBeta,iOS Engineer,https://beta.example/1\n", 1);
    expect(applications[0]).toMatchObject({ role: "iOS Engineer", url: "https://beta.example/1", roleType: "Mobile" });
  });
});
