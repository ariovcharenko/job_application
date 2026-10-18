import type { Metadata, Viewport } from "next";
import Link from "next/link";
import ExtensionBridge from "@/components/ExtensionBridge";
import { ScrollToHash } from "@/components/settings/SettingsNav";
import { FEATURES } from "@/lib/features";
import Nav from "@/components/Nav";
import StoragePersist from "@/components/StoragePersist";
import AutoBackupRunner from "@/components/AutoBackupRunner";
import "@fontsource-variable/inter";
import "./globals.css";

// Inter is bundled from npm (@fontsource-variable/inter) and served from this site, so no font
// request leaves it (the CSP allows only 'self' and api.anthropic.com). Not next/font/google: on
// Vercel its two build passes could fetch different files from Google, so the page's class and
// the CSS disagreed, --font-inter was undefined and every page fell back to Times.

// Not exported: a layout may only export Next's own names (metadata, viewport...).
const SITE_DESCRIPTION =
  "Check if a tech job fits you, tailor your resume from your real experience, and track applications. Runs in your browser with your own Claude API key.";

// Absolute URLs for the link preview image. Vercel sets these at build time; locally Next falls
// back to localhost.
const SITE_HOST = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

export const metadata: Metadata = {
  ...(SITE_HOST ? { metadataBase: new URL(`https://${SITE_HOST}`) } : {}),
  title: { default: "Job Copilot", template: "%s · Job Copilot" },
  description: SITE_DESCRIPTION,
  applicationName: "Job Copilot",
  openGraph: {
    title: "Job Copilot",
    description: SITE_DESCRIPTION,
    type: "website",
    siteName: "Job Copilot",
  },
  twitter: { card: "summary_large_image", title: "Job Copilot", description: SITE_DESCRIPTION },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#F5F5F7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <StoragePersist />
        <AutoBackupRunner />
        {/* Point-to-point link to the paired Chrome extension (see lib/features.ts). Does nothing
            without an installed extension and a pairing. Covered by components/ExtensionBridge.test.ts. */}
        {FEATURES.extension && <ExtensionBridge />}
        <ScrollToHash />
        <Nav />
        <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 pb-24 pt-12 sm:px-6">{children}</main>
        <footer className="border-t border-black/[0.06] px-4 py-6 text-center text-xs text-muted">
          Your data stays in this browser. Nothing is ever submitted for you.{" "}
          <Link href="/privacy" className="underline hover:text-ink">
            Privacy
          </Link>
        </footer>
      </body>
    </html>
  );
}
