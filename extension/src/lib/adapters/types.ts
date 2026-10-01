export interface AtsAdapter {
  name: string;
  /** True if this adapter recognizes the current page (by hostname, usually). */
  matches(location: Location): boolean;
  /** The element to scope form-field scanning to. Falls back to the whole document when null. */
  findFormRoot(doc: Document): ParentNode | null;
  /** The resume upload <input type="file">, if this ATS has one visible. */
  findResumeInput(doc: Document): HTMLInputElement | null;
}
