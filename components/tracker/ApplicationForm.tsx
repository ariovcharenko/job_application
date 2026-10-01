"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db, getProfile } from "@/lib/db";
import { hasIncompletePosting, readBreakdown } from "@/lib/intake/stored";
import { JOB_SOURCES, WORK_MODES } from "@/lib/options";
import { REGION_NAMES, looksRemote } from "@/lib/regions";
import { exportResume, getJobResume } from "@/lib/resume/engine/save";
import { tailoredFileName } from "@/lib/resume/repo";
import { attachOwnResume, getCurrentResume, removeOwnResume } from "@/lib/resume/ownResume";
import { safeHttpUrl } from "@/lib/safeUrl";
import { blankApplication } from "@/lib/tracker/blank";
import { hasUnsavedChanges } from "@/lib/tracker/dirty";
import { deleteApplication, saveApplication } from "@/lib/tracker/repo";
import { applyStageChange } from "@/lib/tracker/stage";
import { ROLE_TYPES, STAGES, VISA_SIGNALS, type Application, type RoleType, type Stage, type VisaSignal } from "@/lib/types";
import { Button, ConfirmDialog, ExternalLinkIcon, Field, Modal, Notice, SelectField, TextArea } from "@/components/ui";
import OutreachDialog from "../outreach/OutreachDialog";
import JobResumeDialog from "../resumes/JobResumeDialog";
import ResumePreview from "../resumes/ResumePreview";
import TailorDialog, { TAILOR_COST_HINT } from "../tailor/TailorDialog";
import NewJobDialog from "./NewJobDialog";
import ScoreCard from "./ScoreCard";
import DeleteJobMessage from "./DeleteJobMessage";
import { CompanyMark, STAGE_STYLE } from "./StageBadge";

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

type Tab = "overview" | "details";

/** "2026-10-05" -> "Oct 5" (local calendar day, no timezone shift). */
const formatDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};


/**
 * One job. Opens on an Overview (should I apply, my resume for it, next steps); every tracker
 * field is under Details. A new job added by hand opens straight on Details.
 */
