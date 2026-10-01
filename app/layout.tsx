import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import ExtensionBridge from "@/components/ExtensionBridge";
import { ScrollToHash } from "@/components/settings/SettingsNav";
import { FEATURES } from "@/lib/features";
import Nav from "@/components/Nav";
import StoragePersist from "@/components/StoragePersist";
import "./globals.css";

// next/font downloads Inter at build time and serves it from this site, so no external font
// request is made at runtime (the CSP allows only 'self' and api.anthropic.com).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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
    <html lang="en" className={inter.variable}>
      <body>
        <StoragePersist />
        {/* Off in the public build: the bridge posts the key, Profile and resume via
            window.postMessage (see lib/features.ts). Covered by lib/features.test.ts. */}
        {FEATURES.extension && <ExtensionBridge />}
        <ScrollToHash />
        <Nav />
        <main className="mx-auto max-w-[1080px] px-4 pb-24 pt-12 sm:px-6">{children}</main>
        <footer className="border-t border-black/[0.06] px-4 py-6 text-center text-xs text-muted">
          Your data stays in this browser. The app never submits an application for you.{" "}
          <Link href="/privacy" className="underline hover:text-ink">
            Privacy
          </Link>
        </footer>
      </body>
    </html>
  );
}
