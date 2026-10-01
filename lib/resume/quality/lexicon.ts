// Word lists behind the resume quality rules (lint.ts). Plain data, so adding a phrase is a
// one-line change. Every pattern is matched against the bullet's plain text (** markers removed).

import type { Severity } from "./types";

export interface Buzzword {
  /** Stable key, used in issue ids. */
  key: string;
  pattern: RegExp;
  /**
   * "fix" for phrases that read as AI or template filler in any context. "consider" for words
   * that are fine in some technical contexts ("orchestrated containers", "robust to noise").
   */
  severity: Severity;
  /** What to use instead; ends up in the fix hint sent to the model. */
  instead: string;
  /** Skip the match when the bullet also matches this (the word is being used technically). */
  unless?: RegExp;
}

/**
 * Phrases that make a bullet read as generated or padded. Ordered roughly by how strong a tell
 * they are. Patterns are case-insensitive and whole-word.
 */
export const BUZZWORDS: Buzzword[] = [
  { key: "spearheaded", pattern: /\bspearhead(?:ed|ing|s)?\b/i, severity: "fix", instead: "a concrete verb like Led, Built or Launched" },
  { key: "leveraged", pattern: /\bleverag(?:ed|ing|es)\b/i, severity: "fix", instead: "\"used\" or \"with\", or just name the technology" },
  { key: "utilized", pattern: /\butiliz(?:ed|ing|es|ation)\b/i, severity: "fix", instead: "\"used\", or name the technology directly" },
  { key: "synergy", pattern: /\bsynerg(?:y|ies|istic)\b/i, severity: "fix", instead: "the specific teams and what was built together" },
  { key: "cutting-edge", pattern: /\b(?:cutting[- ]edge|state[- ]of[- ]the[- ]art|best[- ]in[- ]class|world[- ]class|next[- ]generation|game[- ]chang(?:ing|er))\b/i, severity: "fix", instead: "the actual technology or result" },
  { key: "seamless", pattern: /\bseamless(?:ly)?\b/i, severity: "fix", instead: "a measurable outcome (fewer errors, faster load) or nothing" },
  { key: "passionate", pattern: /\bpassionate\b/i, severity: "fix", instead: "nothing: show it through what was built" },
  { key: "innovative", pattern: /\binnovative\b/i, severity: "fix", instead: "what was new about it, concretely" },
  { key: "results-driven", pattern: /\b(?:results|detail|mission)[- ](?:driven|oriented|focused)\b/i, severity: "fix", instead: "evidence: the result or the data used" },
  { key: "responsible-for", pattern: /\bresponsible for\b/i, severity: "fix", instead: "the action verb for what was done (Built, Ran, Owned)" },
  { key: "worked-on", pattern: /\bwork(?:ed|ing) on\b/i, severity: "fix", instead: "the specific action (Built, Fixed, Designed)" },
  { key: "various", pattern: /\b(?:various|a variety of|a wide range of|numerous|multiple different)\b/i, severity: "fix", instead: "the actual items, or a count" },
  { key: "successfully", pattern: /\bsuccessfully\b/i, severity: "fix", instead: "nothing: the result shows it" },
  { key: "in-order-to", pattern: /\bin order to\b/i, severity: "fix", instead: "\"to\"" },
  { key: "drive-impact", pattern: /\b(?:driv(?:e|es|ing)|drove)\s+(?:\w+\s+)?(?:impact|value|results|growth|success|outcomes)\b/i, severity: "fix", instead: "the specific result, with its number" },
  { key: "key-role", pattern: /\b(?:played a (?:key|pivotal|crucial|vital) role|instrumental in|a testament to)\b/i, severity: "fix", instead: "the action taken and its result" },
  { key: "delve", pattern: /\bdelv(?:e|ed|ing|es)\b/i, severity: "fix", instead: "\"analyzed\" or \"investigated\"" },
  { key: "tapestry", pattern: /\b(?:tapestry|landscape of|realm of|myriad)\b/i, severity: "fix", instead: "plain words" },
  { key: "meticulous", pattern: /\bmeticulous(?:ly)?\b/i, severity: "fix", instead: "what was checked (e.g. tests written, reviews done)" },
  { key: "showcasing", pattern: /\bshowcas(?:ing|ed|es)\b/i, severity: "fix", instead: "\"showing\", or drop the clause" },
  { key: "fostering", pattern: /\bfoster(?:ing|ed|s)?\b/i, severity: "fix", instead: "what was actually done" },
  { key: "dynamic", pattern: /\bdynamic\b(?!\s+(?:programming|routing|routes?|pricing|forms?|content|imports?|typing|analysis|pages?|rendering|allocation|arrays?|linking|loading|scheduling|dispatch|queries|sql|range))/i, severity: "consider", instead: "a specific description, or drop it" },
  { key: "robust", pattern: /\brobust(?:ly|ness)?\b/i, severity: "consider", instead: "what makes it reliable (tests, retries, uptime number)" },
  { key: "orchestrated", pattern: /\borchestrat(?:ed|ing)\b/i, severity: "consider", instead: "Led, Coordinated or Ran", unless: /kubernetes|k8s|container|docker|airflow|workflow|pipeline|step functions|temporal|\bdag/i },
  { key: "effectively", pattern: /\b(?:effectively|efficiently)\b/i, severity: "consider", instead: "the measured result, or drop the adverb" },
  { key: "helped", pattern: /\bhelp(?:ed|ing)?(?:\s+to)?\s+(?!desk\b)/i, severity: "consider", instead: "the part actually done" },
  { key: "ensuring", pattern: /,\s*(?:thereby\s+)?ensuring\b/i, severity: "consider", instead: "the measured result (uptime, error rate) or a separate clause" },
  { key: "comprehensive", pattern: /\b(?:comprehensive|holistic|end-to-end solutions?)\b/i, severity: "consider", instead: "what it covered, concretely" },
];

