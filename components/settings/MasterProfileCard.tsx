"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { listMasterVersions, restoreMasterVersion } from "@/lib/db";
import { parseMasterExperiences } from "@/lib/resume/master/experiences";
import { parseSkillInventory } from "@/lib/resume/master/skills";
import { useMasterDraft } from "@/lib/useMasterDraft";
import type { MasterSaveReason, TextDoc } from "@/lib/types";
import { Button, Card, ConfirmDialog, inputClass, Notice, textButtonClass } from "@/components/ui";
import ResumeImport from "@/components/resumes/ResumeImport";

const REASON_LABEL: Record<MasterSaveReason, string> = {
  edit: "before later edits",
  import: "before an import",
  tailor: "before a skill was added while tailoring",
  restore: "before a restore",
  "restore-backup": "before a backup was restored",
  other: "before a change",
};

function summarize(text: string): string {
  const roles = parseMasterExperiences(text).length;
  const skills = parseSkillInventory(text).length;
  return `${roles} role${roles === 1 ? "" : "s"}, ${skills} skill${skills === 1 ? "" : "s"}, ${text.trim().split(/\s+/).filter(Boolean).length} words`;
}

/**
 * "Your experience" (stored as the master profile): the only source the resume tailoring engine
 * may draw facts from. Starts with "Import from my resume", so onboarding and /resumes both get it.
 * Its anchor is #your-experience (Card ids are slugify(title)).
 *
 * It follows the database while she isn't typing (a skill added while tailoring, or another tab,
 * shows up here), never writes over a newer saved version (she picks), and keeps the last earlier
 * versions with a Restore button (lib/db.ts).
 */
export default function MasterProfileCard() {
  const { text: draft, status, theirs, setText, flush, resolve } = useMasterDraft();
  const versions = useLiveQuery(() => listMasterVersions(), []);
  const [showVersions, setShowVersions] = useState(false);
  const [restoring, setRestoring] = useState<TextDoc | null>(null);
  if (draft === null) return null;
  const skills = parseSkillInventory(draft).length;
  const roles = parseMasterExperiences(draft).length;

  return (
    <Card
      title="Your experience"
      hint="Everything you've done, more than fits on one page. Tailoring uses only this: it never adds a skill, number, employer or date that isn't here."
      saveStatus={status === "saving" || status === "saved" ? status : "idle"}
    >
      <ResumeImport
        current={draft}
        onImported={() => {
          // Saved by the import (the text it replaced is kept as an earlier version). The editor
          // follows the database, so it shows the new text on its own.
        }}
      />
      {status === "conflict" && theirs !== null && (
        <div role="alert" className="mb-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm leading-relaxed text-ink">
          <p className="font-medium">Your experience was changed somewhere else while you were editing.</p>
          <p className="mt-1 text-muted">
            Maybe a skill was added while tailoring, or it was edited in another tab. Your edits aren&apos;t saved yet. The one you don&apos;t
            keep is saved under Earlier versions.
          </p>
          <p className="mt-1 text-muted">Saved version: {summarize(theirs)}. Yours: {summarize(draft)}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void resolve("mine")}>
              Keep my edits
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void resolve("theirs")}>
              Use the saved version
            </Button>
          </div>
        </div>
      )}
      <textarea
        aria-label="Your experience"
        value={draft}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void flush()}
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
      {versions && versions.length > 0 && (
        <div className="mt-4">
          <button type="button" className={textButtonClass} aria-expanded={showVersions} onClick={() => setShowVersions((v) => !v)}>
            {showVersions ? "Hide earlier versions" : `Earlier versions (${versions.length})`}
          </button>
          {showVersions && (
            <ul className="mt-2 divide-y divide-black/[0.06]">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="text-ink">{new Date(v.savedAt ?? v.updatedAt).toLocaleString()}</span>{" "}
                    <span className="text-muted">
                      {REASON_LABEL[v.reason ?? "other"]}. {summarize(v.text)}.
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setRestoring(v)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status === "conflict" && <Notice kind="info">Autosave is paused until you choose above.</Notice>}
      {restoring && (
        <ConfirmDialog
          title="Restore this version?"
          message={`Your experience goes back to the version from ${new Date(restoring.savedAt ?? restoring.updatedAt).toLocaleString()} (${summarize(restoring.text)}). What's there now is kept under Earlier versions.`}
          confirmLabel="Restore"
          onCancel={() => setRestoring(null)}
          onConfirm={async () => {
            await flush();
            await restoreMasterVersion(restoring.id);
            setRestoring(null);
          }}
        />
      )}
    </Card>
  );
}
