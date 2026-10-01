"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getProvider } from "@/lib/ai";
import { getMasterProfile, getProfile, saveMasterProfile } from "@/lib/db";
import { buildHeader, generateResume, type ResumeHeader } from "@/lib/resume/engine";
import { pageFill } from "@/lib/resume/engine/fit";
import { PAGE_CSS, renderResumeHtml } from "@/lib/resume/engine/html";
import { renderResumeDocx } from "@/lib/resume/engine/render";
import { exportResume, getJobResume, storeJobResume, type ExportResult } from "@/lib/resume/engine/save";
import { createDebouncedSave } from "@/lib/resume/engine/autosave";
import { fitToPage, toPoolTarget } from "@/lib/resume/engine/trim";
import { backfillFromExperience } from "@/lib/resume/engine/backfill";
import { addSkill, describeTarget, removeTarget, targetFromElement, type Target } from "@/lib/resume/engine/edit";
import { editTarget, textOfTarget } from "@/lib/resume/engine/editText";
import { findQuote } from "@/lib/resume/engine/highlight";
import { popoverPlacement, PREVIEW_SCALE, previewScale } from "@/lib/resume/engine/preview";
import type { ResumeDoc } from "@/lib/resume/engine/schema";
import { cleanTitle, entriesNotOnPage } from "@/lib/resume/master/experiences";
import { appendSkillToMaster, hasSkill, parseSkillInventory } from "@/lib/resume/master/skills";
import { carryApprovals, fillPageComment, reviseResume, type ResumeComment } from "@/lib/resume/engine/revise";
import { applyApprovals, normalizeFlagMessage, resumeText, validateResume, type ValidationResult } from "@/lib/resume/engine/validate";
import { jobSkills, skillCoverage, skillHits } from "@/lib/resume/coverage";
import { tailoredFileName } from "@/lib/resume/repo";
import type { Application } from "@/lib/types";
import { Button, Checkbox, inputClass, Notice, Spinner } from "@/components/ui";
import AIErrorNotice from "@/components/resumes/AIErrorNotice";
import SkillGapsCard from "./SkillGapsCard";
import QualityCard from "./QualityCard";
import { lintResume } from "@/lib/resume/quality/lint";
import { issuesToComments, qualityScore } from "@/lib/resume/quality/summary";
import { readBreakdown } from "@/lib/intake/stored";

/** Rough cost of one tailoring call on Sonnet-class pricing, shown before she spends it. */
export const TAILOR_COST_HINT = "about 5 to 9¢";
/** A revision reuses the cached system prompt (rules + master profile), so it's a bit cheaper. */
export const REVISE_COST_HINT = "about 4¢";

const HIGHLIGHT_NAME = "resume-comments";

function PopoverAction({ label, hint, onClick, danger }: { label: string; hint: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl px-3 py-2 text-left transition hover:bg-paper">
      <span className={`block text-[13px] font-medium ${danger ? "text-bad" : "text-ink"}`}>{label}</span>
      <span className="block text-xs text-muted">{hint}</span>
    </button>
  );
}

function CheckIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Passed">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-warn" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="Check this">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 11h.01" />
    </svg>
  );
}

/** Paints the quotes she commented on in the preview (Chrome's CSS Custom Highlight API). */
function paintHighlights(root: HTMLElement | null, quotes: string[]) {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> })?.highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  registry.delete(HIGHLIGHT_NAME);
  if (!root || quotes.length === 0) return;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const texts = nodes.map((n) => n.data);
  const ranges: Range[] = [];
  for (const q of quotes) {
    const span = findQuote(texts, q);
    if (!span) continue;
    const r = document.createRange();
    r.setStart(nodes[span.startNode], span.startOffset);
    r.setEnd(nodes[span.endNode], span.endOffset);
    ranges.push(r);
  }
  if (ranges.length) registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
}

