import { getSettings } from "../db";
import { DEFAULT_OPENAI_MODEL } from "../options";
import type { AppSettings } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import { recordUsage } from "./usage";
import { AIError, type AIErrorKind, type AIProvider, type JsonOptions, type ProviderCapabilities, type ProviderId, type UsageReport } from "./provider";

// The one place that decides which company's model does which job. Writing (resumes and outreach
// messages) goes to OpenAI when she chose it; everything else stays on Claude: reading links needs
// Anthropic's web fetch tool, importing a PDF resume needs PDF input, and job analysis was tuned
// on Claude. When OpenAI writes and is out of credit or unreachable, the same call is retried once
// on Claude automatically (withWriterFallback below).
//
// To add a task: name it in AITask and put it in WRITER_TASKS if OpenAI may write it.
// Then call `await providerFor("your_task")` where the call is made.

export type AITask =
  /** Extract a posting's signals and skills (lib/scoring/signals.ts). */
  | "check_job"
  /** Read a job link with the web fetch tool. Needs webFetch. */
  | "read_link"
  /** Turn an uploaded resume (PDF) into her experience. Needs attachments. */
  | "import_resume"
  | "draft_outreach"
  /** First tailored draft (engine/index.ts generateResume). */
  | "write_resume"
  /** Her own change requests (engine/revise.ts). */
  | "revise_resume"
  /** The automatic follow-up pass after a draft (engine/pipeline.ts). */
  | "polish_resume"
  /** A recruiter-style review or rewrite of the resume text. */
  | "review_resume";

/** Resume tasks (the tailoring screen's spend line sums these). */
export const RESUME_WRITING_TASKS: readonly AITask[] = ["write_resume", "revise_resume", "polish_resume", "review_resume"];

/** Tasks the chosen writer ("Write resumes and messages with") does: resume writing plus outreach drafts. */
export const WRITER_TASKS: readonly AITask[] = [...RESUME_WRITING_TASKS, "draft_outreach"];

/** What each task needs beyond plain text and JSON. A provider without it never gets the task. */
const TASK_NEEDS: Partial<Record<AITask, keyof ProviderCapabilities>> = {
  read_link: "webFetch",
  import_resume: "attachments",
};

const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  anthropic: { attachments: true, webFetch: true },
  openai: { attachments: false, webFetch: false },
};

type RouteSettings = Pick<AppSettings, "anthropicKey" | "openaiKey" | "resumeWriter">;

const has = (key: string | undefined) => !!key?.trim();

/** Who writes resumes: her explicit choice, or OpenAI when "auto" and an OpenAI key is saved. */
export function resumeWriter(s: RouteSettings): ProviderId {
  const choice = s.resumeWriter ?? "auto";
  if (choice === "auto") return has(s.openaiKey) ? "openai" : "anthropic";
  return choice;
}

/**
 * Which provider a task uses. `override` ("use Claude for this run") wins for writing tasks.
 * Tasks that need a capability only Anthropic has always go to Anthropic.
 */
export function chooseProvider(task: AITask, s: RouteSettings, override?: ProviderId): ProviderId {
  const need = TASK_NEEDS[task];
  const pick: ProviderId = WRITER_TASKS.includes(task) ? (override ?? resumeWriter(s)) : "anthropic";
  if (need && !PROVIDER_CAPABILITIES[pick][need]) return "anthropic";
  return pick;
}

/**
 * Builds one provider from saved settings. Throws AIError("no_key") naming the provider when its
 * key is missing. Every response's tokens go to the local spend meter under `task`.
 */
export function buildProvider(id: ProviderId, s: AppSettings, task: AITask | "other" = "other"): AIProvider {
  const onUsage = (u: UsageReport) => void recordUsage(task, u);
  if (id === "openai") {
    if (!has(s.openaiKey)) {
      throw new AIError("no_key", "OpenAI is set to write your resumes and messages, but no OpenAI API key is saved. Add one, or use Claude for this run.", "openai");
    }
    return createOpenAIProvider({ apiKey: s.openaiKey!.trim(), model: s.openaiModel?.trim() || DEFAULT_OPENAI_MODEL, onUsage });
  }
  if (!has(s.anthropicKey)) {
    throw new AIError("no_key", "Add your Anthropic API key in Settings first.");
  }
  return createAnthropicProvider({
    apiKey: s.anthropicKey.trim(),
    workspaceId: s.workspaceId,
    fastModel: s.fastModel,
    smartModel: s.smartModel,
    onUsage,
  });
}

