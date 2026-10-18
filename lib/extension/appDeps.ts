import { storeCapturedJob } from "../extensionCapture";
import { saveAnswerFromExtension } from "./answers";
import { buildSyncedData } from "./payload";
import { addDraftRequest } from "./hub";
import type { HandlerDeps } from "./handlers";

/** The real collaborators for lib/extension/handlers.ts. */
export function appHandlerDeps(): HandlerDeps {
  return {
    buildData: () => buildSyncedData(),
    storeCapture(capture) {
      storeCapturedJob(capture);
      // The Add job dialog lives on the home page.
      if (typeof window !== "undefined" && window.location.pathname !== "/") window.location.assign("/");
    },
    showDraft: addDraftRequest,
    getResume: async (jobId) => (await import("./resumeFile")).resumeForJob(jobId),
    saveAnswer: saveAnswerFromExtension,
    async markApplied() {
      throw new Error("Marking jobs applied from the extension isn't available yet.");
    },
  };
}
