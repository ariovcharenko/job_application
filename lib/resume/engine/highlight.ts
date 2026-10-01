// Finds a quote she commented on inside the preview's text, which is split across many DOM text
// nodes (a selection often spans a bold span). Pure offset math so it can be tested without a DOM;
// the component turns the result into a Range for the CSS Custom Highlight API.

export interface QuoteSpan {
  startNode: number;
  startOffset: number;
  endNode: number;
  endOffset: number;
}

/**
 * Where `quote` first appears in the concatenation of `texts`, as (node index, offset) pairs.
 * Whitespace is ignored on both sides: a browser selection's text (and innerText) puts line
 * breaks between blocks where the DOM has no whitespace text at all, and collapses runs of
 * spaces differently. Null if not found.
 */
export function findQuote(texts: string[], quote: string): QuoteSpan | null {
  const q = quote.replace(/\s+/g, "");
  if (!q) return null;
  // Build the text without whitespace while recording, for each character, the source node/offset.
  let flat = "";
  const map: { node: number; offset: number }[] = [];
  texts.forEach((t, node) => {
    for (let offset = 0; offset < t.length; offset++) {
      if (/\s/.test(t[offset])) continue;
      flat += t[offset];
      map.push({ node, offset });
    }
  });
  const at = flat.indexOf(q);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + q.length - 1];
  return { startNode: start.node, startOffset: start.offset, endNode: end.node, endOffset: end.offset + 1 };
}
