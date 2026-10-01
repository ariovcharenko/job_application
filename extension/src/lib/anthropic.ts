// Minimal, dependency-free Anthropic client for the extension context — same browser-direct
// pattern the app uses (lib/ai/anthropic.ts), reimplemented without the SDK to keep the content
// script bundle small. Used only to draft free-text application answers; nothing is ever inserted
// without her clicking to approve it (see content/capture.ts).

export async function draftFreeTextAnswer(apiKey: string, model: string, question: string, context: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system:
        "You draft a short, honest answer to a job application question, using only the background given. Never invent facts, employers, dates or metrics not present in the background. 3-6 sentences unless the question clearly wants a list.",
      messages: [
        {
          role: "user",
          content: `Application question: "${question}"\n\nHer background and the page's visible text (for context on the role):\n"""\n${context.slice(0, 6000)}\n"""`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}
