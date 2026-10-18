// The pairing confirmation window, opened by the background when the app asks to connect. Only her
// click here issues a pairing token; the details shown come from the background's stored request,
// not from the URL, so a crafted link can't fake one.
import type { PendingPair } from "./lib/bridgeCore";

const $ = (id: string) => document.getElementById(id)!;

async function main(): Promise<void> {
  const pending = (await chrome.runtime.sendMessage({ type: "GET_PENDING_PAIR" })) as PendingPair | null;
  if (!pending) {
    $("ask").style.display = "none";
    finish("This request has expired. Click Connect in Job Copilot again.");
    return;
  }
  $("origin").textContent = pending.origin;
  $("code").textContent = `${pending.code.slice(0, 3)} ${pending.code.slice(3)}`;
  const decide = async (allow: boolean) => {
    const res = (await chrome.runtime.sendMessage({ type: "PAIR_DECISION", code: pending.code, allow })) as { ok: boolean };
    $("ask").style.display = "none";
    finish(res.ok ? (allow ? "Connected. You can close this window." : "Not connected.") : "This request has expired. Try again from the app.");
    if (res.ok) setTimeout(() => window.close(), 1500);
  };
  $("allow").addEventListener("click", () => void decide(true));
  $("deny").addEventListener("click", () => void decide(false));
}

function finish(text: string): void {
  const done = $("done");
  done.textContent = text;
  done.style.display = "block";
}

void main();
