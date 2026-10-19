// Trims a job posting before Claude reads it, so the check sends (and waits on) fewer tokens.
// Deterministic and conservative: it only removes marketing, perks, equal-opportunity and
// page-chrome text, and any sentence that could matter to eligibility or fit is always kept
// (see MUST_KEEP). If trimming ever leaves too little, the caller gets the original text.

/** Longest text sent to Claude after trimming. */
export const CHECK_MAX_CHARS = 8000;

/** The opening of a posting (title, company, location, posted date) is always kept. */
const HEAD_CHARS = 1200;

/** Postings at or under this size are sent whole: nothing worth the risk. */
const SHORT_POSTING = 3000;

/** A sentence matching this is never dropped, in any section. */
const MUST_KEEP = new RegExp(
  [
    "sponsor", "visa", "\\bOPT\\b", "\\bCPT\\b", "\\bH-?1B\\b", "citizen", "clearance", "authori[sz]", "work permit", "green card",
    "immigration", "permanent resident", "eligib", "e-?verify",
    "location", "remote", "hybrid", "on-?site", "in[- ]office", "\\boffice\\b", "relocat", "\\bbased in\\b", "days (a|per) week",
    "\\byears?\\b", "\\bdegree\\b", "bachelor", "master'?s", "\\bph\\.?d\\b", "\\bB\\.?S\\.?\\b", "\\bM\\.?S\\.?\\b", "graduat", "new grad", "entry[- ]level", "\\bintern",
    "requirement", "qualification", "responsib", "\\bskills?\\b", "experience", "proficien", "knowledge of", "familiar", "must have", "you will", "you'll", "we('| a)re looking",
    "\\$\\s?\\d", "salary", "pay range", "posted", "days? ago", "apply by", "deadline",
  ].join("|"),
  "i",
);

/** A heading that starts a section made of company marketing, perks or legal text. */
const BORING_HEADING =
  /^(#+\s*)?(benefits?|perks|what we offer|why (join|work)|why you('|’)ll love|life at|our (mission|culture|values|story|team culture)|who we are|company overview|about (us|the company|our company)|equal (opportunity|employment)|eeo|diversity|inclusion|accommodations?|privacy|legal|disclaimer|total rewards|compensation (and|&) benefits|what'?s in it for you)\b/i;

/** "About Acme" (a company name) is marketing; "About the role/team/job" is not. */
const ABOUT_COMPANY = /^(#+\s*)?about\s+(?!the (role|team|job|position|opportunity)\b|this\b|you\b)\S+(\s\S+)?:?$/i;

/** Page chrome and legal lines, dropped wherever they appear (unless they match MUST_KEEP). */
const CHROME =
  /equal opportunity employer|does not discriminate|without regard to (race|color|religion)|reasonable accommodations?|cookies?\b|privacy (policy|notice|statement)|terms (of use|of service|and conditions)|all rights reserved|download (the|our) app|app store|google play|share this (job|posting)|sign in|log ?in\b|create (an )?account|subscribe|follow us|back to (jobs|search)|apply (now|for this job|with)|powered by|protected (veteran|by law)|affirmative action/i;

function isHeading(line: string): boolean {
  const l = line.trim();
  if (!l || l.length > 60 || /[.;,]$/.test(l)) return false;
  if (/^#+\s/.test(l) || /:$/.test(l)) return true;
  const words = l.split(/\s+/);
  if (words.length > 7) return false;
  return l === l.toUpperCase() || words.every((w) => /^[A-Z0-9&(]/.test(w) || /^(and|of|the|to|for|in|a|an|at|on|you|we|our|your)$/i.test(w));
}

function sentences(line: string): string[] {
  // Not after an abbreviation such as "U.S." or "e.g.": a split there would cut a sentence in two
  // and could drop the half that carries the keyword. Over-keeping is the safe direction.
  return line.split(/(?<=[.!?])(?<!\b(?:[A-Za-z]\.){1,3})\s+(?=[A-Z0-9])/).filter(Boolean);
}

interface Block {
  text: string;
  /** Kept at any cost. Other blocks are kept only while the cap has room. */
  must: boolean;
  heading: boolean;
}

/**
 * Keeps what decides eligibility and fit, drops boilerplate, and caps the length. Short postings
 * are returned whole, and so is any posting whose trimmed form would be too short to be one.
 */
export function trimPostingForCheck(raw: string, max = CHECK_MAX_CHARS): string {
  const text = raw.replace(/\r/g, "").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= Math.min(max, SHORT_POSTING)) return text;

  const blocks: Block[] = [{ text: text.slice(0, HEAD_CHARS), must: true, heading: false }];
  let boring = false;
  for (const line of text.slice(HEAD_CHARS).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (isHeading(t)) {
      boring = BORING_HEADING.test(t) || ABOUT_COMPANY.test(t);
      blocks.push({ text: t, must: false, heading: true });
      continue;
    }
    // Inside a boring section (or on a chrome line) only the sentences that could matter survive.
    const parts = boring || CHROME.test(t) ? sentences(t).filter((s) => MUST_KEEP.test(s) || (!boring && !CHROME.test(s))) : [t];
    if (!parts.length) continue;
    blocks.push({ text: parts.join(" "), must: parts.some((s) => MUST_KEEP.test(s)), heading: false });
  }
  // A heading stays only when something follows it under the same heading.
  const out = blocks.filter((b, i) => !b.heading || (blocks[i + 1] && !blocks[i + 1].heading));

  let used = out.reduce((n, b) => n + (b.must ? b.text.length + 1 : 0), 0);
  const keep = out.map((b) => b.must);
  out.forEach((b, i) => {
    if (keep[i] || used + b.text.length + 1 > max) return;
    keep[i] = true;
    used += b.text.length + 1;
  });
  // Headings kept for the sake of a dropped block would be orphans; drop those.
  const kept = out.filter((b, i) => keep[i] && !(b.heading && !keep[i + 1]));
  let result = kept.map((b) => b.text).join("\n");
  if (result.length > max) result = result.slice(0, max);
  if (result.length < Math.min(text.length, 600)) return text.slice(0, max);
  return result;
}
