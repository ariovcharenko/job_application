/**
 * The monogram on a company tile: "Atlas Cloud" -> "AC", "Stripe" -> "S", "The Home Depot, Inc."
 * -> "HD". Legal suffixes, filler words, parentheticals and punctuation are ignored; digits count
 * as letters ("3M" -> "3"). Returns "" when nothing usable is left, so the tile can show an icon
 * instead of a made-up letter.
 */

/** Words that say nothing about which company it is. */
const IGNORED = new Set([
  "the",
  "and",
  "of",
  "a",
  "an",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "lp",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "bv",
  "nv",
  "pbc",
  "pty",
]);

/** Letters and digits in any script; everything else separates words. */
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

export function companyInitials(name: string | null | undefined): string {
  if (!name) return "";
  // "Meta (Facebook)" -> "Meta"; "Acme [contract]" -> "Acme".
  const cleaned = name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").normalize("NFC");
  const words = (cleaned.match(WORD) ?? []).map((w) => w.replace(/['’].*$/, ""));
  if (words.length === 0) return "";
  const meaningful = words.filter((w) => !IGNORED.has(w.toLowerCase()));
  // A name made only of filler ("The Company") still gets a letter from what was typed.
  const picked = meaningful.length > 0 ? meaningful : words;
  const first = (w: string) => Array.from(w)[0].toLocaleUpperCase();
  return picked.length === 1 ? first(picked[0]) : first(picked[0]) + first(picked[1]);
}