export default function TailorPanel({
  application,
  autoStart,
  notStartedReason,
  onSaved,
}: {
  application: Application & { id: number };
  /** Generate immediately on mount (a strong match); otherwise wait for a click. */
  autoStart: boolean;
  /** Shown instead of starting automatically, e.g. "Not an Apply match". */
  notStartedReason?: string;
  /** Called with the tailored resume's id each time the current version is saved to this job. */
  onSaved?: (tailoredResumeId: number) => void;
}) {
  const [master, setMaster] = useState<string | null>(null);
  const [header, setHeader] = useState<ResumeHeader | null>(null);
  const [fullName, setFullName] = useState("");
  const [phase, setPhase] = useState<"idle" | "generating" | "ready" | "saving" | "revising">("idle");
  const [error, setError] = useState<string | null>(null);
  // An AI call that failed, shown with the link that fixes it (credit, key, rate limit...).
  const [aiError, setAiError] = useState<unknown>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<(ExportResult & { fileName: string }) | null>(null);
  // Every version is saved to this job automatically; this tracks that, not the download.
  const [storedId, setStoredId] = useState<number | null>(null);
  const [storeState, setStoreState] = useState<"idle" | "saving" | "saved">("idle");
  const loadedFromStore = useRef(false);
  const [saver] = useState(() => createDebouncedSave(600));
  const started = useRef(false);
  // Review comments: select text in the preview, comment, then send them all back to fix.
  const [comments, setComments] = useState<ResumeComment[]>([]);
  const [selection, setSelection] = useState<{
    quote: string;
    x: number;
    y: number;
    width: number;
    maxHeight: number;
    target: Target | null;
  } | null>(null);
  const [scale, setScale] = useState(PREVIEW_SCALE);
  const scaleRef = useRef(PREVIEW_SCALE);
  const [popoverMode, setPopoverMode] = useState<"actions" | "swap" | "custom" | "edit">("actions");
  const [editText, setEditText] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);
  const [note, setNote] = useState("");
  const [generalNote, setGeneralNote] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [history, setHistory] = useState<{ result: ValidationResult; approved: Set<string> }[]>([]);
  const previewBox = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([getMasterProfile(), getProfile(), getJobResume(application.id)]).then(([m, p, existing]) => {
      // Reopen the resume already saved for this job, with her ticks, instead of an empty panel.
      if (existing && m.trim()) {
        const reopened = validateResume(existing.stored.doc, m);
        // Older saves stored ticks with the previous "master profile" wording.
        const ticked = new Set(existing.stored.approved.map(normalizeFlagMessage));
        loadedFromStore.current = true;
        setResult(reopened);
        setApproved(new Set(reopened.flags.filter((f) => ticked.has(f.message)).map((f) => f.id)));
        setStoredId(existing.id);
        setStoreState("saved");
        setPhase("ready");
      }
      setMaster(m);
      setHeader(buildHeader(p));
      setFullName(p.fullName);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id]);

  const generate = async () => {
    if (!master?.trim()) return;
    setError(null);
    setAiError(null);
    setSaved(null);
    setPhase("generating");
    try {
      // The job's skills split into ones she has and gaps, so the model uses exact spellings and
      // never mentions a gap (code already knows this; no need for the model to redo it).
      const inventory = parseSkillInventory(master);
      const skills = jobSkills(application, master);
      const provider = await getProvider();
      const have = skills.filter((s) => hasSkill(s, inventory, master));
      const raw = await generateResume(provider, master, application.company, application.jdText, {
        have,
        gaps: skills.filter((s) => !hasSkill(s, inventory, master)),
      });
      let checked = validateResume(raw, master);
      let polishNotes: string[] = [];
      // Her own rule: when a check fails, send that issue back to the model once. Code has already
      // fixed what it can (dashes, bold count, casing, duplicate skills); what's left here is writing
      // only the model can fix (repeated or weak verbs, buzzwords, overlong bullets). One extra call,
      // only when needed; if it fails, the first draft stands.
      if (header) {
        const pool = applyApprovals(checked.doc, checked.flags, new Set());
        const fit = fitToPage(pool, (d) => pageFill(header, d), { relevance: (text) => skillHits(skillsForJob, text) });
        const s = readBreakdown(application)?.skills;
        const required = s ? [...s.required.have, ...s.required.gap] : [];
        const fixIssues = lintResume(fit.doc, { jobSkills: have, requiredSkills: required }).filter((i) => i.severity === "fix");
        if (fixIssues.length > 0) {
          const repairs = issuesToComments(fixIssues).map((c) => {
            const target = c.target ? toPoolTarget(fit.map, c.target) : null;
            return { ...c, ...(target ? { target } : { target: undefined }) };
          });
          try {
            const out = await reviseResume(provider, master, application.company, application.jdText, pool, repairs);
            const { changes: done, ...doc } = out;
            checked = validateResume(doc, master);
            polishNotes = [`Polished automatically: fixed ${fixIssues.length} writing issue${fixIssues.length === 1 ? "" : "s"} in one extra pass.`, ...done];
          } catch {
            polishNotes = [];
          }
        }
      }
      // The model often writes less than a page. The rest is filled from her own bullets for the
      // roles already on the page, word for word (true by construction, no extra call); fitting then
      // keeps only what fits, most relevant first.
      if (header) {
        const relevance = (text: string) => skillHits(skillsForJob, text);
        const pool = applyApprovals(checked.doc, checked.flags, new Set());
        if (fitToPage(pool, (d) => pageFill(header, d), { relevance }).underfilled) {
          const filled = backfillFromExperience(checked.doc, master, relevance);
          if (filled.added > 0) {
            checked = validateResume(filled.doc, master);
            polishNotes = [...polishNotes, `Filled the page with ${filled.added} more of your own bullets, kept only where they fit.`];
          }
        }
      }
      setResult(checked);
      setApproved(new Set());
      setComments([]);
      setChanges(polishNotes);
      setHistory([]);
      setPhase("ready");
    } catch (e) {
      setAiError(e);
      // A failed "Start over" keeps the resume she had, still editable.
      setPhase(result ? "ready" : "idle");
    }
  };

  useEffect(() => {
    if (autoStart && master?.trim() && header && !started.current) {
      started.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, master, header]);

  /**
   * The resume with her ticks applied but before fitting to one page: the model's relevance-ranked
   * pool. Fitting, hand edits (through toPoolTarget), adding a skill and "Update resume" all start
   * from this, so something left off earlier comes back once there's room.
   */
  const untrimmed = useMemo(() => (result ? applyApprovals(result.doc, result.flags, approved) : null), [result, approved]);

  // The job's skills, which rank bullets when the page is full (most job skills shown = kept).
  const { fitBreakdown, jdText } = application;
  const skillsForJob = useMemo(() => (master ? jobSkills({ fitBreakdown, jdText }, master) : []), [fitBreakdown, jdText, master]);

  // Fit the pool to exactly one page: leave off the least relevant content until it fits, then
  // put back whatever still fits, measured on the real HTML rendering.
  const fitted = useMemo(() => {
    if (!untrimmed || !header) return null;
    return fitToPage(untrimmed, (d) => pageFill(header, d), { relevance: (text) => skillHits(skillsForJob, text) });
  }, [untrimmed, header, skillsForJob]);

  // Share of the job's skills the page shows, vs. how many of them the full master profile has.
  const coverage = useMemo(() => {
    if (!fitted || !master) return null;
    const skills = jobSkills(application, master);
    const onPage = skillCoverage(skills, resumeText(fitted.doc));
    const inProfile = skillCoverage(skills, master);
    if (!onPage || !inProfile) return null;
    return { before: inProfile.percent, after: onPage.percent, total: skills.length, onPage: onPage.found.length, haveInProfile: inProfile.found.length };
  }, [fitted, master, application]);

  // Save each new version (a generation, a revision, a tick) to this job, shortly after it settles.
  useEffect(() => {
    if (!fitted || !header || !result || phase !== "ready") return;
    if (loadedFromStore.current) {
      loadedFromStore.current = false; // just reopened: nothing new to save
      return;
    }
    setStoreState("saving");
    saver.schedule(async () => {
      try {
        const bytes = await renderResumeDocx(header, fitted.doc);
        const approvedMessages = result.flags.filter((f) => approved.has(f.id)).map((f) => f.message);
        const id = await storeJobResume(
          application.id,
          bytes,
          { v: 2, doc: result.doc, approved: approvedMessages, final: fitted.doc },
          coverage ?? { before: 0, after: 0 },
        );
        setStoredId(id);
        setStoreState("saved");
        onSaved?.(id);
      } catch (e) {
        setError(`Couldn't save this resume to the job: ${e instanceof Error ? e.message : String(e)}`);
        setStoreState("idle");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted, phase]);
  // Closing the panel right after a tick or an edit still saves it, instead of dropping it.
  useEffect(() => () => void saver.flush(), [saver]);

  const download = async () => {
    if (!fitted || !header) return;
    setPhase("saving");
    setError(null);
    try {
      const bytes = await renderResumeDocx(header, fitted.doc);
      const fileName = tailoredFileName(fullName, application.company, application.role);
      setSaved({ fileName, ...(await exportResume(bytes, fileName, storedId ?? undefined)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("ready");
    }
  };

  useEffect(() => {
    paintHighlights(pageRef.current, comments.map((c) => c.quote).filter(Boolean));
  }, [comments, fitted]);
  useEffect(() => () => paintHighlights(null, []), []);
  // The page preview scales to its box, so it fits a phone without scrolling sideways. A resize
  // closes the menu, whose position was measured against the old size.
  const hasPreview = fitted !== null;
  useEffect(() => {
    const box = previewBox.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const next = previewScale(box.clientWidth);
      if (Math.abs(scaleRef.current - next) < 0.001) return;
      scaleRef.current = next;
      setScale(next);
      setSelection(null);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasPreview, phase]);
  // The open menu's target is a position in the page it was opened on; once the page changes
  // (a tick, an undo) that position can point at a different bullet, so close it.
  useEffect(() => setSelection(null), [fitted]);

  /** Rough height of the open menu, so it can open above a line near the bottom of the page. */
  const POPOVER_HEIGHT = 330;
  const POPOVER_WIDTH = 320;

  const openFor = (anchor: Element | null, quote: string, rect: DOMRect) => {
    const box = previewBox.current;
    if (!box || !quote) return;
    const outer = box.getBoundingClientRect();
    const place = popoverPlacement(
      { left: rect.left - outer.left, top: rect.top - outer.top, bottom: rect.bottom - outer.top },
      { width: outer.width, height: outer.height },
      { width: POPOVER_WIDTH, height: POPOVER_HEIGHT },
    );
    openedFrom.current = anchor instanceof HTMLElement ? anchor : null;
    setSelection({ quote, ...place, target: targetFromElement(anchor) });
    setPopoverMode("actions");
    setNote("");
  };

  /**
   * Selecting text, or just clicking a bullet, role or skills line, opens the action menu next to
   * it. The data attributes html.ts writes say exactly which part of the resume it is.
   */
  const onPreviewMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || !pageRef.current) return;
    if (!sel.isCollapsed && pageRef.current.contains(sel.anchorNode)) {
      const node = sel.anchorNode;
      openFor(node instanceof Element ? node : (node?.parentElement ?? null), sel.toString().replace(/\s+/g, " ").trim(), sel.getRangeAt(0).getBoundingClientRect());
      return;
    }
    const clicked = (e.target as Element).closest?.("[data-b], [data-sec]");
    if (!clicked || !pageRef.current.contains(clicked)) return;
    openFor(clicked, (clicked as HTMLElement).innerText.replace(/\s+/g, " ").trim(), clicked.getBoundingClientRect());
  };

  /** Enter or Space on a focused bullet, role or skills line opens the same menu. */
  const onPreviewKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = (e.target as Element).closest?.("[data-b], [data-sec]");
    if (!el || !pageRef.current?.contains(el)) return;
    e.preventDefault();
    openFor(el, (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(), el.getBoundingClientRect());
  };

  // While the menu is open: Escape and a click outside close only the menu (not the whole dialog,
  // which would lose her queued comments), and keyboard focus moves into it.
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      closePopover();
    };
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) closePopover();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const first = popoverRef.current?.querySelector<HTMLElement>("textarea, button");
    first?.focus();
  }, [selection, popoverMode]);

  /** Apply a hand edit (no AI): re-check it against the master profile, keep her ticks, allow undo. */
  const commitDoc = (next: ResumeDoc, confirmedSkills: string[] = []) => {
    // While an update is running its answer would replace this edit, so edits wait for it.
    if (!result || !master || phase !== "ready") return;
    const checked = validateResume(next, master);
    const keep = carryApprovals(result.flags, approved, checked.flags);
    // A skill she just said she has is approved by that click.
    for (const f of checked.flags) {
      if (f.kind === "skill" && confirmedSkills.some((s) => f.message.startsWith(`"${s}"`))) keep.add(f.id);
    }
    setHistory((h) => [...h, { result, approved }]);
    setResult(checked);
    setApproved(keep);
    setChanges([]);
    setSaved(null);
  };

  /**
   * Remove and Edit act on what she clicked on the page, applied to the same spot in the pool, so
   * content that was left off to fit can take the freed space.
   */
  const commitOnPool = (visible: Target, change: (pool: ResumeDoc, target: Target) => ResumeDoc) => {
    if (!untrimmed || !fitted) return;
    const target = toPoolTarget(fitted.map, visible);
    if (target) commitDoc(change(untrimmed, target));
  };

  const addSkills = async (skills: string[], opts: { confirmedByHer: boolean; saveToProfile: boolean }) => {
    if (!untrimmed || !master) return;
    commitDoc(skills.reduce((d, s) => addSkill(d, s), untrimmed), opts.confirmedByHer ? skills : []);
    if (opts.confirmedByHer && opts.saveToProfile) {
      const updated = skills.reduce((m, s) => appendSkillToMaster(m, s), master);
      if (updated !== master) {
        await saveMasterProfile(updated);
        setMaster(updated);
      }
    }
  };

  const closePopover = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    // Return keyboard focus to the line the menu was opened from.
    openedFrom.current?.focus?.();
    openedFrom.current = null;
  };

  const queue = (text: string) => {
    if (!selection) return;
    // The revision is sent the pool (untrimmed), so the comment's spot is named in the pool too.
    const target = selection.target && fitted ? toPoolTarget(fitted.map, selection.target) : null;
    addComment(selection.quote, text, target ?? undefined);
    closePopover();
  };

  /** The exact spot travels with the comment, so the revision changes only that spot. */
  const addComment = (quote: string, text: string, target?: Target) => {
    if (!text.trim()) return;
    setComments((c) => [...c, { id: `${Date.now()}-${c.length}`, quote, note: text.trim(), ...(target ? { target } : {}) }]);
    window.getSelection()?.removeAllRanges();
  };

  const revise = async () => {
    if (!result || !fitted || !master) return;
    const all = generalNote.trim() ? [...comments, { id: "general", quote: "", note: generalNote.trim() }] : comments;
    if (all.length === 0) return;
    setError(null);
    setAiError(null);
    setSaved(null);
    setPhase("revising");
    try {
      const out = await reviseResume(await getProvider(), master, application.company, application.jdText, untrimmed ?? fitted.doc, all);
      const { changes: done, ...doc } = out;
      const next = validateResume(doc, master);
      setHistory((h) => [...h, { result, approved }]);
      // Her current ticks, including any made while the update was running.
      setApproved((current) => carryApprovals(result.flags, current, next.flags));
      setResult(next);
      setChanges(done);
      setComments([]);
      setGeneralNote("");
    } catch (e) {
      setAiError(e);
    } finally {
      setPhase("ready");
    }
  };

  // The job's skills the page doesn't show: ones her profile has, and ones it doesn't.
  // Writing quality, checked by code on the visible page: AI-sounding words, weak or repeated verbs,
  // lengths, bold use, repetition, and the job's keywords (lib/resume/quality).
  const quality = useMemo(() => {
    if (!fitted || !master) return null;
    const inventory = parseSkillInventory(master);
    const s = readBreakdown(application)?.skills;
    const required = s ? [...s.required.have, ...s.required.gap] : [];
    const jobSkillsHave = jobSkills(application, master).filter((x) => hasSkill(x, inventory, master));
    const issues = lintResume(fitted.doc, { jobSkills: jobSkillsHave, requiredSkills: required });
    return { issues, ...qualityScore(issues) };
  }, [fitted, master, application]);

  const skillGaps = useMemo(() => {
    if (!fitted || !master) return null;
    const skills = jobSkills(application, master);
    const onPage = skillCoverage(skills, resumeText(fitted.doc));
    if (!onPage) return null;
    const inventory = parseSkillInventory(master);
    return {
      total: skills.length,
      onPage: onPage.found.length,
      inProfile: onPage.missing.filter((s) => hasSkill(s, inventory, master)),
      notInProfile: onPage.missing.filter((s) => !hasSkill(s, inventory, master)),
    };
  }, [fitted, master, application]);

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setResult(prev.result);
    setApproved(prev.approved);
    setHistory((h) => h.slice(0, -1));
    setChanges([]);
  };

  if (master === null || header === null) return <Spinner label="Loading your experience..." />;

  if (!master.trim()) {
    return (
      <Notice kind="info">
        Add Your experience first. It holds everything you&apos;ve done and is the only source tailoring may use.{" "}
        <Link href="/resumes#your-experience" className="font-medium underline">
          Go to Resumes
        </Link>
        .
      </Notice>
    );
  }

  if (phase === "generating") {
    return (
      <div className="rounded-xl border border-accent/15 bg-accent-soft/40 p-5">
        <Spinner label="Tailoring your resume to this job. This usually takes 1 to 2 minutes..." />
      </div>
    );
  }

  if (!result || !fitted) {
    return (
      <div className="rounded-2xl bg-paper p-4">
        {notStartedReason && <p className="mb-3 text-sm text-muted">{notStartedReason}</p>}
        <Button onClick={generate}>Tailor resume ({TAILOR_COST_HINT})</Button>
        {error && <Notice kind="error">{error}</Notice>}
        {aiError !== null && <AIErrorNotice error={aiError} />}
      </div>
    );
  }

  const { flags, fixes } = result;
  const swapOptions = selection?.target?.section === "experience" && selection.target.bullet === undefined ? entriesNotOnPage(master, fitted.doc) : [];
  const targetLabel = selection?.target ? describeTarget(fitted.doc, selection.target) : null;
  const editable = selection?.target ? textOfTarget(fitted.doc, selection.target) : null;
  const fillPercent = Math.round(fitted.fill * 100);
  const checks = [
    { ok: true, text: "No double dashes, em dashes or en dashes" + (fixes.length ? ` (${fixes.join(" ")})` : "") },
    { ok: true, text: "Header links come from your Profile, exactly as saved" },
    {
      ok: flags.length === 0,
      text:
        flags.length === 0
          ? "Every skill, number, employer and date was found in Your experience"
          : `${flags.length} item${flags.length === 1 ? "" : "s"} not found in Your experience (left out unless you tick them)`,
    },
    {
      ok: fitted.fits && !fitted.underfilled,
      text: !fitted.fits
        ? "Still over one page after trimming; check it in Word"
        : fitted.underfilled
          ? `Fits on one page but uses only ${fillPercent}% of it. Everything tailoring wrote that fits is already on the page`
          : `Fits on one page and uses ${fillPercent}% of it`,
    },
  ];
  const fillQueued = comments.some((c) => c.id.startsWith("fill-"));
  const qualityQueued = comments.some((c) => c.id.startsWith("quality:"));
  /** Turns the "fix" issues into targeted comments (mapped to the pool) for the next Update resume. */
  const queueQualityFixes = () => {
    if (!quality || qualityQueued) return;
    const toQueue = issuesToComments(quality.issues).map((c) => {
      const target = c.target ? toPoolTarget(fitted.map, c.target) : null;
      return { ...c, ...(target ? { target } : { target: undefined }) };
    });
    setComments((c) => [...c, ...toQueue]);
  };
  const askToFill = () => {
    if (fillQueued) return;
    setComments((c) => [...c, { id: `fill-${Date.now()}`, quote: "", note: fillPageComment(fillPercent) }]);
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl bg-paper p-5">
        <p className="mb-3 text-[15px] font-semibold tracking-display">Checks</p>
        <ul className="grid gap-1.5 text-sm">
          {checks.map((c) => (
            <li key={c.text} className="flex gap-2">
              <CheckIcon ok={c.ok} />
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
        {fitted.fits && fitted.underfilled && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={askToFill} disabled={phase !== "ready" || fillQueued}>
              {fillQueued ? "Fill the page: added to your comments" : "Fill the page"}
            </Button>
            <span className="text-xs text-muted">Adds a comment asking for more bullets from Your experience. Sent with Update resume ({REVISE_COST_HINT}).</span>
          </div>
        )}
        {fitted.removed.length > 0 && (
          <details className="mt-2 text-sm text-muted">
            <summary className="cursor-pointer">
              Left off {fitted.removed.length} less relevant item{fitted.removed.length === 1 ? "" : "s"} to fit one page
            </summary>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {fitted.removed.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {quality && (
        <QualityCard
          score={quality.score}
          issues={quality.issues}
          onFix={queueQualityFixes}
          queued={qualityQueued}
          disabled={phase !== "ready"}
          costHint={REVISE_COST_HINT}
        />
      )}

      {flags.length > 0 && (
        <div className="rounded-2xl bg-warn-soft p-5">
          <p className="text-sm font-medium">Not found in Your experience</p>
          <p className="mb-3 text-xs text-muted">These are left off. Tick one only if it&apos;s true and you want it on the page.</p>
          <div className="grid gap-2">
            {flags.map((f) => (
              <Checkbox
                key={f.id}
                label={f.message}
                checked={approved.has(f.id)}
                onChange={(on) =>
                  setApproved((s) => {
                    const next = new Set(s);
                    if (on) next.add(f.id);
                    else next.delete(f.id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      {skillGaps && (
        <SkillGapsCard
          total={skillGaps.total}
          onPage={skillGaps.onPage}
          inProfile={skillGaps.inProfile}
          notInProfile={skillGaps.notInProfile}
          onAdd={addSkills}
          disabled={phase !== "ready"}
        />
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold tracking-display">Review</p>
          <p className="text-xs text-muted">Click a bullet or role, or select any text, to change it.</p>
        </div>
        <div ref={previewBox} className="relative min-w-0 rounded-2xl bg-paper p-3" onMouseUp={onPreviewMouseUp} onKeyDown={onPreviewKeyDown}>
          <style>{`::highlight(${HIGHLIGHT_NAME}){background-color:rgba(123,63,228,.2)}`}</style>
          <div className="mx-auto shadow-lift" style={{ width: `${8.5 * scale}in`, height: `${11 * scale}in`, overflow: "hidden" }}>
            <div ref={pageRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "8.5in" }}>
              <style>{PAGE_CSS}</style>
              {/* renderResumeHtml escapes every string; no model output is inserted as raw HTML. */}
              <div dangerouslySetInnerHTML={{ __html: renderResumeHtml(header, fitted.doc) }} />
            </div>
          </div>
          {selection && (
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Change this part of the resume"
              className="absolute z-10 overflow-auto rounded-2xl bg-white p-4 shadow-card ring-1 ring-black/[0.08]"
              style={{ left: selection.x, top: selection.y, width: selection.width, maxHeight: selection.maxHeight }}
              onMouseUp={(e) => e.stopPropagation()}
            >
              {targetLabel && <p className="text-xs font-medium text-muted">{targetLabel[0].toUpperCase() + targetLabel.slice(1)}</p>}
              <p className="mt-1 line-clamp-2 border-l-2 border-accent pl-2 text-xs text-muted">{selection.quote}</p>

              {popoverMode === "actions" && (
                <div className="mt-3 grid gap-1">
                  {editable !== null && (
                    <PopoverAction
                      onClick={() => {
                        setEditText(editable);
                        setPopoverMode("edit");
                      }}
                      label="Edit the text yourself"
                      hint="Free and instant. Words between ** stay bold"
                    />
                  )}
                  {swapOptions.length > 0 && (
                    <PopoverAction onClick={() => setPopoverMode("swap")} label="Swap for another experience" hint="Pick a role from Your experience" />
                  )}
                  <PopoverAction
                    onClick={() => queue("Rewrite this to match the job's wording and keywords. Keep every fact, number and technology.")}
                    label="Rewrite for this job"
                    hint="Added to your comments"
                  />
                  <PopoverAction
                    onClick={() => queue("Make this shorter, one line if possible, keeping its number and main technology.")}
                    label="Make it shorter"
                    hint="Added to your comments"
                  />
                  <PopoverAction onClick={() => setPopoverMode("custom")} label="Write your own comment" hint="e.g. mention the Jest tests here" />
                  {selection.target && (
                    <PopoverAction
                      danger
                      onClick={() => {
                        commitOnPool(selection.target!, removeTarget);
                        closePopover();
                      }}
                      label={selection.target.bullet === undefined && selection.target.section !== "leadership" ? "Remove this whole section" : "Remove"}
                      hint="Right away, free. You can undo it"
                    />
                  )}
                </div>
              )}

              {popoverMode === "swap" && (
                <div className="mt-3">
                  <p className="mb-2 text-[13px] font-medium">Replace it with</p>
                  <div className="grid max-h-56 gap-1 overflow-auto">
                    {swapOptions.map((m) => (
                      <button
                        key={`${m.company}-${m.title}`}
                        type="button"
                        onClick={() =>
                          queue(
                            `Replace this whole role with my "${cleanTitle(m.title)} | ${m.company} | ${m.dates}" entry from Your experience (the master profile). Choose and rewrite its bullets that best match this job, about as many bullets as this role has now, and keep reverse-chronological order.`,
                          )
                        }
                        className="rounded-xl px-3 py-2 text-left transition hover:bg-paper"
                      >
                        <span className="block text-[13px] font-medium">{m.company}</span>
                        <span className="block text-xs text-muted">
                          {m.title} · {m.dates}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setPopoverMode("actions")} className="mt-2 text-xs text-muted hover:text-ink">
                    Back
                  </button>
                </div>
              )}

              {popoverMode === "edit" && selection.target && (
                <>
                  <textarea
                    rows={selection.target.section === "skills" ? 2 : 4}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        commitOnPool(selection.target!, (pool, t) => editTarget(pool, t, editText));
                        closePopover();
                      }
                    }}
                    aria-label="Edit the text"
                    className={`mt-3 ${inputClass} text-sm`}
                  />
                  <p className="mt-1 text-xs text-muted">
                    {selection.target.section === "skills" ? "Separate skills with commas." : "Anything new that isn't in your experience still needs your tick."}
                  </p>
                  <div className="mt-2 flex justify-between gap-2">
                    <Button variant="secondary" onClick={() => setPopoverMode("actions")}>
                      Back
                    </Button>
                    <Button
                      onClick={() => {
                        commitOnPool(selection.target!, (pool, t) => editTarget(pool, t, editText));
                        closePopover();
                      }}
                      disabled={!editText.trim() || editText.trim() === editable}
                    >
                      Save
                    </Button>
                  </div>
                </>
              )}

              {popoverMode === "custom" && (
                <>
                  <textarea
                    autoFocus
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) queue(note);
                    }}
                    placeholder="What should change? e.g. Mention that I used Docker here"
                    className="mt-3 w-full rounded-xl border border-black/[0.12] px-3 py-2 text-sm outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                  />
                  <div className="mt-2 flex justify-between gap-2">
                    <Button variant="secondary" onClick={() => setPopoverMode("actions")}>
                      Back
                    </Button>
                    <Button onClick={() => queue(note)} disabled={!note.trim()}>
                      Add comment
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-paper p-5">
        <p className="mb-3 text-[15px] font-semibold tracking-display">Your comments</p>
        {comments.length === 0 ? (
          <p className="text-sm text-muted">None yet. Highlight a line or skill above, or add a note for the whole resume below.</p>
        ) : (
          <ol className="grid gap-2">
            {comments.map((c, i) => (
              <li key={c.id} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-deep">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-xs text-muted">{c.quote ? <>&ldquo;{c.quote}&rdquo;</> : "Whole resume"}</span>
                  <span>{c.note}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setComments((all) => all.filter((x) => x.id !== c.id))}
                  className="text-xs text-muted hover:text-bad"
                  aria-label={`Remove comment ${i + 1}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
        <textarea
          rows={2}
          value={generalNote}
          onChange={(e) => setGeneralNote(e.target.value)}
          placeholder="A note on the whole resume (optional), e.g. Lead with the AI project"
          className="mt-3 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Anything new your comments add that isn&apos;t in Your experience still needs your tick.</p>
          <Button onClick={revise} disabled={phase !== "ready" || (comments.length === 0 && !generalNote.trim())}>
            {phase === "revising" ? "Updating..." : `Update resume (${REVISE_COST_HINT})`}
          </Button>
        </div>
        {phase === "revising" && <Spinner label="Applying your comments. This takes about 30 seconds..." />}
        {changes.length > 0 && (
          <div className="mt-3 rounded-lg bg-accent-soft/50 p-3 text-sm">
            <p className="mb-1 font-medium">What changed</p>
            <ul className="list-disc pl-5 text-black/70">
              {changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {saved && (
        <Notice kind="ok">
          Downloaded {saved.fileName}
          {saved.toFolder ? " and saved a copy to your Tailored folder" : ""}.
          {saved.folderWarning && ` ${saved.folderWarning}`}
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {aiError !== null && <AIErrorNotice error={aiError} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={generate} disabled={phase !== "ready"}>
            Start over ({TAILOR_COST_HINT})
          </Button>
          {history.length > 0 && (
            <Button variant="secondary" onClick={undo} disabled={phase !== "ready"}>
              Undo
            </Button>
          )}
        </div>
        <span className="ml-auto text-xs text-muted" aria-live="polite">
          {storeState === "saving" ? "Saving to this job..." : storeState === "saved" ? "Saved to this job" : ""}
        </span>
        <Button onClick={download} disabled={phase !== "ready"}>
          {phase === "saving" ? "Saving..." : "Download .docx"}
        </Button>
      </div>
    </div>
  );
}
