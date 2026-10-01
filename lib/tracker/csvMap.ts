import { parseCsv, toCsv } from "../csv";
import { looksRemote } from "../regions";
import { WORK_MODES, type WorkMode } from "../options";
import { normalizeRoleType } from "../eligibility/roles";
import { STAGES, VISA_SIGNALS, type Application, type Stage, type VisaSignal } from "../types";
import { blankApplication } from "./blank";

// Role types moved to lib/eligibility/roles.ts; re-exported for existing importers.
export { normalizeRoleType };

type TextField =
  | "company"
  | "role"
  | "url"
  | "location"
  | "appliedDate"
  | "respondDate"
  | "referral"
  | "tailoredUrl"
  | "contactName"
  | "contactLinkedin"
  | "salary"
  | "source"
  | "followUpDate"
  | "notes";
type Field = TextField | "stage" | "roleType" | "visa" | "fitScore" | "workMode";

// Accepted CSV header names (normalized: lowercase, punctuation collapsed) in priority order.
const ALIASES: Record<Field, string[]> = {
  company: ["company", "company name", "employer", "organization", "name"],
  stage: ["stage", "status", "application status"],
  role: ["job position", "position", "job title", "role", "title", "position title"],
  url: ["job position link", "position link", "job link", "job url", "posting link", "posting url", "link", "url"],
  location: ["location", "job location"],
  workMode: ["work mode", "work type", "location type", "arrangement", "remote"],
  appliedDate: ["apply date", "applied date", "date applied", "applied on", "application date", "applied"],
  respondDate: ["respond date", "response date", "responded", "reply date"],
  referral: ["referral", "referred by"],
  tailoredUrl: ["tailored url", "tailored resume", "tailored resume url", "resume url", "resume link"],
  contactName: [
    "name of the person to reach out to",
    "person to reach out to",
    "reach out to",
    "contact name",
    "contact",
  ],
  contactLinkedin: ["their linkedin link", "their linkedin", "contact linkedin", "linkedin link", "linkedin"],
  roleType: ["role type", "job type", "category"],
  salary: ["salary", "pay", "compensation"],
  source: ["source", "found on"],
  visa: ["visa signal", "visa", "sponsorship"],
  followUpDate: ["follow up date", "follow up", "followup date"],
  notes: ["notes", "note", "comments"],
  fitScore: ["fit score", "score"],
};

// Export order and header text (the original tracker's fields first, then the added ones).
const EXPORT_COLUMNS: [Field, string][] = [
  ["company", "Company"],
  ["stage", "Stage"],
  ["role", "Job Position"],
  ["url", "Job Position Link"],
  ["location", "Location"],
  ["workMode", "Work Mode"],
  ["appliedDate", "Apply Date"],
  ["respondDate", "Respond Date"],
  ["referral", "Referral"],
  ["tailoredUrl", "Tailored URL"],
  ["contactName", "Name of the person to reach out to"],
  ["contactLinkedin", "Their LinkedIn link"],
  ["roleType", "Role Type"],
  ["salary", "Salary"],
  ["source", "Source"],
  ["visa", "Visa Signal"],
  ["followUpDate", "Follow-up Date"],
  ["fitScore", "Fit Score"],
  ["notes", "Notes"],
];

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function normalizeStage(raw: string): Stage {
  const s = raw.trim().toLowerCase();
  if (!s) return "Saved";
  if (/reject|declin|denied|not selected|unsuccessful/.test(s)) return "Rejected";
  if (s.includes("offer")) return "Offer";
  if (s.includes("interview") || s.includes("wait")) return "Waiting for interview";
  if (s.includes("appl")) return "Applied";
  const exact = STAGES.find((x) => x.toLowerCase() === s);
  return exact ?? "Saved";
}

export function normalizeWorkMode(raw: string): WorkMode | "Unknown" {
  const s = raw.trim().toLowerCase();
  if (!s) return "Unknown";
  if (s.includes("hybrid")) return "Hybrid";
  if (s.includes("remote")) return "Remote";
  if (/on.?site|in.?person|in.?office|office/.test(s)) return "On-site";
  return WORK_MODES.find((m) => m.toLowerCase() === s) ?? "Unknown";
}

