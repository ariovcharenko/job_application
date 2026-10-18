import { getSettings } from "../db";
import { DEFAULT_OPENAI_MODEL } from "../options";
import type { AppSettings } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import { recordUsage } from "./usage";
import { AIError, type AIProvider, type ProviderCapabilities, type ProviderId, type UsageReport } from "./provider";

// The one place that decides which company's model does which job. Only resume writing goes to
// OpenAI (when she chose it); everything else stays on Claude: reading links needs Anthropic's web
// fetch tool, importing a PDF resume needs PDF input, and job analysis was tuned on Claude.
//
// To add a task: name it in AITask and put it in RESUME_WRITING_TASKS if OpenAI may write it.
// Then call `await providerFor("your_task")` where the call is made.

export type AITask =
  /** Extract a posting's signals and skills (lib/scoring/signals.ts). */
  | "check_job"
  /** Read a job link with the web fetch tool. Needs webFetch. */
  | "read_link"
  /** Turn an uploaded resume (PDF) into her experience. Needs attachments. */
  | "import_resume"
  | "draft_outreach"
  /** A free-text application question drafted for the Chrome extension (lib/extension/draftAnswer.ts). */
  | "draft_answer"
  /** First tailored draft (engine/index.ts generateResume). */
  | "write_resume"
  /** Her own change requests (engine/revise.ts). */
  | "revise_resume"
  /** The automatic follow-up pass after a draft (engine/pipeline.ts). */
  | "polish_resume"
  /** A recruiter-style review or rewrite of the resume text. */
  | "review_resume";

/** Tasks OpenAI writes when it is the chosen resume writer. */
export const RESUME_WRITING_TASKS: readonly AITask[] = ["write_resume", "revise_resume", "polish_resume", "review_resume"];

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
  const pick: ProviderId = RESUME_WRITING_TASKS.includes(task) ? (override ?? resumeWriter(s)) : "anthropic";
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
      throw new AIError("no_key", "OpenAI is set to write your resumes, but no OpenAI API key is saved. Add one, or use Claude for this run.", "openai");
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

/** The provider for a task, from saved settings. Pass `{ override: "anthropic" }` to use Claude for one run. */
export async function providerFor(task: AITask, opts: { override?: ProviderId } = {}): Promise<AIProvider> {
  const s = await getSettings();
  return buildProvider(chooseProvider(task, s, opts.override), s, task);
}

/** True when this error means "OpenAI can't be used right now" and Claude could do this run instead. */
export function canFallBackToClaude(err: unknown): boolean {
  return err instanceof AIError && err.provider === "openai" && ["no_key", "auth", "billing", "permission", "bad_request"].includes(err.kind);
}
