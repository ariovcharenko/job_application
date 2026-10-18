import { useId } from "react";
import { logoSvg } from "@/lib/brand";

/**
 * The app's logo tile, drawn from lib/brand.ts. Decorative: the visible or sr-only "Job Copilot"
 * next to it names the link. "small" (one arc and the pin, pixel-snapped) suits 32px and below,
 * such as the 24px nav mark; "detailed" (two open arcs and the pin) is for 48px and up.
 */
export default function LogoMark({ className = "h-6 w-6", variant = "small" }: { className?: string; variant?: "small" | "detailed" }) {
  const id = `logo-${useId().replace(/:/g, "")}`;
  // Our own static markup from lib/brand.ts (no user input), so it is safe to inject.
  const svg = logoSvg(variant, { id }).replace("<svg ", `<svg aria-hidden="true" class="${className}" `);
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />;
}
