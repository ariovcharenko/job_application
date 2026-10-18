import { isBlockedHost, isKnownAtsHost, originPatternFor } from "./lib/hosts";
import { APP_ORIGINS } from "./protocol";

interface PopupStatus {
  paired: string[];
  connected: boolean;
  appOrigin: string;
  updatedAt: number;
  jobs: number;
  hasProfile: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const originSelect = $<HTMLSelectElement>("origin");
const status = $<HTMLDivElement>("status");

function setStatus(html: [string, string][]): void {
  status.textContent = "";
  for (const [cls, text] of html) {
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text;
    status.appendChild(span);
  }
}

async function refresh(): Promise<void> {
  const s = (await chrome.runtime.sendMessage({ type: "POPUP_STATUS" })) as PopupStatus | null;
  originSelect.textContent = "";
  for (const o of APP_ORIGINS) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o.replace(/^https?:\/\//, "") + (s?.paired.includes(o) ? " (connected)" : "");
    originSelect.appendChild(opt);
  }
  if (s) originSelect.value = s.appOrigin;
  if (!s || s.paired.length === 0) {
    setStatus([["warn", "Not connected. "], ["", "Open Job Copilot, go to Settings > Chrome extension and click Connect."]]);
    return;
  }
  const when = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "never";
  setStatus([
    ["ok", "Connected. "],
    ["", `${s.hasProfile ? "Profile synced" : "No profile yet"}, ${s.jobs} job(s). Last sync ${when}.`],
  ]);
}

async function refreshSite(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const enable = $<HTMLButtonElement>("enable");
  const disable = $<HTMLButtonElement>("disable");
  const siteStatus = $<HTMLDivElement>("siteStatus");
  enable.style.display = disable.style.display = "none";
  if (!tab?.url) {
    siteStatus.textContent = "No page open.";
    return;
  }
  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch {
    /* not a web page */
  }
  const pattern = originPatternFor(tab.url);
  if (host && isBlockedHost(host)) {
    siteStatus.textContent = "Job Copilot never runs on LinkedIn, Indeed or Jobright.";
    return;
  }
  if (!pattern) {
    siteStatus.textContent = "Not a web page.";
    return;
  }
  if (isKnownAtsHost(host)) {
    siteStatus.textContent = "On by default here (a known application system).";
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  siteStatus.textContent = granted ? `On for ${host}.` : `Off for ${host}. Turn it on to fill this site's forms.`;
  (granted ? disable : enable).style.display = "block";
  enable.onclick = async () => {
    // Asks Chrome for this one site only (shown to her by Chrome's own prompt).
    const ok = await chrome.permissions.request({ origins: [pattern] });
    if (ok) await chrome.runtime.sendMessage({ type: "SITE_ENABLED", pattern, tabId: tab.id });
    await refreshSite();
  };
  disable.onclick = async () => {
    await chrome.runtime.sendMessage({ type: "SITE_DISABLED", pattern });
    await refreshSite();
  };
}

originSelect.addEventListener("change", () => void chrome.runtime.sendMessage({ type: "SET_APP_ORIGIN", origin: originSelect.value }));
$<HTMLButtonElement>("open").addEventListener("click", () => {
  void chrome.tabs.create({ url: `${originSelect.value}/settings#chrome-extension` });
  window.close();
});

void refresh();
void refreshSite();
