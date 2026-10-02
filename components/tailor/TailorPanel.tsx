"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getProvider } from "@/lib/ai";
import { getMasterProfile, getProfile, saveMasterProfile } from "@/lib/db";
import { buildHeader, type ResumeHeader } from "@/lib/resume/engine";
import { linesShort } from "@/lib/resume/engine/budget";
import { pageFill } from "@/lib/resume/engine/fit";
import { PAGE_CSS, renderResumeHtml } from "@/lib/resume/engine/html";
import { renderResumeDocx } from "@/lib/resume/engine/render";
import { exportResume, getJobResume, storeJobResume, type ExportResult } from "@/lib/resume/engine/save";
import { createDebouncedSave } from "@/lib/resume/engine/autosave";
import { fitResume, toPoolTarget, toVisibleSpot } from "@/lib/resume/engine/trim";
import { verifyResume } from "@/lib/resume/engine/verify";
import { tailorResume } from "@/lib/resume/engine/pipeline";
import { explainTailoring } from "@/lib/resume/engine/tailored";
import { addSkill, describeTarget, removeSpot, removeTarget, spotOn, targetFromElement, type Target } from "@/lib/resume/engine/edit";
import { editTarget, textOfTarget } from "@/lib/resume/engine/editText";
import { popoverPlacement, PREVIEW_SCALE, previewScale } from "@/lib/resume/engine/preview";
import type { ResumeDoc } from "@/lib/resume/engine/schema";
import { cleanTitle, entriesNotOnPage, parseMasterExperiences } from "@/lib/resume/master/experiences";
import { appendSkillToMaster, appendUsageNote, hasSkill, parseSkillInventory, type RoleKey } from "@/lib/resume/master/skills";
import { carryApprovals, fillComment, placementComment, reviseResume, type ResumeComment } from "@/lib/resume/engine/revise";
import { applyApprovals, normalizeFlagMessage, resumeText, validateResume, type Flag, type ValidationResult } from "@/lib/resume/engine/validate";
import { jobFocusFor, jobSkills, skillCoverage, skillHits } from "@/lib/resume/coverage";
import { tailoredFileName } from "@/lib/resume/repo";
import type { Application } from "@/lib/types";
import { Button, inputClass, Notice, Spinner } from "@/components/ui";
import AIErrorNotice from "@/components/resumes/AIErrorNotice";
import SkillGapsCard, { type PlaceOption } from "./SkillGapsCard";
import PreTailorCard from "./PreTailorCard";
import { applyConfirmations, confirmedForPrompt, placeChoices, preTailorGaps, type ConfirmedSkill } from "@/lib/resume/gaps";
import AskForChanges from "./AskForChanges";
import QualityCard from "./QualityCard";
import TailoredForCard from "./TailoredForCard";
import { lintResume } from "@/lib/resume/quality/lint";
import { issuesToComments, qualityScore } from "@/lib/resume/quality/summary";
import { readBreakdown } from "@/lib/intake/stored";

/**
 * Rough cost of one tailoring run on Sonnet-class pricing, shown before she spends it: one call at
 * high effort, plus one short follow-up only when the page ends short or needs a writing fix.
 */
export const TAILOR_COST_HINT = "about 6 to 12¢";
/** A revision reuses the cached system prompt (rules + master profile), so it's a bit cheaper. */
export const REVISE_COST_HINT = "about 4¢";

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

