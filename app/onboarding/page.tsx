import type { Metadata } from "next";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

export const metadata: Metadata = { title: "Get set up" };

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
