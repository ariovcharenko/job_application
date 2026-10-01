"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ANYWHERE_US, REMOTE_US, choiceFromText, choiceLabel } from "@/lib/geo/choices";
import { getGeo, loadGeo, type GeoIndex } from "@/lib/geo/index";
import { searchPlaces, type PlaceKind } from "@/lib/geo/search";
import { inputClass } from "@/components/ui";

// Location type-ahead (ARIA combobox): pick metros, cities and states, plus the pinned "Remote
// (US)" and "Anywhere in the US". Chosen places show as removable chips. Free text is accepted only
// as "City, ST" with a real state. The place data loads lazily on first render.

type Group = "pinned" | PlaceKind | "custom";

interface Option {
  id: string;
  group: Group;
  label: string;
  detail?: string;
}

const GROUP_LABEL: Record<Group, string> = {
  pinned: "Quick picks",
  metro: "Metro areas",
  city: "Cities",
  state: "States",
  custom: "Add your own",
};
const GROUP_ORDER: Group[] = ["pinned", "metro", "city", "state", "custom"];

const PINNED: Option[] = [
  { id: REMOTE_US, group: "pinned", label: "Remote (US)", detail: "Remote jobs open to people in the US" },
  { id: ANYWHERE_US, group: "pinned", label: "Anywhere in the US", detail: "Hybrid and on-site jobs in any state" },
];

export interface LocationPickerProps {
  /** Location choice ids (Preferences.locations). */
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
}

export default function LocationPicker({ value, onChange, label = "Locations", hint, placeholder = "City, metro area or state" }: LocationPickerProps) {
  const [geo, setGeo] = useState<GeoIndex | null>(getGeo());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const labelId = `${baseId}-label`;
  const hintId = `${baseId}-hint`;

  useEffect(() => {
    if (!geo) void loadGeo().then(setGeo);
  }, [geo]);

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const pinned = PINNED.filter((o) => !value.includes(o.id) && (!q || o.label.toLowerCase().includes(q)));
    if (!geo || !q) return pinned;
    const found = searchPlaces(query, geo)
      .filter((s) => !value.includes(s.id))
      .map((s): Option => ({ id: s.id, group: s.kind, label: s.label, detail: s.detail }));
    const custom = choiceFromText(query, geo);
    const extra: Option[] =
      custom && !value.includes(custom) && !found.some((f) => f.id === custom) ? [{ id: custom, group: "custom", label: choiceLabel(custom, geo), detail: "A city not in our list" }] : [];
    const all = [...pinned, ...found, ...extra];
    return GROUP_ORDER.flatMap((g) => all.filter((o) => o.group === g));
  }, [query, geo, value]);

  useEffect(() => setActive(0), [query]);

  const add = (id: string) => {
    if (!value.includes(id)) onChange([...value, id]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };
  const remove = (id: string) => onChange(value.filter((v) => v !== id));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setActive(Math.max(options.length - 1, 0));
    } else if (e.key === "Enter") {
      if (open && options[active]) {
        e.preventDefault();
        add(options[active].id);
      } else if (geo && query.trim()) {
        const custom = choiceFromText(query, geo);
        e.preventDefault();
        if (custom) add(custom);
      }
    } else if (e.key === "Escape") {
      // Close the list first; a second Escape reaches the dialog around it.
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (query) {
        e.stopPropagation();
        setQuery("");
      }
    } else if (e.key === "Backspace" && !query && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const showList = open && options.length > 0;
  const activeId = showList && options[active] ? `${baseId}-opt-${active}` : undefined;
  const noMatch = open && query.trim().length > 1 && geo && options.length === 0;

  let index = -1;
  return (
    <div className="text-sm">
      <span id={labelId} className="mb-1.5 block text-[13px] font-medium text-black/60">
        {label}
      </span>
      {hint && (
        <p id={hintId} className="mb-2.5 text-xs text-muted">
          {hint}
        </p>
      )}
      {value.length > 0 && (
        <ul className="mb-2.5 flex flex-wrap gap-2" aria-label={`Chosen ${label.toLowerCase()}`}>
          {value.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={`Remove ${choiceLabel(id, geo)}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent bg-accent-soft py-1.5 pl-3.5 pr-2.5 text-[13px] font-medium text-accent-deep transition hover:bg-accent-soft/60"
              >
                <span className="truncate">{choiceLabel(id, geo)}</span>
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={inputClass}
        />
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          hidden={!showList}
          // Keep focus in the input while clicking an option.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-20 mt-1.5 max-h-80 overflow-y-auto rounded-2xl border border-black/[0.08] bg-white p-1.5 shadow-lift"
        >
          {GROUP_ORDER.map((g) => {
            const items = options.filter((o) => o.group === g);
            if (!items.length) return null;
            const groupId = `${baseId}-g-${g}`;
            return (
              <li key={g} role="presentation">
                <div id={groupId} role="presentation" className="px-3 pb-1 pt-2 text-xs font-medium text-muted">
                  {GROUP_LABEL[g]}
                </div>
                <ul role="group" aria-labelledby={groupId}>
                  {items.map((o) => {
                    index += 1;
                    const i = index;
                    const isActive = i === active;
                    return (
                      <li
                        key={o.id}
                        id={`${baseId}-opt-${i}`}
                        role="option"
                        aria-selected={isActive}
                        onClick={() => add(o.id)}
                        onMouseEnter={() => setActive(i)}
                        className={`flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 rounded-xl px-3 py-2 ${isActive ? "bg-accent-soft text-accent-deep" : "text-ink"}`}
                      >
                        <span className="font-medium">{o.label}</span>
                        {o.detail && <span className={`text-xs ${isActive ? "text-accent-deep" : "text-muted"}`}>{o.detail}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {showList ? `${options.length} suggestion${options.length === 1 ? "" : "s"}` : ""}
      </p>
      {noMatch && <p className="mt-2 text-xs text-muted">No matching place. Type a city as &quot;City, ST&quot;, for example &quot;Boise, ID&quot;.</p>}
    </div>
  );
}
