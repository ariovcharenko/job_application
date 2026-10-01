"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { slugify } from "@/components/ui";

/** Sticky in-page menu for the long Settings page; highlights the section currently in view. */
export default function SettingsNav({ sections }: { sections: string[] }) {
  const [active, setActive] = useState(slugify(sections[0]));

  useEffect(() => {
    // A scroll check rather than an IntersectionObserver: the cards render only after their data
    // loads from IndexedDB, so they may not exist yet when this first runs.
    const onScroll = () => {
      let current = slugify(sections[0]);
      for (const s of sections) {
        const el = document.getElementById(slugify(s));
        if (el && el.getBoundingClientRect().top <= 140) current = el.id;
      }
      // At the very bottom the last short sections can never reach the top; pick the last one.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = slugify(sections[sections.length - 1]);
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  return (
    <nav aria-label="Settings sections" className="hidden lg:block">
      <ul className="sticky top-24 grid gap-0.5 text-sm">
        {sections.map((s) => {
          const id = slugify(s);
          const on = active === id;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                className={`block rounded-lg px-3 py-1.5 transition ${
                  on ? "bg-white font-medium text-ink shadow-soft" : "text-muted hover:text-ink"
                }`}
              >
                {s}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Scrolls to the URL's #anchor once that element exists. Settings and Resumes cards render only
 * after their data loads from IndexedDB, so the browser's own jump to "/settings#profile" (the
 * setup checklist's links) usually fires before the card is there. Mounted once in the layout.
 */
export function ScrollToHash() {
  const pathname = usePathname();
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
      if (++tries < 30) timer = setTimeout(attempt, 100);
    };
    const start = () => {
      tries = 0;
      clearTimeout(timer);
      attempt();
    };
    start();
    window.addEventListener("hashchange", start);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", start);
    };
  }, [pathname]);
  return null;
}
