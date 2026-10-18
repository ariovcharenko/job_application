"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui";

/**
 * For a dialog holding a TailorPanel: while an AI call runs, closing it (the X, the backdrop,
 * Escape, Done) asks first instead of closing at once. Closing anyway doesn't stop the call: its
 * result is saved to the job when it arrives (TailorPanel persistNow). Her Cancel inside the panel
 * is what stops a call.
 */
export function useCloseGuard(onClose: () => void) {
  const busyRef = useRef(false);
  const [asking, setAsking] = useState(false);
  const requestClose = () => {
    if (busyRef.current) setAsking(true);
    else onClose();
  };
  const setBusy = (busy: boolean) => {
    busyRef.current = busy;
  };
  const confirm = asking ? (
    <ConfirmDialog
      title="Close while it's working?"
      message="Your resume is still being written. If you close now, it keeps going and is saved to this job when it's done, so nothing you paid for is lost. To stop it instead, stay and press Cancel."
      confirmLabel="Close"
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        onClose();
      }}
    />
  ) : null;
  return { requestClose, setBusy, confirm };
}
