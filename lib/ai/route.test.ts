import { beforeEach, describe, expect, it } from "vitest";
import { db, getSettings, saveSettings } from "../db";
import { DEFAULT_SETTINGS } from "../defaults";
import { AIError } from "./provider";
import { buildProvider, canFallBackToClaude, chooseProvider, providerFor, RESUME_WRITING_TASKS, resumeWriter, WRITER_TASKS, type AITask } from "./route";

// Obviously fake keys.
const ANTHROPIC = "test-anthropic-key";
const OPENAI = "test-openai-key";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const both = { anthropicKey: ANTHROPIC, openaiKey: OPENAI };
const ALL_TASKS: AITask[] = ["check_job", "read_link", "import_resume", "draft_outreach", "write_resume", "revise_resume", "polish_resume", "review_resume"];

describe("who writes resumes", () => {
  it("auto: OpenAI when an OpenAI key is saved, else Claude", () => {
    expect(resumeWriter({ anthropicKey: ANTHROPIC, resumeWriter: "auto" })).toBe("anthropic");
    expect(resumeWriter({ ...both, resumeWriter: "auto" })).toBe("openai");
    expect(resumeWriter({ ...both })).toBe("openai");
    expect(resumeWriter({ anthropicKey: ANTHROPIC, openaiKey: "   " })).toBe("anthropic");
  });

  it("an explicit choice wins, even without that key (the run then asks for it)", () => {
    expect(resumeWriter({ ...both, resumeWriter: "anthropic" })).toBe("anthropic");
    expect(resumeWriter({ anthropicKey: ANTHROPIC, resumeWriter: "openai" })).toBe("openai");
  });
});

describe("routing table", () => {
  it("sends resume writing and outreach drafts to OpenAI; everything else stays on Claude", () => {
    const s = { ...both, resumeWriter: "openai" as const };
    const table = Object.fromEntries(ALL_TASKS.map((t) => [t, chooseProvider(t, s)]));
    expect(table).toEqual({
      check_job: "anthropic",
      read_link: "anthropic",
      import_resume: "anthropic",
      draft_outreach: "openai",
      write_resume: "openai",
      revise_resume: "openai",
      polish_resume: "openai",
      review_resume: "openai",
    });
  });

  it("the writer group is the resume tasks plus outreach drafts", () => {
    expect([...WRITER_TASKS].sort()).toEqual([...RESUME_WRITING_TASKS, "draft_outreach"].sort());
  });

  it("with Claude chosen, every task is Claude", () => {
    for (const t of ALL_TASKS) expect(chooseProvider(t, { ...both, resumeWriter: "anthropic" })).toBe("anthropic");
  });

  it("'use Claude for this run' overrides OpenAI for writing tasks only", () => {
    const s = { ...both, resumeWriter: "openai" as const };
    for (const t of WRITER_TASKS) expect(chooseProvider(t, s, "anthropic")).toBe("anthropic");
    // An override can never send a capability task (PDF, web fetch) to OpenAI.
    expect(chooseProvider("import_resume", s, "openai")).toBe("anthropic");
    expect(chooseProvider("read_link", s, "openai")).toBe("anthropic");
  });
});

describe("building providers", () => {
  it("names OpenAI in the no-key error so the screen offers the OpenAI key and Claude", () => {
    const err = (() => {
      try {
        buildProvider("openai", { ...DEFAULT_SETTINGS, anthropicKey: ANTHROPIC });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AIError);
    expect(err).toMatchObject({ kind: "no_key", provider: "openai" });
    expect(canFallBackToClaude(err)).toBe(true);
  });

  it("only OpenAI's own key/credit/model problems offer the Claude fallback", () => {
    expect(canFallBackToClaude(new AIError("auth", "x", "openai"))).toBe(true);
    expect(canFallBackToClaude(new AIError("billing", "x", "openai"))).toBe(true);
    expect(canFallBackToClaude(new AIError("rate_limit", "x", "openai"))).toBe(false);
    expect(canFallBackToClaude(new AIError("no_key", "x"))).toBe(false);
    expect(canFallBackToClaude(new Error("x"))).toBe(false);
  });

  it("reads saved settings: OpenAI for writing, Claude for checking jobs", async () => {
    await saveSettings({ ...both, openaiModel: "test-openai-model" });
    expect((await providerFor("write_resume")).id).toBe("openai");
    expect((await providerFor("revise_resume")).id).toBe("openai");
    expect((await providerFor("check_job")).id).toBe("anthropic");
    expect((await providerFor("write_resume", { override: "anthropic" })).id).toBe("anthropic");
  });

  it("works with only an OpenAI key for writing, and asks for the Anthropic key for everything else", async () => {
    await saveSettings({ openaiKey: OPENAI });
    expect((await providerFor("write_resume")).id).toBe("openai");
    await expect(providerFor("check_job")).rejects.toMatchObject({ kind: "no_key" });
  });

  it("falls back to Claude when the OpenAI key is forgotten (auto)", async () => {
    await saveSettings({ ...both });
    await saveSettings({ openaiKey: "" });
    expect((await providerFor("write_resume")).id).toBe("anthropic");
  });
});

describe("settings persistence", () => {
  it("keeps the OpenAI fields in the existing settings record, with defaults for old records", async () => {
    // A record saved before these fields existed.
    await db.settings.put({ id: "app", provider: "anthropic", anthropicKey: ANTHROPIC, workspaceId: "", fastModel: "f", smartModel: "s", jsearchApiKey: "" });
    const old = await getSettings();
    expect(old.openaiKey).toBe("");
    expect(old.resumeWriter).toBe("auto");
    expect(old.openaiModel).toBe(DEFAULT_SETTINGS.openaiModel);
    await saveSettings({ openaiKey: OPENAI, openaiModel: "test-openai-model", resumeWriter: "openai" });
    expect(await getSettings()).toMatchObject({ anthropicKey: ANTHROPIC, openaiKey: OPENAI, openaiModel: "test-openai-model", resumeWriter: "openai" });
  });
});
