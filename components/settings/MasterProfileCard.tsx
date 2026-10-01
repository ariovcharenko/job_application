"use client";

import { getMasterProfile, saveMasterProfile } from "@/lib/db";
import { parseMasterExperiences } from "@/lib/resume/master/experiences";
import { parseSkillInventory } from "@/lib/resume/master/skills";
import { useAutosave } from "@/lib/useAutosave";
import { Card, inputClass } from "@/components/ui";
import ResumeImport from "@/components/resumes/ResumeImport";

/**
 * "Your experience" (stored as the master profile): the only source the resume tailoring engine
 * may draw facts from. Starts with "Import from my resume", so onboarding and /resumes both get it.
 * Its anchor is #your-experience (Card ids are slugify(title)).
 */
export default function MasterProfileCard() {
  const { draft, setDraft, status, flush } = useAutosave(getMasterProfile, saveMasterProfile);
  if (draft === null) return null;
  const skills = parseSkillInventory(draft).length;
  const roles = parseMasterExperiences(draft).length;

  return (
    <Card
      title="Your experience"
      hint="Everything you've done, more than fits on one page. Tailoring uses only this: it never adds a skill, number, employer or date that isn't here."
      saveStatus={status}
    >
      <ResumeImport
        current={draft}
        onImported={(text) => {
          // Already saved by the import; this keeps the editor in step (and saving it again is harmless).
          setDraft(text);
          void flush();
        }}
      />
      <textarea
        aria-label="Your experience"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={18}
        spellCheck
        placeholder={"### Education\n...\n\n### Experience\n**Title | Company | Location | May 2026 - Aug 2026**\n- Built ...\n\n### Skills inventory\n- **Languages:** TypeScript, Python\n\n### Leadership & Involvement\n- ..."}
        className={`${inputClass} text-[14px] leading-relaxed`}
      />
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {draft.trim() && (
          <span className="font-medium text-ink">
            Found {roles} role{roles === 1 ? "" : "s"} and {skills} skill{skills === 1 ? "" : "s"}.{" "}
          </span>
        )}
        Roles: bold lines like <code>**Title | Company | City, ST | Jan 2024 - Present**</code>. Skills: lines like{" "}
        <code>Languages: TypeScript, Python</code> under a Skills heading.
      </p>
    </Card>
  );
}
