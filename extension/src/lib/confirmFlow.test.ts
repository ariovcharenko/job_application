import { describe, expect, it, vi } from "vitest";
import { watchForConfirmation, type ConfirmDeps } from "./confirmFlow";
import type { FillSession } from "../messages";

const session: FillSession = { jobId: 3, url: "https://boards.greenhouse.io/x/jobs/1", company: "Brightloop", role: "Backend Engineer", startedAt: 1 };
const setPage = (html: string) => (document.documentElement.innerHTML = `<head></head><body>${html}</body>`);

function deps(over: Partial<ConfirmDeps> = {}) {
  const d = {
    doc: document,
    location: { pathname: "/x" },
    adapterName: "greenhouse",
    getSession: vi.fn(async () => session as FillSession | null),
    seen: vi.fn(async () => undefined),
    onOffer: vi.fn(),
    debounceMs: 10,
    ...over,
  };
  return d;
}

describe("watchForConfirmation", () => {
  it("offers once when the page already is a confirmation, and stops the fill clock", async () => {
    setPage(`<h1>Thank you for applying</h1>`);
    const d = deps();
    const w = watchForConfirmation(d);
    await vi.waitFor(() => expect(d.onOffer).toHaveBeenCalledWith(session));
    expect(d.seen).toHaveBeenCalledOnce();
    document.body.appendChild(document.createElement("p"));
    await new Promise((r) => setTimeout(r, 40));
    expect(d.onOffer).toHaveBeenCalledOnce();
    w.stop();
  });

  it("offers when the message appears in place after the form goes away (single-page apps)", async () => {
    setPage(`<form><input type="text" /></form>`);
    const d = deps();
    const w = watchForConfirmation(d);
    await new Promise((r) => setTimeout(r, 40));
    expect(d.onOffer).not.toHaveBeenCalled();
    document.body.innerHTML = `<h1>Application submitted</h1>`;
    await vi.waitFor(() => expect(d.onOffer).toHaveBeenCalledOnce());
    w.stop();
  });

  it("stays quiet on an unknown site unless she used Fill in this tab", async () => {
    setPage(`<h1>Thank you for applying</h1>`);
    const d = deps({ adapterName: "generic", getSession: vi.fn(async () => null) });
    const w = watchForConfirmation(d);
    await new Promise((r) => setTimeout(r, 50));
    expect(d.onOffer).not.toHaveBeenCalled();
    expect(d.seen).not.toHaveBeenCalled();
    w.stop();
    const d2 = deps({ adapterName: "generic" });
    const w2 = watchForConfirmation(d2);
    await vi.waitFor(() => expect(d2.onOffer).toHaveBeenCalledOnce());
    w2.stop();
  });

  it("does not offer on a known ATS page that isn't a confirmation, or on an account page", async () => {
    setPage(`<h1>Backend Engineer</h1><input type="text" />`);
    const d = deps();
    const w = watchForConfirmation(d);
    await new Promise((r) => setTimeout(r, 40));
    w.stop();
    setPage(`<h1>Thank you for applying</h1><input type="password" />`);
    const d2 = deps();
    const w2 = watchForConfirmation(d2);
    await new Promise((r) => setTimeout(r, 40));
    w2.stop();
    expect(d.onOffer).not.toHaveBeenCalled();
    expect(d2.onOffer).not.toHaveBeenCalled();
  });

  it("offers on a known ATS even with no Fill session (she filled it herself)", async () => {
    setPage(`<h1>Thanks for applying</h1>`);
    const d = deps({ getSession: vi.fn(async () => null) });
    const w = watchForConfirmation(d);
    await vi.waitFor(() => expect(d.onOffer).toHaveBeenCalledWith(null));
    w.stop();
  });
});
