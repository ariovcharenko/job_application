import { getAppOrigin, getSyncedData, setAppOrigin } from "./lib/storage";

const originInput = document.getElementById("origin") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

async function refreshStatus(): Promise<void> {
  const data = await getSyncedData();
  if (data.profile.fullName || data.answerBank.length > 0) {
    const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "just now";
    status.innerHTML = `<span class="ok">Synced</span> — last updated ${when}`;
  } else {
    status.innerHTML = `<span class="warn">Not synced yet</span> — open the app URL below once so it can send your profile.`;
  }
}

getAppOrigin().then((origin) => (originInput.value = origin));
refreshStatus();

saveBtn.addEventListener("click", async () => {
  const origin = originInput.value.trim();
  if (!origin) return;
  await setAppOrigin(origin);
  window.open(origin, "_blank");
  window.close();
});
