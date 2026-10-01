import type { Metadata } from "next";
import DemoView from "./DemoView";

export const metadata: Metadata = { title: "Demo account", robots: { index: false } };

export default function DemoPage() {
  return <DemoView />;
}
