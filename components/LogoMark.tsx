import { useId } from "react";
import { LOGO_ARROW, LOGO_DOT, LOGO_GRADIENT, LOGO_RING, LOGO_TILE_RADIUS } from "@/lib/brand";

/** The app's logo tile. Decorative: the visible or sr-only "Job Copilot" next to it names the link. */
export default function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  const id = `logo-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={LOGO_GRADIENT[0]} />
          <stop offset="0.5" stopColor={LOGO_GRADIENT[1]} />
          <stop offset="1" stopColor={LOGO_GRADIENT[2]} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx={LOGO_TILE_RADIUS} fill={`url(#${id})`} />
      <path d={LOGO_RING} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle {...LOGO_DOT} fill="#fff" />
      <path d={LOGO_ARROW} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
