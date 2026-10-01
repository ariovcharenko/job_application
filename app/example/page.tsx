import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import ExampleView from "./ExampleView";

export const metadata: Metadata = {
  title: "Example",
  description: "See how Job Copilot checks a job and tailors a resume, with sample data. No key or sign-up needed.",
};

export default function ExamplePage() {
  return (
    <>
      <PageHeader title="See an example" subtitle="A sample job and a sample candidate, start to finish. Nothing here uses your data or an API key." />
      <ExampleView />
    </>
  );
}
