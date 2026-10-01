import { ImageResponse } from "next/og";

// The link preview image. Rendered once at build time (static), with next/og's bundled default
// font: no external fonts, images or network requests. Brand gradient only on the logo mark and
// the hero phrase, the same as the site.

export const alt = "Job Copilot: apply to the jobs worth it";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

const GRADIENT = "linear-gradient(90deg, #0071E3 0%, #7B61FF 55%, #C850C0 100%)";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          background: "#F5F5F7",
          color: "#1D1D1F",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, #2997FF 0%, #7B61FF 50%, #C850C0 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="44" height="44" viewBox="0 0 32 32">
              <path d="M9 16.5L14 21.5L23 11" stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <div style={{ fontSize: 40, fontWeight: 600 }}>Job Copilot</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 56, fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
          <span style={{ marginRight: 22 }}>Apply to the jobs</span>
          <span style={{ backgroundImage: GRADIENT, backgroundClip: "text", color: "transparent" }}>worth it.</span>
        </div>
        <div style={{ marginTop: 36, fontSize: 32, lineHeight: 1.35, color: "#6E6E73", maxWidth: 940 }}>
          Check if a tech job fits you, tailor your resume from your real experience, and track applications. Runs in your browser
          with your own Claude API key.
        </div>
      </div>
    ),
    size,
  );
}
