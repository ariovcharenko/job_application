/**
 * Saves a file from memory. The link is attached to the page and the object URL is revoked a bit
 * later: revoking it right after click() makes Safari (and sometimes Firefox) cancel the download,
 * which could leave her thinking a backup was saved when it wasn't.
 */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
