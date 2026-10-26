/** "Fernhill Systems" -> "Fernhill Systems'", "Acme" -> "Acme's". */
export function possessive(name: string): string {
  const n = name.trim();
  if (!n) return n;
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}
