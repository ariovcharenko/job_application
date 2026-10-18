"use client";

import { useState } from "react";
import { Button, compactInputClass, inputClass, outlinedClass } from "@/components/ui";
import type { ReviewItem, ReviewPriority } from "@/lib/resume/engine/review";
import { factSaveTarget, type ReadinessCounts } from "@/lib/resume/engine/reviewState";

export type { ReadinessCounts };

/** A role or project on the page she can place a skill in. */
export interface PlaceOption {
  key: string;
  label: string;
}

const SKILLS_ONLY = "";

const PRIORITY_LABEL: Record<ReviewPriority, string> = { high: "Fix first", medium: "Worth doing", low: "Nice to have" };

function Meter({ label, value, total, before }: { label: string; value: number; total: number; before?: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const changed = before !== undefined && before !== value;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          {changed && <span className="mr-1.5 text-muted line-through decoration-black/30">{before}</span>}
          <span className="font-semibold text-ink">{value}</span>
          <span className="text-muted"> of {total}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QuestionIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.2M8 11.4h.01" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 3.5 12.5 5.5M3 13l.6-2.6L10.5 3.5l2 2-6.9 6.9L3 13Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

/** Where a skill goes: Skills only, or Skills plus one role (with an optional note on how). */
function PlacePicker({
  skill,
  places,
  confirmLabel,
  onConfirm,
  onCancel,
  requirePlace,
  disabled,
}: {
  skill: string;
  places: PlaceOption[];
  confirmLabel: string;
  /** Only roles to choose from (no "Skills section only"). */
  requirePlace?: boolean;
  onConfirm: (place: string, how: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const [place, setPlace] = useState(requirePlace ? (places[0]?.key ?? SKILLS_ONLY) : SKILLS_ONLY);
  const [how, setHow] = useState("");
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`review-place-${skill}`}>
          Where to add {skill}
        </label>
        <select id={`review-place-${skill}`} value={place} onChange={(e) => setPlace(e.target.value)} className={`${compactInputClass} min-w-0 flex-1`}>
          {!requirePlace && <option value={SKILLS_ONLY}>Skills section only</option>}
          {places.map((p) => (
            <option key={p.key} value={p.key}>
              {requirePlace ? p.label : `Skills and ${p.label}`}
            </option>
          ))}
        </select>
        <Button size="sm" variant="tinted" disabled={disabled} onClick={() => onConfirm(place, how)}>
          {confirmLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {place !== SKILLS_ONLY && (
        <input
          value={how}
          onChange={(e) => setHow(e.target.value)}
          placeholder="How you used it (optional), e.g. wrote the payment retries in it"
          aria-label={`How you used ${skill} (optional)`}
          className={`${inputClass} py-2 text-[13px] sm:text-[13px]`}
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  queued,
  places,
  factPlace,
  onQueue,
  onUnqueue,
  onIgnore,
  onAddSkill,
  onAnswer,
  disabled,
}: {
  item: ReviewItem;
  queued: boolean;
  places: PlaceOption[];
  /** The role a fact question is about (a place key), when the item points at one. */
  factPlace?: string;
  onQueue: () => void;
  onUnqueue: () => void;
  onIgnore: () => void;
  onAddSkill: (skill: string, place: string, how: string) => void;
  /** `saveTo`: the role to also save the answer to in Your experience, or null. */
  onAnswer: (answer: string, saveTo: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  // "Also save to my experience": on by default, so she isn't asked the same thing for the next job.
  const [saveFact, setSaveFact] = useState(true);
  // Preselected only when the question points at a role; otherwise she picks one.
  const [factRole, setFactRole] = useState(factPlace ?? "");
  const saveTo = factSaveTarget(saveFact, factRole, places.map((p) => p.key));
  const submitAnswer = () => {
    if (answer.trim()) onAnswer(answer, saveTo);
  };
  const { action } = item;
  const isQuestion = action.type === "ask_skill" || action.type === "ask_fact" || action.type === "place_skill";

  return (
    <li className="rounded-xl bg-paper p-3">
      <div className="flex items-start gap-2">
        {isQuestion ? <QuestionIcon /> : <PenIcon />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[14px] font-medium">{isQuestion ? action.question : item.title}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-muted">{PRIORITY_LABEL[item.priority]}</span>
          </div>
          {item.why && <p className="mt-0.5 text-[13px] text-muted">{item.why}</p>}
          {(item.detail || item.where) && (
            <p className="mt-1 text-[13px]">
              {item.where && <span className="text-muted">{item.where[0].toUpperCase() + item.where.slice(1)}. </span>}
              {item.detail}
            </p>
          )}

          {action.type === "revise" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {queued ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-deep">
                    <CheckIcon />
                    In the update
                  </span>
                  <button type="button" onClick={onUnqueue} disabled={disabled} className="text-xs text-muted hover:text-ink">
                    Undo
                  </button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="tinted" onClick={onQueue} disabled={disabled}>
                    Add to update
                  </Button>
                  <button type="button" onClick={onIgnore} disabled={disabled} className="text-xs text-muted hover:text-ink">
                    Ignore
                  </button>
                </>
              )}
            </div>
          )}

          {action.type === "add_skill" &&
            (open ? (
              <PlacePicker skill={action.skill} places={places} confirmLabel="Add" disabled={disabled} onConfirm={(p, h) => onAddSkill(action.skill, p, h)} onCancel={() => setOpen(false)} />
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="tinted" onClick={() => setOpen(true)} disabled={disabled}>
                  Add {action.skill}
                </Button>
                <button type="button" onClick={onIgnore} disabled={disabled} className="text-xs text-muted hover:text-ink">
                  Ignore
                </button>
              </div>
            ))}

          {action.type === "ask_skill" &&
            (open ? (
              <>
                <PlacePicker
                  skill={action.skill}
                  places={places}
                  confirmLabel={`I have ${action.skill}`}
                  disabled={disabled}
                  onConfirm={(p, h) => onAddSkill(action.skill, p, h)}
                  onCancel={() => setOpen(false)}
                />
                <p className="mt-1 text-xs text-muted">Only if it&apos;s true. It&apos;s saved to Your experience, so you won&apos;t be asked again.</p>
              </>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="tinted" onClick={() => setOpen(true)} disabled={disabled}>
                  Yes, I have
                </Button>
                <Button size="sm" variant="secondary" onClick={onIgnore} disabled={disabled}>
                  No
                </Button>
              </div>
            ))}

          {action.type === "place_skill" &&
            (places.length === 0 ? (
              <p className="mt-2 text-xs text-muted">No role on the page can show it yet. Keep it in Skills, or swap in the role where you used it.</p>
            ) : open ? (
              <PlacePicker
                skill={action.skill}
                places={places}
                requirePlace
                confirmLabel="Show it there"
                disabled={disabled}
                onConfirm={(p, h) => onAddSkill(action.skill, p, h)}
                onCancel={() => setOpen(false)}
              />
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="tinted" onClick={() => setOpen(true)} disabled={disabled}>
                  Pick the role
                </Button>
                <button type="button" onClick={onIgnore} disabled={disabled} className="text-xs text-muted hover:text-ink">
                  Ignore
                </button>
              </div>
            ))}

          {action.type === "ask_fact" &&
            (queued ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-deep">
                  <CheckIcon />
                  Your answer is in the update
                </span>
                <button type="button" onClick={onUnqueue} disabled={disabled} className="text-xs text-muted hover:text-ink">
                  Undo
                </button>
              </div>
            ) : (
              <div className="mt-2 grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitAnswer();
                    }}
                    placeholder="Your answer, in your words"
                    aria-label="Your answer"
                    className={`${inputClass} min-w-0 flex-1 py-2 text-[13px] sm:text-[13px]`}
                  />
                  <Button size="sm" variant="tinted" onClick={submitAnswer} disabled={disabled || !answer.trim()}>
                    Use my answer
                  </Button>
                  <Button size="sm" variant="secondary" onClick={onIgnore} disabled={disabled}>
                    Skip
                  </Button>
                </div>
                {places.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={saveFact} onChange={(e) => setSaveFact(e.target.checked)} className="h-4 w-4 accent-accent" />
                      Also save to my experience
                    </label>
                    {saveFact && (
                      <>
                        <label className="sr-only" htmlFor={`fact-role-${item.id}`}>
                          Role to save your answer to
                        </label>
                        <select id={`fact-role-${item.id}`} value={factRole} onChange={(e) => setFactRole(e.target.value)} className={`${compactInputClass} min-w-0 max-w-full`}>
                          <option value="">Choose a role</option>
                          {places.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted">
                  {saveFact && places.length > 0 && !saveTo
                    ? "Choose a role to also save your answer to Your experience. Without one, it's only used on this page."
                    : saveTo
                    ? "Saved under that role in Your experience, so it can be used there for other jobs too. It's never used in another role."
                    : "Anything new in your answer is marked on the page for you to keep."}
                </p>
              </div>
            ))}
        </div>
      </div>
    </li>
  );
}

/**
 * The one place for "what to fix": the job's skills the page misses (found by code, free) and,
 * after "Review", what this company's recruiter would change (one AI call). Changes are queued and
 * sent in one update; anything that needs a fact Your experience doesn't have is asked as a
 * question, never written (decision #6).
 */
export default function RecruiterReviewCard({
  company,
  now,
  before,
  summary,
  items,
  queuedIds,
  ignoredCount,
  places,
  placeForItem,
  pendingPlacements,
  onQueue,
  onUnqueue,
  onIgnore,
  onShowIgnored,
  onAddSkill,
  onAnswer,
  onCancelPlacement,
  onApply,
  onReview,
  reviewing,
  reviewed,
  disabled,
}: {
  company: string;
  now: ReadinessCounts;
  /** The counts when this draft (or the last review) started, to show what changed since. */
  before: ReadinessCounts | null;
  summary: string | null;
  items: ReviewItem[];
  queuedIds: Set<string>;
  ignoredCount: number;
  places: PlaceOption[];
  /** The role on the page a fact question is about, as a place key. */
  placeForItem?: (item: ReviewItem) => string | undefined;
  pendingPlacements: { skill: string; placeLabel: string }[];
  onQueue: (item: ReviewItem) => void;
  onUnqueue: (id: string) => void;
  onIgnore: (id: string) => void;
  onShowIgnored: () => void;
  onAddSkill: (skill: string, place: string, how: string) => void;
  onAnswer: (item: ReviewItem, answer: string, saveTo: string | null) => void;
  onCancelPlacement: (index: number) => void;
  onApply: () => void;
  onReview: () => void;
  reviewing: boolean;
  reviewed: boolean;
  disabled?: boolean;
}) {
  const pending = queuedIds.size + pendingPlacements.length;
  const who = company.trim() ? `${company.trim()}'s recruiter` : "the recruiter";

  return (
    <section className={`${outlinedClass} p-5`} aria-labelledby="review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="review-heading" className="text-[15px] font-semibold tracking-display">
            Recruiter review
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">What {who} would change so this page reads like the ideal candidate. Nothing is written without your OK.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onReview} disabled={disabled || reviewing}>
          {reviewing ? "Reviewing..." : reviewed ? "Review again" : `Review as ${who}`}
        </Button>
      </div>

      {now.total > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-5">
          <Meter label="Key skills on the page" value={now.shown} total={now.total} before={before?.shown} />
          <Meter label="Shown in a bullet" value={now.proven} total={now.total} before={before?.proven} />
        </div>
      )}

      {reviewing && <p className="mt-4 text-[13px] text-muted">Reading your page as {who}. This takes about 20 seconds...</p>}
      {summary && !reviewing && <p className="mt-4 text-[14px] leading-relaxed">{summary}</p>}

      {items.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              queued={queuedIds.has(item.id)}
              places={places}
              factPlace={item.action.type === "ask_fact" ? placeForItem?.(item) : undefined}
              onQueue={() => onQueue(item)}
              onUnqueue={() => onUnqueue(item.id)}
              onIgnore={() => onIgnore(item.id)}
              onAddSkill={onAddSkill}
              onAnswer={(a, saveTo) => onAnswer(item, a, saveTo)}
              disabled={disabled}
            />
          ))}
        </ul>
      ) : (
        !reviewing && (
          <p className="mt-4 text-[13px] text-muted">
            {reviewed
              ? "Nothing left to fix from this review."
              : now.shown === now.total
                ? "Every key skill this job asks for is on the page. Run a review for advice on wording, numbers and emphasis."
                : "Run a review for advice on wording, numbers and emphasis."}
          </p>
        )
      )}
      {ignoredCount > 0 && (
        <button type="button" onClick={onShowIgnored} className="mt-2 text-xs text-muted hover:text-ink">
          Show {ignoredCount} ignored
        </button>
      )}

      {pending > 0 && (
        <div className="mt-4 rounded-xl bg-accent-soft/50 p-3">
          {pendingPlacements.length > 0 && (
            <ul className="mb-2 grid gap-1 text-[13px]">
              {pendingPlacements.map((p, i) => (
                <li key={`${p.skill}-${p.placeLabel}`} className="flex items-center justify-between gap-2">
                  <span>
                    Write {p.skill} into {p.placeLabel}
                  </span>
                  <button type="button" onClick={() => onCancelPlacement(i)} className="text-xs text-muted hover:text-bad" disabled={disabled}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px]">
              {pending} change{pending === 1 ? "" : "s"} ready. They are made in one update and marked in yellow.
            </p>
            <Button onClick={onApply} disabled={disabled}>
              Update resume with {pending} change{pending === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
