const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function base64ToFile(base64: string, fileName: string, mimeType = DOCX_MIME): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType });
}

/** Populates a file input the way a real drag-and-drop or file-picker selection would, via
 * DataTransfer — the standard, well-supported technique for scripting a file input in Chrome
 * (a plain `input.files = ...` assignment is read-only and won't work). */
export function setFileInput(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