export default function ApplicationForm({ initial, onClose }: { initial: Application; onClose: () => void }) {
  // Older saved rows may lack newer fields, so fill any gaps from a blank application.
  const [app, setApp] = useState<Application>({ ...blankApplication(), ...initial });
  // What was last loaded or saved, so edits can be told apart from what's already stored.
  const [savedApp, setSavedApp] = useState<Application>(app);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [outreach, setOutreach] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const isNew = initial.id === undefined;
  const breakdown = readBreakdown(app);
  // Scored from a page shell instead of the posting: the verdict would be about nothing, so hide it.
  const incomplete = hasIncompletePosting(app);
  const [tab, setTab] = useState<Tab>(isNew ? "details" : "overview");
  const resume = useLiveQuery(() => (app.id === undefined ? null : getJobResume(app.id)), [app.id, app.tailoredResumeId]);
  // The resume the job points to right now: her own uploaded file, or the tailored one.
  const current = useLiveQuery(() => getCurrentResume(app), [app.tailoredResumeId]);
  const own = current?.own ? current : null;
  const [previewing, setPreviewing] = useState(false);
  const [ownError, setOwnError] = useState<string | null>(null);
  const ownInput = useRef<HTMLInputElement>(null);

  const dirty = hasUnsavedChanges(app, savedApp);
  // Close, the X, Escape and a click outside all come here: never drop edits without asking.
  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());

  const set = <K extends keyof Application>(key: K, value: Application[K]) => setApp((a) => ({ ...a, [key]: value }));

  const save = async () => {
    if (!app.company.trim() && !app.role.trim()) {
      setError("Add at least a company or a position.");
      setTab("details");
      return;
    }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveApplication({ ...app, company: app.company.trim(), role: app.role.trim() });
      onClose();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  };

  // Stage changes on the Overview save right away, like the stage menu in the table. Only the
  // stage change is stored: any unsaved Details edits stay unsaved (and still count as changes).
  const changeStageNow = async (stage: Stage) => {
    setApp((a) => applyStageChange(a, stage));
    if (app.id === undefined) return;
    const stored = applyStageChange(savedApp, stage);
    setSavedApp(stored);
    await saveApplication(stored);
  };

  // Where the job sits (table, Checked jobs, or Not applying) also saves right away.
  const setTriageNow = async (triage: Application["triage"]) => {
    const apply = <T extends Application>(a: T): T => {
      const next = { ...a, triage };
      if (!triage) delete next.triage;
      return next;
    };
    setApp(apply);
    if (app.id === undefined) return;
    const stored = apply(savedApp);
    setSavedApp(stored);
    await saveApplication(stored);
  };

  const downloadResume = async () => {
    if (!resume) return;
    const profile = await getProfile();
    const fileName = resume.savedPath ?? tailoredFileName(profile.fullName, app.company, app.role);
    const out = await exportResume(resume.bytes, fileName, resume.id);
    setDownloadNote(`Downloaded ${fileName}${out.toFolder ? " and saved a copy to your Tailored folder" : ""}.${out.folderWarning ? ` ${out.folderWarning}` : ""}`);
  };

  // Her own file becomes the job's resume right away (like stage changes, no Save needed).
  const pickOwn = async (file: File | undefined) => {
    setOwnError(null);
    if (!file || app.id === undefined) return;
    try {
      const id = await attachOwnResume(app.id, file);
      const point = (a: Application): Application => {
        const next = { ...a, tailoredResumeId: id };
        delete next.triage;
        return next;
      };
      setApp(point);
      setSavedApp(point);
    } catch (e) {
      setOwnError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeOwn = async () => {
    if (!own || app.id === undefined) return;
    await removeOwnResume(own.id);
    const tailoredResumeId = (await db.applications.get(app.id))?.tailoredResumeId;
    setApp((a) => ({ ...a, tailoredResumeId }));
    setSavedApp((a) => ({ ...a, tailoredResumeId }));
  };

  const title = isNew ? "Add a job" : `${app.role || "Job"}${app.company ? ` at ${app.company}` : ""}`;

  return (
    <Modal title={title} onClose={requestClose}>
      {!isNew && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full bg-black/[0.05] p-1 text-sm" role="tablist">
            {(["overview", "details"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 font-medium capitalize transition ${tab === t ? "bg-white text-ink shadow-soft" : "text-muted hover:text-ink"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {safeHttpUrl(app.url) && (
            <a
              href={safeHttpUrl(app.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              View job posting
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      )}

      {tab === "overview" && !isNew && (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <CompanyMark name={app.company} size="md" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold tracking-display">{app.company || "Company not set"}</p>
              <p className="text-muted">
                {[app.location, app.workMode !== "Unknown" ? app.workMode : "", app.salary].filter(Boolean).join(" · ") || "Location not set"}
              </p>
            </div>
            {app.stage === "Saved" && <Button onClick={() => changeStageNow("Applied")}>Mark as applied</Button>}
            <select
              aria-label="Stage"
              value={app.stage}
              onChange={(e) => changeStageNow(e.target.value as Stage)}
              className={`cursor-pointer rounded-full border-0 px-3 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-accent/30 ${STAGE_STYLE[app.stage]}`}
            >
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {!isNew && app.stage === "Saved" && (
            <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
              {app.triage === "checked" && <span>Not in your applications yet.</span>}
              {app.triage === "skipped" && <span>Marked as not applying.</span>}
              {app.triage && (
                <button type="button" onClick={() => setTriageNow(undefined)} className="font-medium text-accent hover:underline">
                  Add to applications
                </button>
              )}
              {app.triage !== "skipped" && (
                <button type="button" onClick={() => setTriageNow("skipped")} className="font-medium text-muted hover:text-ink hover:underline">
                  Not applying
                </button>
              )}
            </div>
          )}
          {app.followUpDate && (
            <p className="-mt-2 text-[13px] text-muted">
              Follow up on <span className="font-medium text-ink">{formatDay(app.followUpDate)}</span>
            </p>
          )}

          {incomplete && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-soft px-5 py-4 text-sm">
              <p className="max-w-md leading-relaxed text-warn">The saved text isn&apos;t the full job description, so this check isn&apos;t reliable.</p>
              <Button variant="secondary" onClick={() => setRechecking(true)}>
                Paste and re-check
              </Button>
            </div>
          )}
          {incomplete ? null : breakdown ? (
            <ScoreCard result={breakdown} />
          ) : (
            <p className="rounded-2xl bg-paper px-5 py-4 text-sm text-muted">
              Not analyzed. Add it from its link with <span className="font-medium text-ink">Add job</span> to see if it fits.
            </p>
          )}

          <section className="rounded-2xl border border-black/[0.08] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-[17px] font-semibold tracking-display">Resume</h3>
                <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
                  {own
                    ? `Using your own file: ${own.own!.fileName}.`
                    : resume
                    ? `Saved ${new Date(resume.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Shows ${resume.keywordScoreAfter}% of the job's skills.`
                    : app.jdText.trim()
                      ? "Written only from Your experience."
                      : "Add the job description under Details to tailor one."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {own ? (
                    <>
                      <Button onClick={() => setPreviewing(true)}>Preview</Button>
                      <Button variant="secondary" onClick={() => ownInput.current?.click()}>
                        Replace file
                      </Button>
                      <Button variant="danger-quiet" onClick={removeOwn}>
                        {resume ? "Use the tailored one" : "Remove"}
                      </Button>
                    </>
                  ) : resume ? (
                    <>
                      <Button onClick={() => setTailoring(true)}>Review and edit</Button>
                      <Button variant="secondary" onClick={downloadResume}>
                        Download .docx
                      </Button>
                    </>
                  ) : (
                    app.jdText.trim() && <Button onClick={() => setTailoring(true)}>Tailor resume ({TAILOR_COST_HINT})</Button>
                  )}
                  {!own && (
                    <Button variant="secondary" onClick={() => ownInput.current?.click()}>
                      Use my own file
                    </Button>
                  )}
                  <input
                    ref={ownInput}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => {
                      pickOwn(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              {resume && !own && (
                <button type="button" onClick={() => setTailoring(true)} aria-label="Open resume" className="transition hover:-translate-y-0.5">
                  <ResumePreview doc={resume.stored.final} width={150} />
                </button>
              )}
            </div>
            {ownError && <Notice kind="error">{ownError}</Notice>}
            {downloadNote && <Notice kind="ok">{downloadNote}</Notice>}
            {downloadNote && app.stage === "Saved" && (
              <p className="mt-3 text-[13px] text-muted">
                Applied with this resume?{" "}
                <button type="button" onClick={() => changeStageNow("Applied")} className="font-medium text-accent hover:underline">
                  Mark as applied
                </button>
              </p>
            )}
          </section>

          <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/[0.08] p-5">
            <div>
              <h3 className="text-[17px] font-semibold tracking-display">Reach out</h3>
              <p className="mt-1 text-[13px] text-muted">Find people on LinkedIn and draft a note.</p>
            </div>
            <Button variant="secondary" onClick={() => setOutreach(true)}>
              Open outreach
            </Button>
          </section>
        </div>
      )}

      {tab === "details" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" value={app.company} onChange={(v) => set("company", v)} />
            <Field label="Job position" value={app.role} onChange={(v) => set("role", v)} />
            <Field label="Job posting link" value={app.url} onChange={(v) => set("url", v)} />
            <Field
              label="Location"
              placeholder="Pick a region or type a city"
              suggestions={["Remote (US)", ...REGION_NAMES]}
              value={app.location}
              onChange={(v) =>
                setApp((a) => ({
                  ...a,
                  location: v,
                  // Guess Remote from the wording, but never override a mode you already chose.
                  workMode: a.workMode === "Unknown" && looksRemote(v) ? "Remote" : a.workMode,
                }))
              }
            />
            <SelectField
              label="Work mode"
              value={app.workMode}
              onChange={(v) => set("workMode", v as Application["workMode"])}
              options={[{ value: "Unknown", label: "Not set" }, ...WORK_MODES.map((m) => ({ value: m, label: m }))]}
            />
            <SelectField label="Stage" value={app.stage} onChange={(v) => setApp((a) => applyStageChange(a, v as Stage))} options={opts(STAGES)} />
            <SelectField label="Role type" value={app.roleType} onChange={(v) => set("roleType", v as RoleType)} options={opts(ROLE_TYPES)} />
            <Field label="Salary" value={app.salary} onChange={(v) => set("salary", v)} />
            <Field label="Applied on" type="date" value={app.appliedDate} onChange={(v) => set("appliedDate", v)} />
            <Field label="Heard back on" type="date" value={app.respondDate} onChange={(v) => set("respondDate", v)} />
            <Field label="Follow up on" type="date" value={app.followUpDate} onChange={(v) => set("followUpDate", v)} />
            <Field label="Referral" placeholder="Who referred you, or No" value={app.referral} onChange={(v) => set("referral", v)} />
            <Field label="Person to reach out to" value={app.contactName} onChange={(v) => set("contactName", v)} />
            <Field label="Their LinkedIn link" value={app.contactLinkedin} onChange={(v) => set("contactLinkedin", v)} />
            <SelectField
              label="Where you found it"
              value={app.source}
              onChange={(v) => set("source", v)}
              options={[
                { value: "", label: "Not set" },
                ...(app.source && !JOB_SOURCES.includes(app.source) ? [app.source] : []).concat(JOB_SOURCES).map((v) => ({ value: v, label: v })),
              ]}
            />
            <SelectField label="Sponsorship (per the posting)" value={app.visa} onChange={(v) => set("visa", v as VisaSignal)} options={opts(VISA_SIGNALS)} />
            <Field label="Resume link (optional)" value={app.tailoredUrl} onChange={(v) => set("tailoredUrl", v)} />
          </div>
          <div className="mt-4 grid gap-4">
            <TextArea label="Notes" value={app.notes} onChange={(v) => set("notes", v)} rows={3} />
            <TextArea label="Job description" value={app.jdText} onChange={(v) => set("jdText", v)} rows={5} />
          </div>
        </>
      )}

      {error && <Notice kind="error">{error}</Notice>}
      <div className="mt-7 flex flex-wrap-reverse items-center justify-between gap-3 border-t border-black/[0.06] pt-5">
        <div>
          {!isNew && (
            <Button variant="danger-quiet" onClick={() => setConfirmDelete(true)}>
              Delete job
            </Button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {!isNew && dirty && (
            <span className="text-[13px] text-muted" role="status">
              Unsaved changes
            </span>
          )}
          {isNew ? (
            <>
              <Button variant="secondary" onClick={requestClose}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Adding..." : "Add job"}
              </Button>
            </>
          ) : dirty ? (
            <>
              <Button variant="secondary" onClick={() => setApp(savedApp)} disabled={saving}>
                Discard changes
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {tailoring && app.id !== undefined && (
        <TailorDialog application={{ ...app, id: app.id }} onClose={() => setTailoring(false)} onSaved={(patch) => {
            // The tailoring dialog stores its own result, so it isn't an unsaved edit here.
            setApp((a) => ({ ...a, ...patch }));
            setSavedApp((a) => ({ ...a, ...patch }));
          }}
        />
      )}
      {previewing && <JobResumeDialog app={app} onClose={() => setPreviewing(false)} />}
      {outreach && app.id !== undefined && <OutreachDialog application={{ ...app, id: app.id }} onClose={() => setOutreach(false)} />}
      {rechecking && (
        <NewJobDialog
          initialUrl={app.url}
          initialMode="paste"
          updateId={app.id}
          onClose={async () => {
            setRechecking(false);
            // The re-check updates this same row; show the new result.
            const fresh = app.id !== undefined ? await db.applications.get(app.id) : undefined;
            if (fresh) {
              const loaded = { ...blankApplication(), ...fresh };
              setApp(loaded);
              setSavedApp(loaded);
            }
          }}
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard your changes?"
          message="Your edits to this job aren't saved yet."
          confirmLabel="Discard changes"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
        />
      )}
      {confirmDelete && app.id !== undefined && (
        <ConfirmDialog
          title="Delete this job?"
          message={<DeleteJobMessage app={app} />}
          confirmLabel="Delete job"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteApplication(app.id!);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
