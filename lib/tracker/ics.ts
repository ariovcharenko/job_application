import type { Application } from "../types";
import { todayISO } from "./stage";

// A calendar file (.ics, RFC 5545) of her follow-ups, to import into Apple Calendar, Google
// Calendar or Outlook. All-day events; each job keeps the same UID, so importing again updates the
// event instead of adding a copy.

export interface CalendarEvent {
  uid: string;
  /** Local day, "YYYY-MM-DD". */
  date: string;
  summary: string;
  description?: string;
  url?: string;
}

/** Escapes TEXT values (RFC 5545 3.3.11): backslash, semicolon, comma and line breaks. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds a content line to at most 75 octets per line (RFC 5545 3.1): continuation lines start with
 * one space. Counts UTF-8 bytes and never splits a character.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines spend one octet on the space
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");
const pad = (n: number) => String(n).padStart(2, "0");

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

/** UTC timestamp in the form 20261010T120000Z. */
function stamp(now: Date): string {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function buildIcs(events: CalendarEvent[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Job Copilot//Follow-ups//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Job follow-ups"];
  for (const e of events) {
    if (!ISO_DAY.test(e.date)) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compactDate(e.date)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${escapeText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]/g, "")}`);
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * One event per job still waiting on a follow-up: applied, no reply yet, follow-up date set (applied
 * + 7 days, or a snooze). An overdue one goes on today, so it isn't buried in the past.
 */
export function followUpEvents(apps: Application[], today = todayISO()): CalendarEvent[] {
  return apps
    .filter((a) => a.id !== undefined && a.stage === "Applied" && !a.respondDate && ISO_DAY.test(a.followUpDate ?? "") && a.triage !== "skipped")
    .map((a) => {
      const what = [a.role, a.company].filter(Boolean).join(" at ") || "a job";
      return {
        uid: `follow-up-${a.id}@job-copilot`,
        date: a.followUpDate < today ? today : a.followUpDate,
        summary: `Follow up: ${what}`,
        description: `You applied${a.appliedDate ? ` on ${a.appliedDate}` : ""} and haven't heard back. Send a short follow-up, then mark it Done in Job Copilot.`,
        url: /^https?:\/\//i.test(a.url ?? "") ? a.url : undefined,
      };
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}