/** Why a call moved to Claude on its own. */
export type FallbackReason = "billing" | "unavailable";

export interface WriterFallback {
  reason: FallbackReason;
  /** The quiet line to show, e.g. "Written with Claude: OpenAI was out of credit." */
  message: string;
}

/**
 * Whether an OpenAI failure is one Claude should simply take over: out of credit, OpenAI down or
 * overloaded (5xx), rate-limited (429), or OpenAI unreachable. Never for a bad key, permission, an unknown model or a
 * rejected request (those need her to fix something, and keep the "fix key / use Claude" notice),
 * and never for her own Cancel.
 */
export function autoFallbackReason(err: unknown): FallbackReason | null {
  if (!(err instanceof AIError) || err.provider !== "openai") return null;
  if (err.kind === "billing") return "billing";
  // A plain rate limit (429 without the quota code) is fixed by switching providers too.
  if (err.kind === "overloaded" || err.kind === "network" || err.kind === "rate_limit") return "unavailable";
  return null;
}

/** The quiet notice. `kind` (the OpenAI error) picks "busy" for a rate limit. */
export function fallbackMessage(reason: FallbackReason, kind?: AIErrorKind): string {
  if (reason === "billing") return "Written with Claude: OpenAI was out of credit.";
  return kind === "rate_limit" ? "Written with Claude: OpenAI was busy." : "Written with Claude: OpenAI was unavailable.";
}

/**
 * Wraps the OpenAI writer so a call that fails for one of autoFallbackReason's reasons is run
 * again, once, on Claude. `fallback` builds the Claude provider (null when no Anthropic key is
 * saved: then the OpenAI error stands). Each provider logs its own usage, so spend is recorded
 * under whichever one actually answered.
 */
export function withWriterFallback(primary: AIProvider, fallback: () => AIProvider | null, onFallback?: (f: WriterFallback) => void): AIProvider {
  async function attempt<T>(run: (p: AIProvider) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await run(primary);
    } catch (err) {
      const reason = autoFallbackReason(err);
      if (!reason || signal?.aborted) throw err;
      const claude = fallback();
      if (!claude) throw err;
      const out = await run(claude);
      onFallback?.({ reason, message: fallbackMessage(reason, (err as AIError).kind) });
      return out;
    }
  }
  return {
    ...primary,
    complete: (opts) => attempt((p) => p.complete(opts), opts.signal),
    completeJson: <T,>(opts: JsonOptions<T>) => attempt((p) => p.completeJson<T>(opts), opts.signal),
  };
}

/**
 * The provider for a task, from saved settings. Pass `{ override: "anthropic" }` to use Claude for
 * one run. When OpenAI writes and an Anthropic key is saved, credit and outage failures move to
 * Claude on their own and `onFallback` is told (to show the quiet notice).
 */
export async function providerFor(
  task: AITask,
  opts: { override?: ProviderId; onFallback?: (f: WriterFallback) => void } = {},
): Promise<AIProvider> {
  const s = await getSettings();
  const id = chooseProvider(task, s, opts.override);
  const provider = buildProvider(id, s, task);
  if (id !== "openai" || !WRITER_TASKS.includes(task)) return provider;
  return withWriterFallback(provider, () => (has(s.anthropicKey) ? buildProvider("anthropic", s, task) : null), opts.onFallback);
}

/** True when this error means "OpenAI can't be used right now" and Claude could do this run instead. */
export function canFallBackToClaude(err: unknown): boolean {
  return err instanceof AIError && err.provider === "openai" && ["no_key", "auth", "billing", "permission", "bad_request"].includes(err.kind);
}
