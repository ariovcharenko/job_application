"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db, getProfile } from "@/lib/db";
import { deleteJobResume, exportResume, listJobResumes } from "@/lib/resume/engine/save";
import { tailoredFileName } from "@/lib/resume/repo";
import type { Application } from "@/lib/types";
import BaseResumesCard from "@/components/settings/BaseResumesCard";
import FolderCard from "@/components/settings/FolderCard";
import MasterProfileCard from "@/components/settings/MasterProfileCard";
import ApplicationForm from "@/components/tracker/ApplicationForm";
import { Button, ConfirmDialog, EmptyState, IconButton, insetClass, PageHeader, panelClass, SectionHeading, Spinner, TrashIcon } from "@/components/ui";
import ResumePreview from "./ResumePreview";

type Row = Awaited<ReturnType<typeof listJobResumes>>[number];

/** Everything resume-related in one place: what was tailored for each job, and the sources. */
export default function ResumesView() {
  // Re-query when either table changes (a new version saved, a job renamed or deleted).
  const rows = useLiveQuery(async () => {
    await Promise.all([db.tailoredResumes.count(), db.applications.count()]);
    return listJobResumes();
  }, []);
  const [opening, setOpening] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const download = async (r: Row) => {
    const profile = await getProfile();
    await exportResume(r.resume.bytes, r.resume.savedPath ?? tailoredFileName(profile.fullName, r.app.company, r.app.role), r.resume.id);
  };

  return (
    <>
      <PageHeader title="Resumes" />

      <section className="mb-14">
        <SectionHeading title="Tailored for jobs" count={rows && rows.length > 0 ? rows.length : undefined} />
        {rows === undefined ? (
          <Spinner label="Loading your resumes..." />
        ) : rows.length === 0 ? (
          <EmptyState title="No tailored resumes yet">
            Check a job, then choose Tailor resume. It&apos;s saved here.
          </EmptyState>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <article key={r.resume.id} className={`${panelClass} flex flex-col p-5`}>
                <button
                  type="button"
                  onClick={() => setOpening(r.app)}
                  className={`${insetClass} flex justify-center py-5 transition hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25`}
                  aria-label={`Open ${r.app.company} job`}
                >
                  <ResumePreview doc={r.stored.final} width={170} />
                </button>
                <p className="mt-4 font-semibold tracking-display">{r.app.company || "Untitled job"}</p>
                <p className="line-clamp-1 text-sm text-muted" title={r.app.role || undefined}>
                  {r.app.role}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {new Date(r.resume.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {r.resume.keywordScoreAfter}% of skills · {r.app.stage}
                </p>
                {/* One row: the two actions, and delete as a quiet icon at the end (it used to wrap
                    onto its own line as red text in a three-column grid). */}
                <div className="mt-auto flex items-center gap-2 pt-4">
                  <Button variant="secondary" size="sm" onClick={() => setOpening(r.app)}>
                    Open job
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => download(r)}>
                    Download
                  </Button>
                  <IconButton label={`Delete the resume for ${r.app.company || "this job"}`} tone="danger" onClick={() => setDeleting(r)} className="ml-auto">
                    <TrashIcon />
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <SectionHeading title="Your experience and files" />
      <MasterProfileCard />
      <BaseResumesCard />
      <FolderCard />

      {opening && <ApplicationForm key={opening.id} initial={opening} onClose={() => setOpening(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this resume?"
          message={`The resume tailored for ${deleting.app.company || "this job"} will be removed from the app. The job stays in your tracker, and any copy in your resume folder is kept.`}
          confirmLabel="Delete resume"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteJobResume(deleting.resume.id);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
