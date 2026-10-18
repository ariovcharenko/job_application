import { logoSvg, type LogoTheme } from "@/lib/brand";

/**
 * The app's logo tile, drawn from lib/brand.ts. Decorative: the visible or sr-only "Job Copilot"
 * next to it names the link. "small" (pixel-snapped, heavier) suits 32px and below, such as the
 * 24px nav mark; "detailed" (optically centered) is for 48px and up. `theme` picks one of the solid
 * color treatments in LOGO_THEMES (default: purple tile, white glyph).
 */
export default function LogoMark({
  className = "h-6 w-6",
  variant = "small",
  theme,
}: {
  className?: string;
  variant?: "small" | "detailed";
  theme?: LogoTheme;
}) {
  // Our own static markup from lib/brand.ts (no user input), so it is safe to inject.
  const svg = logoSvg(variant, { theme }).replace("<svg ", `<svg aria-hidden="true" class="${className}" `);
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />;
}
