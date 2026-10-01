"use client";

import type { Application } from "@/lib/types";
import { Modal } from "@/components/ui";
import TailorPanel from "./TailorPanel";

export { TAILOR_COST_HINT } from "./TailorPanel";

/** "Tailor resume" from a tracker row: the master-profile engine, started on click. */
export default function TailorDialog({
  application,
  onClose,
  onSaved,
}: {
  application: Application & { id: number };
  onClose: () => void;
  onSaved: (patch: Partial<Application>) => void;
}) {
  return (
    <Modal title={`Resume${application.company ? ` for ${application.company}` : ""}`} onClose={onClose}>
      <TailorPanel application={application} autoStart={false} onSaved={(id) => onSaved({ tailoredResumeId: id, triage: undefined, tailorDraft: undefined })} />
    </Modal>
  );
}
