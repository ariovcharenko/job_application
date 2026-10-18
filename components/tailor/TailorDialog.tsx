"use client";

import type { Application } from "@/lib/types";
import { Modal } from "@/components/ui";
import TailorPanel from "./TailorPanel";
import { useCloseGuard } from "./useCloseGuard";

export { TAILOR_COST_HINT } from "@/lib/resume/costHint";

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
  const guard = useCloseGuard(onClose);
  return (
    <>
      <Modal title={`Resume${application.company ? ` for ${application.company}` : ""}`} onClose={guard.requestClose}>
        <TailorPanel
          application={application}
          autoStart={false}
          onBusyChange={guard.setBusy}
          onSaved={(id) => onSaved({ tailoredResumeId: id, triage: undefined, tailorDraft: undefined })}
        />
      </Modal>
      {guard.confirm}
    </>
  );
}