function normalizeVisa(raw: string): VisaSignal {
  const s = raw.trim().toLowerCase();
  return VISA_SIGNALS.find((x) => x === s) ?? "unknown";
}

/** Accepts ISO dates and Notion-style dates ("September 19, 2026", ranges use the first date). Returns "" if unreadable. */
export function parseDate(raw: string): string {
  const first = raw.split(/→|->| to /)[0].trim();
  if (!first) return "";
  const iso = first.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(first);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ImportResult {
  applications: Application[];
  /** CSV header -> field it was mapped to. */
  mapped: Record<string, string>;
  /** Headers with no matching field. Their non-empty values are appended to Notes so nothing is lost. */
  unmapped: string[];
}

const DATE_FIELDS: TextField[] = ["appliedDate", "respondDate", "followUpDate"];

export function importCsv(text: string, now: number = Date.now()): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { applications: [], mapped: {}, unmapped: [] };

  const headers = rows[0].map((h) => h.trim());
  const norm = headers.map(normalizeHeader);

  // Field -> column index, first alias that exists wins; a column can only be used once.
  const colFor = new Map<Field, number>();
  const used = new Set<number>();
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const idx = norm.findIndex((h, i) => h === alias && !used.has(i));
      if (idx !== -1) {
        colFor.set(field, idx);
        used.add(idx);
        break;
      }
    }
  }

  const mapped: Record<string, string> = {};
  for (const [field, idx] of colFor) mapped[headers[idx]] = field;
  const unmapped = headers.filter((_, i) => !used.has(i) && headers[i] !== "");

  const applications: Application[] = [];
  for (const row of rows.slice(1)) {
    const cell = (f: Field) => (colFor.has(f) ? (row[colFor.get(f)!] ?? "").trim() : "");
    const app = blankApplication(now);

    for (const f of Object.keys(ALIASES) as Field[]) {
      if (f === "stage" || f === "roleType" || f === "visa" || f === "fitScore" || f === "workMode") continue;
      const v = cell(f);
      app[f as TextField] = DATE_FIELDS.includes(f as TextField) ? parseDate(v) : v;
    }
    app.stage = normalizeStage(cell("stage"));
    // Use the Work Mode column if there is one; otherwise infer Remote from wording in the location.
    app.workMode = normalizeWorkMode(cell("workMode"));
    if (app.workMode === "Unknown" && looksRemote(app.location)) app.workMode = "Remote";
    app.roleType = colFor.has("roleType") ? normalizeRoleType(cell("roleType")) : normalizeRoleType(app.role);
    app.visa = normalizeVisa(cell("visa"));
    const score = Number(cell("fitScore"));
    if (cell("fitScore") !== "" && Number.isFinite(score)) app.fitScore = Math.min(100, Math.max(0, Math.round(score)));

    // Keep data from columns we could not map.
    const extras = headers
      .map((h, i) => (!used.has(i) && h && (row[i] ?? "").trim() ? `${h}: ${(row[i] ?? "").trim()}` : ""))
      .filter(Boolean);
    if (extras.length) app.notes = [app.notes, ...extras].filter(Boolean).join("\n");

    // Skip rows with neither company nor position.
    if (!app.company && !app.role) continue;
    applications.push(app);
  }
  return { applications, mapped, unmapped };
}

export function exportCsv(apps: Application[]): string {
  const header = EXPORT_COLUMNS.map(([, label]) => label);
  const body = apps.map((a) =>
    EXPORT_COLUMNS.map(([field]) => {
      const v = a[field as keyof Application];
      return v === undefined || v === null ? "" : String(v);
    }),
  );
  return toCsv([header, ...body]);
}

/** Key used to skip rows that already exist. */
export const dedupeKey = (a: Pick<Application, "company" | "role" | "url">) =>
  `${a.company.trim().toLowerCase()}|${a.role.trim().toLowerCase()}|${a.url.trim().toLowerCase()}`;
