import { describe, expect, it } from "vitest";
import { blankApplication } from "./blank";
import { buildIcs, escapeText, foldLine, followUpEvents } from "./ics";
import type { Application } from "../types";

const NOW = new Date(Date.UTC(2026, 9, 10, 12, 30, 5));

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma and newlines", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds at 75 octets with a leading space on each continuation", () => {
    const folded = foldLine(`DESCRIPTION:${"x".repeat(200)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(new TextEncoder().encode(parts[0]).length).toBe(75);
    for (const p of parts.slice(1)) {
      expect(p.startsWith(" ")).toBe(true);
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
    // Unfolding gives back the original.
    expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
  });

  it("counts UTF-8 bytes and never splits a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const parts = foldLine(line).split("\r\n");
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(foldLine(line).replace(/\r\n /g, "")).toBe(line);
  });
});

describe("buildIcs", () => {
  const ics = buildIcs([{ uid: "follow-up-1@job-copilot", date: "2026-12-31", summary: "Follow up: Engineer, Platform at Acme; Inc", url: "https://example.com/jobs/1" }], NOW);

  it("is a complete calendar with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes all-day events with UID, DTSTAMP and an exclusive end date", () => {
    expect(ics).toContain("UID:follow-up-1@job-copilot\r\n");
    expect(ics).toContain("DTSTAMP:20261010T123005Z\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101\r\n");
    expect(ics).toContain("SUMMARY:Follow up: Engineer\\, Platform at Acme\\; Inc\r\n");
    expect(ics).toContain("URL:https://example.com/jobs/1\r\n");
  });

  it("skips events without a valid date", () => {
    expect(buildIcs([{ uid: "x", date: "soon", summary: "s" }], NOW)).not.toContain("BEGIN:VEVENT");
  });
});

describe("followUpEvents", () => {
  const job = (o: Partial<Application>): Application => ({ ...blankApplication(), id: 1, company: "Acme", role: "Engineer", stage: "Applied", appliedDate: "2026-10-01", followUpDate: "2026-10-08", ...o });

  it("lists applied jobs still waiting on a reply, overdue ones on today", () => {
    const events = followUpEvents(
      [
        job({ id: 1 }),
        job({ id: 2, followUpDate: "2026-10-15" }),
        job({ id: 3, respondDate: "2026-10-05" }),
        job({ id: 4, stage: "Saved" }),
        job({ id: 5, followUpDate: "" }),
        job({ id: 6, triage: "skipped" }),
      ],
      "2026-10-10",
    );
    expect(events.map((e) => [e.uid, e.date])).toEqual([
      ["follow-up-1@job-copilot", "2026-10-10"],
      ["follow-up-2@job-copilot", "2026-10-15"],
    ]);
    expect(events[0].summary).toBe("Follow up: Engineer at Acme");
  });

  it("only keeps web links", () => {
    expect(followUpEvents([job({ url: "javascript:alert(1)" })], "2026-10-10")[0].url).toBeUndefined();
  });
});