/** One flagged line: what's wrong, and Keep / Remove. */
function FlagRow({ flag, onKeep, onRemove, disabled }: { flag: Flag; onKeep: () => void; onRemove: () => void; disabled?: boolean }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 text-[13px]">
      <span className="min-w-0 flex-1">
        <span className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${flag.severity === "block" ? "bg-bad-soft text-bad" : "bg-white text-ink"}`}>
          {flag.severity === "block" ? "Left out" : "Check"}
        </span>
        {flag.message}
      </span>
      <span className="flex shrink-0 gap-1">
        <button type="button" disabled={disabled} onClick={onKeep} className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-xs font-medium hover:bg-accent-soft hover:text-accent-deep disabled:opacity-40">
          Keep
        </button>
        <button type="button" disabled={disabled} onClick={onRemove} className="rounded-full px-2.5 py-0.5 text-xs font-medium text-bad hover:bg-bad-soft disabled:opacity-40">
          Remove
        </button>
      </span>
    </li>
  );
}

/** A skill she placed in a role, waiting for the one call that writes it into that role's bullets. */
interface Placement {
  skill: string;
  how: string;
  role: RoleKey;
  label: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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
  const [master, setMasterState] = useState<string | null>(null);
  // The latest experience text, also for calls that start in the same click that changed it.
  const masterRef = useRef("");
  const setMaster = (m: string) => {
    masterRef.current = m;
    setMasterState(m);
  };
  const [header, setHeader] = useState<ResumeHeader | null>(null);
  const [fullName, setFullName] = useState("");
  const [phase, setPhase] = useState<"idle" | "generating" | "ready" | "saving" | "revising">("idle");
  const [error, setError] = useState<string | null>(null);
  // An AI call that failed, shown with the link that fixes it (credit, key, rate limit...).
  const [aiError, setAiError] = useState<unknown>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  // Flags she decided to keep: a blocked line she confirmed, or a note she looked at.
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<(ExportResult & { fileName: string }) | null>(null);
  // Every version is saved to this job automatically; this tracks that, not the download.
  const [storedId, setStoredId] = useState<number | null>(null);
  const [storeState, setStoreState] = useState<"idle" | "saving" | "saved">("idle");
  const loadedFromStore = useRef(false);
  const [saver] = useState(() => createDebouncedSave(600));
  const started = useRef(false);
  const [placements, setPlacements] = useState<Placement[]>([]);
  // The before-tailoring question: skills she already answered (ticked or not) aren't asked again.
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [preStep, setPreStep] = useState(false);
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
  const [changes, setChanges] = useState<string[]>([]);
  const [history, setHistory] = useState<{ result: ValidationResult; approved: Set<string> }[]>([]);
  const previewBox = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // The job's skills and what the job is about (must-haves, domains, responsibilities, role family).
  const { fitBreakdown, jdText, role } = application;
  const skillsForJob = useMemo(() => (master ? jobSkills({ fitBreakdown, jdText }, master) : []), [fitBreakdown, jdText, master]);
  const focus = useMemo(() => (master ? jobFocusFor({ fitBreakdown, jdText, role }, master) : null), [fitBreakdown, jdText, role, master]);
  const checkOpts = useMemo(() => ({ jobSkills: skillsForJob, focus: focus ?? undefined }), [skillsForJob, focus]);
  const fitOpts = useMemo(
    () => (focus ? { focus } : { relevance: (text: string) => skillHits(skillsForJob, text) }),
    [focus, skillsForJob],
  );
  const requiredSkills = useMemo(() => {
    const s = readBreakdown({ fitBreakdown })?.skills;
    return s ? [...s.required.have, ...s.required.gap] : [];
  }, [fitBreakdown]);

  useEffect(() => {
    Promise.all([getMasterProfile(), getProfile(), getJobResume(application.id)]).then(([m, p, existing]) => {
      // Reopen the resume already saved for this job, with her decisions, instead of an empty panel.
      if (existing && m.trim()) {
        const reopened = validateResume(existing.stored.doc, m, { jobSkills: jobSkills(application, m), focus: jobFocusFor(application, m) });
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

  // The job's skills her experience doesn't show and she hasn't answered yet: asked before tailoring.
  const pendingGaps = useMemo(
    () => (master ? preTailorGaps({ fitBreakdown, jdText }, master).filter((g) => !answered.has(g.skill.toLowerCase())) : []),
    [fitBreakdown, jdText, master, answered],
  );
  const masterPlaces = useMemo(() => (master ? placeChoices(master) : []), [master]);

  /** "Tailor resume" / "Start over": ask about the job's missing skills first, when there are any. */
  const start = () => {
    if (pendingGaps.length) setPreStep(true);
    else void generate([]);
  };

  /**
   * One tailoring run. Her answers to the before-tailoring question are saved to her experience
   * first (gaps.ts applyConfirmations), so the call and the checks both see them as hers.
   */
  const generate = async (confirmed: ConfirmedSkill[]) => {
    let m = masterRef.current;
    if (!m.trim() || !header) return;
    setError(null);
    setAiError(null);
    setSaved(null);
    setPreStep(false);
    setAnswered((a) => new Set([...a, ...pendingGaps.map((g) => g.skill.toLowerCase())]));
    if (confirmed.length) {
      const updated = applyConfirmations(m, confirmed);
      if (updated !== m) {
        try {
          await saveMasterProfile(updated);
        } catch (e) {
          setError(`Couldn't save your skills to Your experience: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        setMaster(updated);
        m = updated;
      }
    }
    setPhase("generating");
    try {
      // One call writes the final page to a plan computed from the real layout; a second, short one
      // only when the measured page ends short or code found a writing fix (pipeline.ts).
      const out = await tailorResume({
        provider: await getProvider(),
        master: m,
        company: application.company,
        jdText: application.jdText,
        jobSkills: skillsForJob,
        requiredSkills,
        focus: focus ?? undefined,
        measure: (d) => pageFill(header, d),
        confirmed: confirmedForPrompt(confirmed),
      });
      setResult(out.result);
      setApproved(new Set());
      setChanges(out.notes);
      setHistory([]);
      setPlacements([]);
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
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, master, header]);

  // The page as shown: the whole document measured on the real HTML rendering. Normally it already
  // fits; if it runs over, the lowest-relevance bullet goes; if short, the type grows within 11pt.
  const fitted = useMemo(() => {
    if (!result || !header) return null;
    return fitResume(result.doc, (d) => pageFill(header, d), fitOpts);
  }, [result, header, fitOpts]);

  // Flags on the visible page, and the ones still waiting for her decision.
  const visibleFlags = useMemo(() => {
    if (!result || !fitted) return [];
    return result.flags.flatMap((f) => {
      const spot = toVisibleSpot(fitted.map, f.target);
      return spot ? [{ flag: f, spot }] : [];
    });
  }, [result, fitted]);
  const openFlags = useMemo(() => visibleFlags.filter((v) => !approved.has(v.flag.id)), [visibleFlags, approved]);

  // What gets downloaded: the page without blocked lines she hasn't kept.
  const finalDoc = useMemo(() => {
    if (!fitted) return null;
    return applyApprovals(
      fitted.doc,
      visibleFlags.map((v) => ({ ...v.flag, target: v.spot })),
      approved,
    );
  }, [fitted, visibleFlags, approved]);

  // In plain words, what was done differently for this job.
  const tailoredFor = useMemo(() => (fitted && focus ? explainTailoring(focus, fitted) : []), [fitted, focus]);

  // Share of the job's skills the page shows, vs. how many of them the full master profile has.
  const coverage = useMemo(() => {
    if (!finalDoc || !master) return null;
    const onPage = skillCoverage(skillsForJob, resumeText(finalDoc));
    const inProfile = skillCoverage(skillsForJob, master);
    if (!onPage || !inProfile) return null;
    return { before: inProfile.percent, after: onPage.percent };
  }, [finalDoc, master, skillsForJob]);

  // Save each new version (a generation, a revision, a decision) to this job, shortly after it settles.
  useEffect(() => {
    if (!finalDoc || !header || !result || phase !== "ready") return;
    if (loadedFromStore.current) {
      loadedFromStore.current = false; // just reopened: nothing new to save
      return;
    }
    setStoreState("saving");
    saver.schedule(async () => {
      try {
        const bytes = await renderResumeDocx(header, finalDoc);
        const approvedMessages = result.flags.filter((f) => approved.has(f.id)).map((f) => f.message);
        const id = await storeJobResume(application.id, bytes, { v: 2, doc: result.doc, approved: approvedMessages, final: finalDoc }, coverage ?? { before: 0, after: 0 });
        setStoredId(id);
        setStoreState("saved");
        onSaved?.(id);
      } catch (e) {
        setError(`Couldn't save this resume to the job: ${e instanceof Error ? e.message : String(e)}`);
        setStoreState("idle");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalDoc, phase]);
  // Closing the panel right after a decision or an edit still saves it, instead of dropping it.
  useEffect(() => () => void saver.flush(), [saver]);

  const download = async () => {
    if (!finalDoc || !header) return;
    setPhase("saving");
    setError(null);
    try {
      const bytes = await renderResumeDocx(header, finalDoc);
      const fileName = tailoredFileName(fullName, application.company, application.role);
      setSaved({ fileName, ...(await exportResume(bytes, fileName, storedId ?? undefined)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("ready");
    }
  };

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
  // (a decision, an undo) that position can point at a different bullet, so close it.
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

  // While the menu is open: Escape and a click outside close only the menu (not the whole dialog),
  // and keyboard focus moves into it.
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

  /** Apply a hand edit (no AI): re-check it against her experience, keep her decisions, allow undo. */
  const commitDoc = (next: ResumeDoc, masterText = masterRef.current) => {
    // While an update is running its answer would replace this edit, so edits wait for it.
    if (!result || !masterText || phase !== "ready") return;
    const checked = validateResume(next, masterText, checkOpts);
    setHistory((h) => [...h, { result, approved }]);
    setResult(checked);
    setApproved(carryApprovals(result.flags, approved, checked.flags));
    setChanges([]);
    setSaved(null);
  };

  /** Remove and Edit act on what she clicked on the page, applied to the same spot in the document. */
  const commitOnPool = (visible: Target, change: (pool: ResumeDoc, target: Target) => ResumeDoc) => {
    if (!result || !fitted) return;
    const target = toPoolTarget(fitted.map, visible);
    if (target) commitDoc(change(result.doc, target));
  };

  const keepFlag = (f: Flag) => setApproved((s) => new Set([...s, f.id]));
  const removeFlagged = (f: Flag) => {
    if (result) commitDoc(removeSpot(result.doc, f.target));
  };

  // Roles and projects on the page she can place a skill in, as written in her experience.
  const places = useMemo(() => {
    if (!finalDoc || !master) return [] as (PlaceOption & { role: RoleKey; section: "experience" | "projects" })[];
    const entries = parseMasterExperiences(master);
    const out: (PlaceOption & { role: RoleKey; section: "experience" | "projects" })[] = [];
    (["experience", "projects"] as const).forEach((section) =>
      (finalDoc[section] ?? []).forEach((e) => {
        const m = entries.find((x) => norm(x.company) === norm(e.company));
        if (!m) return;
        const role = { company: m.company, title: cleanTitle(m.title) };
        out.push({ key: `${section}:${norm(m.company)}:${norm(role.title)}`, label: section === "projects" ? m.company : `${m.company} (${role.title})`, role, section });
      }),
    );
    return out;
  }, [finalDoc, master]);

  /** One comment per skill she placed in a role, on that role's spot in the document. */
  const placementComments = (doc: ResumeDoc): ResumeComment[] =>
    placements.map((p) => {
      const find = (section: "experience" | "projects") => (doc[section] ?? []).findIndex((e) => norm(e.company) === norm(p.role.company));
      const exp = find("experience");
      const proj = exp < 0 ? find("projects") : -1;
      const target: Target | undefined = exp >= 0 ? { section: "experience", entry: exp } : proj >= 0 ? { section: "projects", entry: proj } : undefined;
      return placementComment(p.skill, p.how, target, p.label);
    });

  /**
   * One revision call with everything she asked for, plus any skills waiting to be placed. Runs
   * right away; the answer is checked like any generation (anything new still needs her OK).
   */
  const runRevision = async (requests: ResumeComment[]) => {
    if (!result || phase !== "ready") return;
    const all = [...requests, ...placementComments(result.doc)];
    if (all.length === 0) return;
    const m = masterRef.current;
    setError(null);
    setAiError(null);
    setSaved(null);
    setSelection(null);
    setPhase("revising");
    try {
      const out = await reviseResume(await getProvider(), m, application.company, application.jdText, result.doc, all);
      const { changes: done, ...doc } = out;
      // A model answer: the job's skills she has go back on the Skills lines if it dropped any.
      const next = validateResume(doc, m, { ...checkOpts, addJobSkills: true });
      setHistory((h) => [...h, { result, approved }]);
      // Her current decisions, including any made while the update was running.
      setApproved((current) => carryApprovals(result.flags, current, next.flags));
      setResult(next);
      setChanges(done);
      setPlacements([]);
    } catch (e) {
      setAiError(e);
    } finally {
      setPhase("ready");
    }
  };

  /** A request on the spot she clicked, sent right away. */
  const ask = (text: string) => {
    if (!selection || !text.trim()) return;
    const target = selection.target && fitted ? toPoolTarget(fitted.map, selection.target) : null;
    void runRevision([{ id: `ask-${Date.now()}`, quote: selection.quote, note: text.trim(), ...(target ? { target } : {}) }]);
  };

  /**
   * A job skill she added from the list. The skills section is updated right away (free). A skill
   * that isn't in her experience is saved to it (her click is the confirmation, decision #6), and a
   * role she chose is saved as a usage note tied to that exact role, so the validator accepts the
   * skill in that role's bullets; the rewrite itself waits for "Apply".
   */
  const addGap = async (skill: string, placeKey: string, how: string) => {
    if (!result || phase !== "ready") return;
    let m = masterRef.current;
    if (!hasSkill(skill, parseSkillInventory(m), m)) m = appendSkillToMaster(m, skill);
    const place = places.find((p) => p.key === placeKey);
    if (place) m = appendUsageNote(m, skill, how, place.role);
    if (m !== masterRef.current) {
      try {
        await saveMasterProfile(m);
      } catch (e) {
        setError(`Couldn't save ${skill} to Your experience: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      setMaster(m);
    }
    commitDoc(addSkill(result.doc, skill), m);
    if (place) setPlacements((ps) => [...ps.filter((p) => !(p.skill === skill && p.label === place.label)), { skill, how, role: place.role, label: place.label }]);
  };

  const closePopover = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    // Return keyboard focus to the line the menu was opened from.
    openedFrom.current?.focus?.();
    openedFrom.current = null;
  };

  // Writing quality, checked by code on the visible page: AI-sounding words, weak or repeated verbs,
  // lengths, bold use, repetition, and the job's keywords (lib/resume/quality).
  const quality = useMemo(() => {
    if (!finalDoc || !master) return null;
    const inventory = parseSkillInventory(master);
    const have = skillsForJob.filter((x) => hasSkill(x, inventory, master));
    const issues = lintResume(finalDoc, { jobSkills: have, requiredSkills });
    return { issues, ...qualityScore(issues) };
  }, [finalDoc, master, skillsForJob, requiredSkills]);

  // The job's skills the page doesn't show, and whether her experience has each one.
  const skillGaps = useMemo(() => {
    if (!finalDoc || !master) return null;
    const onPage = skillCoverage(skillsForJob, resumeText(finalDoc));
    if (!onPage) return null;
    const inventory = parseSkillInventory(master);
    return {
      total: skillsForJob.length,
      onPage: onPage.found.length,
      gaps: onPage.missing.map((s) => ({ skill: s, inProfile: hasSkill(s, inventory, master) })),
    };
  }, [finalDoc, master, skillsForJob]);

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
        <Spinner label="Writing your resume for this job. This usually takes about a minute..." />
      </div>
    );
  }

  const preTailor = (
    <PreTailorCard
      gaps={pendingGaps}
      places={masterPlaces}
      cost={TAILOR_COST_HINT}
      onTailor={(confirmed) => void generate(confirmed)}
      onSkip={() => void generate([])}
      disabled={phase === "revising"}
    />
  );

  if (!result || !fitted || !finalDoc) {
    // Before the first resume: the missing-skills question comes first, when the job has any.
    if (pendingGaps.length) {
      return (
        <div className="grid gap-3">
          {notStartedReason && <p className="text-sm text-muted">{notStartedReason}</p>}
          {preTailor}
          {error && <Notice kind="error">{error}</Notice>}
          {aiError !== null && <AIErrorNotice error={aiError} />}
        </div>
      );
    }
    return (
      <div className="rounded-2xl bg-paper p-4">
        {notStartedReason && <p className="mb-3 text-sm text-muted">{notStartedReason}</p>}
        <Button onClick={() => void generate([])}>Tailor resume ({TAILOR_COST_HINT})</Button>
        {error && <Notice kind="error">{error}</Notice>}
        {aiError !== null && <AIErrorNotice error={aiError} />}
      </div>
    );
  }

  const busy = phase !== "ready";
  const { fixes } = result;
  const swapOptions = selection?.target?.section === "experience" && selection.target.bullet === undefined ? entriesNotOnPage(master, fitted.doc) : [];
  const targetLabel = selection?.target ? describeTarget(fitted.doc, selection.target) : null;
  const editable = selection?.target ? textOfTarget(fitted.doc, selection.target) : null;
  const flagsHere = selection?.target ? openFlags.filter((v) => spotOn(v.spot, selection.target!)) : [];
  const fillPercent = Math.round(fitted.fill * 100);
  const blocked = openFlags.filter((v) => v.flag.severity === "block").length;
  const short = fitted.fits ? linesShort(fitted.baseFill) : 0;

  // Her final check of the finished page (lib/resume/engine/verify.ts), plus what code fixed.
  const verified = verifyResume({ header, doc: finalDoc, fits: fitted.fits, fill: fitted.fill, master });
  const qualityFixes = quality?.issues.filter((i) => i.severity === "fix") ?? [];
  const checks = [
    ...verified.filter((c) => c.id !== "one-page" && c.id !== "fill").map((c) => ({ ok: c.ok, text: c.label })),
    // Hard requirements of the job she may not meet, as the tailoring call saw them.
    ...(result.doc.meta.warnings ?? []).map((w) => ({ ok: false, text: `Heads-up: ${w}` })),
    {
      ok: openFlags.length === 0,
      text:
        openFlags.length === 0
          ? "Every skill, number, employer and date was found in Your experience"
          : `${openFlags.length} line${openFlags.length === 1 ? "" : "s"} marked on the page for you to keep or remove`,
    },
    {
      ok: fitted.fits && !fitted.underfilled,
      text: !fitted.fits
        ? "Still over one page; check it in Word"
        : fitted.underfilled
          ? `Fits on one page but uses only ${fillPercent}% of it`
          : `Fits on one page and uses ${fillPercent}% of it`,
    },
    { ok: qualityFixes.length === 0, text: qualityFixes.length ? `${qualityFixes.length} writing issue${qualityFixes.length === 1 ? "" : "s"} to fix` : "No weak verbs, buzzwords or overlong bullets" },
  ];
  const failing = checks.filter((c) => !c.ok).length;
  const autoFixed = [...fixes, ...fitted.steps, ...(fitted.removed.length ? [`Left off ${fitted.removed.length} less relevant line${fitted.removed.length === 1 ? "" : "s"} to fit one page.`] : [])];

  const checksList = (
    <>
      <ul className="grid gap-1.5 text-sm">
        {checks.map((c) => (
          <li key={c.text} className="flex gap-2">
            <CheckIcon ok={c.ok} />
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
      {autoFixed.length > 0 && <p className="mt-2 text-xs text-muted">Fixed automatically: {autoFixed.join(" ")}</p>}
      {fitted.underfilled && short > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void runRevision([{ id: "fill", quote: "", note: fillComment(short) }])} disabled={busy}>
            Fill the page ({REVISE_COST_HINT})
          </Button>
          <span className="text-xs text-muted">Adds about {short} line{short === 1 ? "" : "s"} from Your experience.</span>
        </div>
      )}
      {quality && qualityFixes.length > 0 && (
        <div className="mt-3">
          <QualityCard
            score={quality.score}
            issues={quality.issues}
            onFix={() =>
              void runRevision(
                issuesToComments(quality.issues).map((c) => {
                  const target = c.target ? toPoolTarget(fitted.map, c.target) : null;
                  return { ...c, target: target ?? undefined };
                }),
              )
            }
            queued={phase === "revising"}
            disabled={busy}
            costHint={REVISE_COST_HINT}
          />
        </div>
      )}
    </>
  );

  return (
    <div className="grid gap-4">
      {preStep && pendingGaps.length > 0 && preTailor}
      <TailoredForCard lines={tailoredFor} />

      {openFlags.length > 0 && (
        <section className="rounded-2xl bg-warn-soft p-5" aria-labelledby="flags-heading">
          <h3 id="flags-heading" className="text-[15px] font-semibold tracking-display">
            Check {openFlags.length} line{openFlags.length === 1 ? "" : "s"} on the page
          </h3>
          <p className="mb-3 mt-0.5 text-xs text-muted">
            {blocked > 0 ? "Struck-through lines aren't in Your experience and stay out of the download unless you keep them. " : ""}
            Highlighted lines are true but worth a look.
          </p>
          <ul className="grid gap-2">
            {openFlags.map(({ flag }) => (
              <FlagRow key={flag.id} flag={flag} onKeep={() => keepFlag(flag)} onRemove={() => removeFlagged(flag)} disabled={busy} />
            ))}
          </ul>
        </section>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold tracking-display">Your resume</p>
          <p className="text-xs text-muted">Click a line, or select any text, to change it.</p>
        </div>
        <div ref={previewBox} className="relative min-w-0 rounded-2xl bg-paper p-3" onMouseUp={onPreviewMouseUp} onKeyDown={onPreviewKeyDown}>
          {phase === "revising" && (
            <div className="absolute inset-x-3 top-3 z-10 rounded-xl bg-white/90 p-3 shadow-card">
              <Spinner label="Updating your resume. This takes about 30 seconds..." />
            </div>
          )}
          <div className="mx-auto shadow-lift" style={{ width: `${8.5 * scale}in`, height: `${11 * scale}in`, overflow: "hidden" }}>
            <div ref={pageRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "8.5in" }}>
              <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
              {/* renderResumeHtml escapes every string; no model output is inserted as raw HTML. */}
              <div dangerouslySetInnerHTML={{ __html: renderResumeHtml(header, fitted.doc, openFlags.map((v) => ({ kind: v.flag.severity, spot: v.spot }))) }} />
            </div>
          </div>
          {selection && (
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Change this part of the resume"
              className="absolute z-20 overflow-auto rounded-2xl bg-white p-4 shadow-card ring-1 ring-black/[0.08]"
              style={{ left: selection.x, top: selection.y, width: selection.width, maxHeight: selection.maxHeight }}
              onMouseUp={(e) => e.stopPropagation()}
            >
              {targetLabel && <p className="text-xs font-medium text-muted">{targetLabel[0].toUpperCase() + targetLabel.slice(1)}</p>}
              <p className="mt-1 line-clamp-2 border-l-2 border-accent pl-2 text-xs text-muted">{selection.quote}</p>

              {flagsHere.length > 0 && popoverMode === "actions" && (
                <ul className="mt-3 grid gap-2 rounded-xl bg-warn-soft p-2">
                  {flagsHere.map(({ flag }) => (
                    <FlagRow
                      key={flag.id}
                      flag={flag}
                      onKeep={() => {
                        keepFlag(flag);
                        closePopover();
                      }}
                      onRemove={() => {
                        removeFlagged(flag);
                        closePopover();
                      }}
                      disabled={busy}
                    />
                  ))}
                </ul>
              )}

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
                  {swapOptions.length > 0 && <PopoverAction onClick={() => setPopoverMode("swap")} label="Swap for another experience" hint="Pick a role from Your experience" />}
                  <PopoverAction
                    onClick={() => ask("Rewrite this to match the job's wording and keywords. Keep every fact, number and technology.")}
                    label="Rewrite for this job"
                    hint={`Runs now, ${REVISE_COST_HINT}`}
                  />
                  <PopoverAction
                    onClick={() => ask("Make this shorter, one line if possible, keeping its number and main technology.")}
                    label="Make it shorter"
                    hint={`Runs now, ${REVISE_COST_HINT}`}
                  />
                  <PopoverAction onClick={() => setPopoverMode("custom")} label="Ask for something else" hint="e.g. mention the Jest tests here" />
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
                          ask(
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
                    {selection.target.section === "skills" ? "Separate skills with commas." : "Anything new that isn't in your experience is marked for you to keep."}
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
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(note);
                    }}
                    placeholder="What should change? e.g. Mention that I used Docker here"
                    className={`mt-3 ${inputClass} text-sm`}
                  />
                  <div className="mt-2 flex justify-between gap-2">
                    <Button variant="secondary" onClick={() => setPopoverMode("actions")}>
                      Back
                    </Button>
                    <Button onClick={() => ask(note)} disabled={!note.trim()}>
                      Run ({REVISE_COST_HINT})
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <AskForChanges
        onSend={(text) => void runRevision([{ id: `ask-${Date.now()}`, quote: "", note: text }])}
        busy={phase === "revising"}
        disabled={busy}
        cost={REVISE_COST_HINT}
        changes={changes}
      />

      {skillGaps && (
        <SkillGapsCard
          total={skillGaps.total}
          onPage={skillGaps.onPage}
          gaps={skillGaps.gaps}
          places={places}
          pending={placements.map((p) => ({ skill: p.skill, placeLabel: p.label }))}
          onAdd={(skill, place, how) => void addGap(skill, place, how)}
          onApply={() => void runRevision([])}
          onCancel={(i) => setPlacements((ps) => ps.filter((_, k) => k !== i))}
          applyCost={REVISE_COST_HINT}
          disabled={busy}
        />
      )}

      <section className="rounded-2xl bg-paper p-5" aria-label="Checks">
        {failing === 0 ? (
          <details>
            <summary className="flex cursor-pointer items-center gap-2 text-[15px] font-semibold tracking-display">
              <CheckIcon ok />
              All {checks.length} checks passed
            </summary>
            <div className="mt-3">{checksList}</div>
          </details>
        ) : (
          <>
            <p className="mb-3 text-[15px] font-semibold tracking-display">Checks</p>
            {checksList}
          </>
        )}
      </section>

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
          <Button variant="secondary" onClick={start} disabled={busy}>
            Start over ({TAILOR_COST_HINT})
          </Button>
          {history.length > 0 && (
            <Button variant="secondary" onClick={undo} disabled={busy}>
              Undo
            </Button>
          )}
        </div>
        <span className="ml-auto text-xs text-muted" aria-live="polite">
          {storeState === "saving" ? "Saving to this job..." : storeState === "saved" ? "Saved to this job" : ""}
          {blocked > 0 ? `${storeState !== "idle" ? ". " : ""}${blocked} struck line${blocked === 1 ? " is" : "s are"} left out of the download` : ""}
        </span>
        <Button onClick={download} disabled={busy}>
          {phase === "saving" ? "Saving..." : "Download .docx"}
        </Button>
      </div>
    </div>
  );
}
