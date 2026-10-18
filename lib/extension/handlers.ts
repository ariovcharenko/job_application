import type { DraftRequest, RequestMethod, Requests, SyncedData } from "./protocol";

// What the app does when the (paired) extension asks for something. Each method is small and takes
// its collaborators as `deps`, so it is tested without a browser or a real database where it can be.

export interface HandlerDeps {
  buildData(): Promise<SyncedData>;
  /** "Score this job": opens the Add job dialog with the page's text. */
  storeCapture(capture: { text: string; url: string }): void;
  /** Shows a draft request (she decides to spend on it, and approves the text, in the app). */
  showDraft(request: DraftRequest): void;
  getResume(jobId: number | null): Promise<Requests["getResume"]["result"]>;
  saveAnswer(question: string, answer: string): Promise<Requests["saveAnswer"]["result"]>;
  markApplied(params: Requests["markApplied"]["params"]): Promise<Requests["markApplied"]["result"]>;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function handleRequest(method: RequestMethod, params: unknown, deps: HandlerDeps): Promise<unknown> {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case "sync":
      return deps.buildData();
    case "capturedJob": {
      const text = str(p.text, 200_000);
      if (text.length < 50) throw new Error("The page had no readable text.");
      deps.storeCapture({ text, url: str(p.url, 2000) });
      return { ok: true };
    }
    case "draftRequest": {
      const requestId = str(p.requestId, 64);
      const question = str(p.question, 1000).trim();
      if (!requestId || !question) throw new Error("Missing question.");
      deps.showDraft({ requestId, question, jobText: str(p.jobText, 8000), pageUrl: str(p.pageUrl, 2000), jobId: typeof p.jobId === "number" ? p.jobId : null });
      return { shown: true };
    }
    case "getResume":
      return deps.getResume(typeof p.jobId === "number" ? p.jobId : null);
    case "saveAnswer": {
      const question = str(p.question, 500).trim();
      const answer = str(p.answer, 5000).trim();
      if (!question || !answer) throw new Error("Nothing to save.");
      return deps.saveAnswer(question, answer);
    }
    case "markApplied":
      return deps.markApplied({
        jobId: typeof p.jobId === "number" ? p.jobId : null,
        url: str(p.url, 2000),
        company: str(p.company, 200),
        role: str(p.role, 300),
        fillSeconds: typeof p.fillSeconds === "number" && p.fillSeconds >= 0 ? Math.round(p.fillSeconds) : undefined,
      });
    default:
      throw new Error("Unknown request.");
  }
}
