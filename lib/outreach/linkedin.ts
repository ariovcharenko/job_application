// Builds LinkedIn people-search URLs to open manually. No LinkedIn automation or scraping —
// this only constructs a search URL; she reviews results and reaches out herself (decision #3).

const PEOPLE_SEARCH_BASE = "https://www.linkedin.com/search/results/people/";

function peopleSearchUrl(keywords: string): string {
  const url = new URL(PEOPLE_SEARCH_BASE);
  url.searchParams.set("keywords", keywords);
  return url.toString();
}

export function recruiterSearchUrl(company: string): string {
  return peopleSearchUrl(`${company} recruiter OR "talent acquisition"`);
}

export function universityRecruiterSearchUrl(company: string, school: string): string {
  return peopleSearchUrl(school ? `${company} university recruiter ${school}` : `${company} university recruiter`);
}

export function hiringManagerSearchUrl(company: string, roleTitle: string): string {
  const kw = [company, roleTitle, "manager"].filter(Boolean).join(" ");
  return peopleSearchUrl(kw);
}

export function alumniSearchUrl(company: string, school: string): string {
  return peopleSearchUrl(school ? `${company} ${school}` : company);
}

export function engineerSearchUrl(company: string, roleTitle: string): string {
  const kw = [company, roleTitle].filter(Boolean).join(" ");
  return peopleSearchUrl(kw);
}

export interface OutreachSearch {
  label: string;
  type: "recruiter" | "hiring-manager" | "alumni" | "engineer";
  url: string;
}

/** The standard set of search links shown on an application's outreach panel. */
export function buildOutreachSearches(company: string, roleTitle: string, school: string): OutreachSearch[] {
  const searches: OutreachSearch[] = [
    { label: "Recruiters / Talent Acquisition", type: "recruiter", url: recruiterSearchUrl(company) },
    { label: "University recruiters", type: "recruiter", url: universityRecruiterSearchUrl(company, school) },
    { label: "Likely hiring managers", type: "hiring-manager", url: hiringManagerSearchUrl(company, roleTitle) },
    { label: "Engineers on the team", type: "engineer", url: engineerSearchUrl(company, roleTitle) },
  ];
  if (school) searches.push({ label: "Alumni at the company", type: "alumni", url: alumniSearchUrl(company, school) });
  return searches;
}
