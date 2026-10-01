"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MONTHS, START_PRESETS } from "@/lib/options";
import type { SaveStatus } from "@/lib/useAutosave";
import { formatMonthYear, parseMonthYear, yearChoices, type MonthYear } from "@/lib/monthYear";

/** "Anthropic API key" -> "anthropic-api-key", used as the card's anchor for in-page navigation. */
export function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function Card({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={slugify(title)} className="mb-5 scroll-mt-24 rounded-[22px] bg-white p-6 shadow-soft sm:p-8">
      <div className="mb-6">
        <h2 className="text-[21px] font-semibold leading-tight tracking-display">{title}</h2>
        {hint && <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Page title with an optional one-line description and right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="animate-rise mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0 flex-1 basis-80">
        <h1 className="text-[40px] font-semibold leading-[1.08] tracking-display sm:text-[48px]">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-[19px] leading-snug text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Dashed-border placeholder for an empty list. */
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[22px] bg-white px-6 py-16 text-center shadow-soft">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <p className="text-[19px] font-semibold tracking-display">{title}</p>
      {children && <div className="mt-2 text-[15px] text-muted">{children}</div>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-black/[0.1] bg-white px-3.5 py-2.5 text-base outline-none transition placeholder:text-black/30 hover:border-black/20 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-[15px]";

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  /** Optional dropdown of ideas; the user can still type anything. */
  suggestions?: string[];
}) {
  const listId = useId();
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[13px] font-medium text-black/60">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        list={suggestions ? listId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[13px] font-medium text-black/60">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Pick any number of items from a list by clicking chips; optionally add your own. */
export function ChipSelect({
  label,
  options,
  value,
  onChange,
  hint,
  allowCustom = false,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
  allowCustom?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  const addCustom = () => {
    const c = custom.trim();
    if (c && !value.includes(c)) onChange([...value, c]);
    setCustom("");
  };
  return (
    <fieldset className="text-sm">
      <legend className="mb-1.5 text-[13px] font-medium text-black/60">{label}</legend>
      {hint && <p className="mb-2.5 text-xs text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {all.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o)}
              className={`inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
                on
                  ? "border-accent bg-accent-soft text-accent-deep"
                  : "border-black/[0.1] bg-white text-black/65 hover:border-black/25 hover:text-ink"
              }`}
            >
              {on && (
                <svg viewBox="0 0 24 24" className="-ml-0.5 h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              )}
              {o}
            </button>
          );
        })}
      </div>
      {allowCustom && (
        <div className="mt-2 flex max-w-sm gap-2">
          <input
            value={custom}
            placeholder="Add another..."
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            className={inputClass}
          />
          <button type="button" onClick={addCustom} className="rounded-full bg-black/[0.05] px-4 text-sm font-medium transition hover:bg-black/[0.08]">
            Add
          </button>
        </div>
      )}
    </fieldset>
  );
}

/** Month + year dropdowns. Emits "YYYY-MM" only once both are chosen. */
export function MonthYearField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [my, setMy] = useState<MonthYear>(() => parseMonthYear(value));
  // Follow outside changes (e.g. the saved profile finishing loading).
  useEffect(() => {
    const parsed = parseMonthYear(value);
    if (formatMonthYear(parsed) !== formatMonthYear(my) && (parsed.month || parsed.year)) setMy(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: MonthYear) => {
    setMy(next);
    onChange(formatMonthYear(next));
  };
  return (
    <div className="block text-sm">
      <span className="mb-1.5 block text-[13px] font-medium text-black/60">{label}</span>
      <div className="flex gap-2">
        <select
          aria-label={`${label} month`}
          value={my.month ?? ""}
          onChange={(e) => update({ ...my, month: e.target.value ? Number(e.target.value) : null })}
          className={inputClass}
        >
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} year`}
          value={my.year ?? ""}
          onChange={(e) => update({ ...my, year: e.target.value ? Number(e.target.value) : null })}
          className={inputClass}
        >
          <option value="">Year</option>
          {yearChoices(new Date(), my.year).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Quick start-date choices, with a date picker when "Specific date" is chosen. */
export function StartDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [pickDate, setPickDate] = useState(false);
  const isCustom = pickDate || (value !== "" && !START_PRESETS.includes(value));
  return (
    <div className="block text-sm">
      <span className="mb-1.5 block text-[13px] font-medium text-black/60">{label}</span>
      <div className="flex gap-2">
        <select
          aria-label={label}
          value={isCustom ? "__date" : value}
          onChange={(e) => {
            if (e.target.value === "__date") {
              setPickDate(true);
              if (START_PRESETS.includes(value)) onChange("");
            } else {
              setPickDate(false);
              onChange(e.target.value);
            }
          }}
          className={inputClass}
        >
          <option value="">Not set</option>
          {START_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="__date">Specific date...</option>
        </select>
        {isCustom && (
          <input
            type="date"
            aria-label={`${label} date`}
            value={START_PRESETS.includes(value) ? "" : value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        )}
      </div>
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-black/30"
      />
      <span>{label}</span>
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[13px] font-medium text-black/60">{label}</span>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </label>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Stack of open modals, innermost last. */
const openModals: symbol[] = [];

export function Modal({
  title,
  onClose,
  children,
  size = "lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "sm" | "lg";
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    // Only the topmost open modal reacts to Escape and Tab, so closing Outreach doesn't also close
    // the application form underneath it.
    const id = Symbol();
    openModals.push(id);
    const isTop = () => openModals[openModals.length - 1] === id;
    // Keyboard focus moves into the dialog, stays inside it, and goes back where it was on close.
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
      previous?.focus?.();
    };
  }, []);
  // Portal to <body>: a modal opened from inside another modal (Outreach/Tailor from the
  // application form) would otherwise be trapped by the parent's transform/backdrop-filter, which
  // turns `position: fixed` into "fixed to the parent" and renders it clipped and offset.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || !panelRef.current) return;
    // Focus the dialog itself unless something inside already took focus (e.g. an autoFocus field).
    if (!panelRef.current.contains(document.activeElement)) panelRef.current.focus();
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div
      className={`animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overflow-x-hidden overscroll-contain bg-black/40 backdrop-blur-md ${
        size === "sm" ? "px-4" : "px-0 sm:px-4"
      }`}
      onMouseDown={onClose}
    >
      {/* Below the sm breakpoint a large dialog fills the screen (no margins, no rounded corners);
          small confirm dialogs stay a centered card, which already fits a 375px phone. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`animate-modal-in w-full min-w-0 bg-white shadow-card outline-none ${
          size === "sm" ? "my-10 max-w-md rounded-[28px]" : "min-h-full max-w-3xl sm:my-10 sm:min-h-0 sm:rounded-[28px]"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-transparent bg-white pb-3 pt-6 ${
            size === "sm" ? "rounded-t-[28px] px-7" : "px-5 sm:rounded-t-[28px] sm:px-7"
          }`}
        >
          <h2 id={titleId} className="min-w-0 break-words text-[22px] font-semibold leading-tight tracking-display sm:text-[24px]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-muted transition hover:bg-black/10 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className={size === "sm" ? "px-7 pb-7 pt-3" : "px-5 pb-7 pt-3 sm:px-7"}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  /** "danger": solid, for the final "Delete" in a confirm. "danger-quiet": red text, for list actions. */
  variant?: "primary" | "secondary" | "danger" | "danger-quiet";
  disabled?: boolean;
}) {
  const style =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-deep"
      : variant === "danger"
        ? "bg-bad text-white hover:brightness-95"
        : variant === "danger-quiet"
          ? "text-bad hover:bg-bad-soft"
        : "bg-black/[0.05] text-ink hover:bg-black/[0.08]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-[18px] py-2 text-[14px] font-medium transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 ${style}`}
    >
      {children}
    </button>
  );
}

/** A small inline loading spinner. Use it instead of a blank flash while a Dexie query resolves. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-muted" role="status">
      <svg className="h-4 w-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {label ?? "Loading..."}
    </div>
  );
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return <p className="mt-4 text-xs text-muted">Changes save automatically on this device.</p>;
  return (
    <p className={`mt-4 text-xs ${status === "saved" ? "text-good" : "text-muted"}`} aria-live="polite">
      {status === "saved" ? "Saved on this device." : "Saving..."}
    </p>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: React.ReactNode }) {
  const style = {
    ok: "bg-good-soft text-good",
    error: "bg-bad-soft text-bad",
    info: "bg-black/[0.035] text-black/70",
  }[kind];
  return <p className={`mt-3 rounded-2xl px-4 py-3 text-sm leading-relaxed ${style}`}>{children}</p>;
}

/** Load an async record once and hold an editable copy in state. */
export function useDraft<T>(load: () => Promise<T>) {
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((v) => alive && setDraft(v));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [draft, setDraft] as const;
}

/** An in-app "are you sure?" (never window.confirm, which freezes the page and looks out of place). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel} size="sm">
      <div className="text-[15px] leading-relaxed text-muted">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/** Small "opens in a new tab" arrow for external links (an SVG, not a text glyph). */
export function ExternalLinkIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`inline-block shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}
