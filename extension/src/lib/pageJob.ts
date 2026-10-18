// Reading which job a page is for (company and role), to match it with a tracker job. ATS pages
// almost all embed a schema.org JobPosting as JSON-LD, which is the most reliable source and
// survives markup redesigns; the page <title> and og:title are the fallback, parsed per ATS since
// each words them differently. Pure DOM reads, no chrome.* calls.
import type { PageJobInfo } from "./jobMatch";

const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function ldPostings(doc: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        const obj = node as Record<string, unknown>;
        const type = obj["@type"];
        if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) out.push(obj);
        if (obj["@graph"]) walk(obj["@graph"]);
      };
      walk(JSON.parse(script.textContent ?? ""));
    } catch {
      // not JSON we can read
    }
  }
  return out;
}

export function fromJsonLd(doc: Document): PageJobInfo | null {
  const p = ldPostings(doc)[0];
  if (!p) return null;
  const org = p.hiringOrganization as { name?: unknown } | string | undefined;
  const company = text(typeof org === "string" ? org : typeof org?.name === "string" ? org.name : "");
  const role = text(typeof p.title === "string" ? p.title : "");
  return company || role ? { company, role } : null;
}

const meta = (doc: Document, prop: string) => text(doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.getAttribute("content"));
const titleOf = (doc: Document) => meta(doc, "og:title") || text(doc.title);

/** "Software Engineer at Taskwise" / "Software Engineer @ Taskwise": role first. */
export function splitRoleAtCompany(title: string): PageJobInfo | null {
  const t = title.replace(/^job application for\s+/i, "");
  const m = t.match(/^(.+?)\s+(?:at|@)\s+(.+?)$/i);
  return m ? { role: text(m[1]), company: text(m[2]) } : null;
}

/** "Taskwise - Software Engineer": company first (Lever's title format). */
export function splitCompanyDashRole(title: string): PageJobInfo | null {
  const m = title.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  return m ? { company: text(m[1]), role: text(m[2]) } : null;
}

const h1 = (doc: Document) => text(doc.querySelector("h1")?.textContent);

/** Greenhouse: JSON-LD, else `.app-title` / `.company-name`, else "Job Application for Role at Company". */
export function greenhouseJobInfo(doc: Document): PageJobInfo {
  const ld = fromJsonLd(doc);
  if (ld?.company && ld.role) return ld;
  const role = text(doc.querySelector(".app-title, h1.section-header")?.textContent);
  const company = text(doc.querySelector(".company-name")?.textContent).replace(/^at\s+/i, "");
  if (role && company) return { role, company };
  return splitRoleAtCompany(titleOf(doc)) ?? { role: role || h1(doc), company };
}

/** Lever: JSON-LD, else ".posting-headline h2" for the role and "Company - Role" in the title. */
export function leverJobInfo(doc: Document): PageJobInfo {
  const ld = fromJsonLd(doc);
  if (ld?.company && ld.role) return ld;
  const role = text(doc.querySelector(".posting-headline h2")?.textContent);
  const fromTitle = splitCompanyDashRole(titleOf(doc));
  return { company: fromTitle?.company ?? "", role: role || fromTitle?.role || h1(doc) };
}

/** Ashby: JSON-LD, else "Role @ Company" in the title, else the h1. */
export function ashbyJobInfo(doc: Document): PageJobInfo {
  const ld = fromJsonLd(doc);
  if (ld?.company && ld.role) return ld;
  return splitRoleAtCompany(titleOf(doc)) ?? { company: meta(doc, "og:site_name"), role: h1(doc) };
}

/** Workday: the job title is the h1 / data-automation-id="jobPostingHeader"; company is the tenant. */
export function workdayJobInfo(doc: Document, hostname: string): PageJobInfo {
  const ld = fromJsonLd(doc);
  if (ld?.company && ld.role) return ld;
  const role = text(doc.querySelector('[data-automation-id="jobPostingHeader"], h2[data-automation-id="jobPostingHeader"]')?.textContent) || h1(doc);
  return { role, company: hostname.split(".")[0].replace(/[-_]+/g, " ") };
}

/** Anything else: JSON-LD, then "Role at Company", then the h1. */
export function genericJobInfo(doc: Document): PageJobInfo {
  return fromJsonLd(doc) ?? splitRoleAtCompany(titleOf(doc)) ?? { company: meta(doc, "og:site_name"), role: h1(doc) };
}