/** First person pronouns. "I" only as a capital standalone word, not "I/O". */
export const FIRST_PERSON = /(?:^|[^\w/])(?:I(?![\w/'’-])|[Mm]y|[Mm]e|[Ww]e|[Oo]ur|[Oo]urs|[Mm]yself)(?![\w/])/;

/** Openers that make the candidate sound like a bystander. Severity "fix". */
export const WEAK_OPENERS = new Set([
  "assisted", "participated", "was", "were", "helped", "worked", "tasked", "involved", "responsible", "served",
  "attended", "learned", "gained", "exposed", "observed", "shadowed",
]);

/** Openers that are acceptable but soft; flagged "consider" only. */
export const SOFT_OPENERS = new Set(["supported", "contributed", "handled", "collaborated"]);

/**
 * Irregular past-tense verbs (lowercase). Anything ending in "-ed" also counts as past tense; this
 * list covers the rest so a strong bullet like "Built ..." or "Led ..." is never flagged.
 */
export const IRREGULAR_PAST = new Set([
  "built", "wrote", "led", "ran", "made", "drove", "won", "took", "set", "cut", "grew", "taught", "held", "brought",
  "found", "gave", "kept", "began", "chose", "rebuilt", "rewrote", "spun", "sold", "spoke", "met", "oversaw",
  "undertook", "upheld", "put", "read", "sent", "spent", "split", "stood", "thought", "hit", "fed", "fought",
  "drew", "flew", "knew", "left", "lost", "meant", "paid", "said", "saw", "shot", "shut", "struck", "swept",
  "told", "understood", "wound", "bought", "caught", "dealt", "did", "got", "hung", "laid", "lent", "let",
  "overcame", "overtook", "redid", "remade", "reran", "rode", "rose", "shook", "shrank", "slid", "sped", "stuck",
  "sought", "swung", "tore", "withdrew", "broke", "became", "came", "forecast", "broadcast", "outran", "outgrew",
  "overrode", "underwent", "upset", "wove", "retaught", "reset", "retook", "mentored", "co-led", "co-wrote",
  "co-built", "co-taught", "co-ran",
]);

/** Soft-skill and office-suite filler that a tech resume's skills section shouldn't spend lines on. */
export const OFFICE_FILLER = /^(?:microsoft office|ms office|office 365|microsoft 365|microsoft word|ms word|word|powerpoint|microsoft powerpoint|outlook|google (?:docs|sheets|slides|suite|workspace)|g suite|email|zoom|slack|microsoft teams|teams|typing|internet research|windows|mac ?os x?)$/i;

/** Small words ignored when comparing bullets for overlap. */
export const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "by", "at", "from", "as", "into", "via",
  "that", "this", "these", "those", "its", "it", "their", "is", "are", "was", "were", "be", "than", "per", "each",
  "across", "over", "under", "using", "used", "while", "which", "who", "so", "up", "out", "all", "every", "more",
  "most", "new", "about", "after", "before", "within", "between",
]);

/** Participles that follow a comma but aren't "impact clauses" (", using React", ", including X"). */
export const NEUTRAL_ING = new Set(["using", "including", "leveraging", "following", "during", "according", "spanning", "covering", "involving", "bringing"]);
