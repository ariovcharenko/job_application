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
import { Button, ConfirmDialog, EmptyState, PageHeader, Spinner } from "@/components/ui";
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
      <PageHeader title="Resumes" subtitle="Every resume tailored to a job, and the experience they're written from." />

      <section className="mb-14">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-[28px] font-semibold tracking-display">Tailored for jobs</h2>
          {rows && rows.length > 0 && <p className="text-sm text-muted">{rows.length} saved</p>}
        </div>
        {rows === undefined ? (
          <Spinner label="Loading your resumes..." />
        ) : rows.length === 0 ? (
          <EmptyState title="No tailored resumes yet">
            Add a job from its link, then choose Tailor resume. Each one is saved here and on its job automatically.
          </EmptyState>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <article key={r.resume.id} className="flex flex-col rounded-[22px] bg-white p-5 shadow-soft">
                <button
                  type="button"
                  onClick={() => setOpening(r.app)}
                  className="flex justify-center rounded-2xl bg-paper py-5 transition hover:bg-black/[0.05]"
                  aria-label={`Open ${r.app.company} job`}
                >
                  <ResumePreview doc={r.stored.final} width={170} />
                </button>
                <p className="mt-4 font-semibold tracking-display">{r.app.company || "Untitled job"}</p>
                <p className="line-clamp-1 text-sm text-muted">{r.app.role}</p>
                <p className="mt-2 text-xs text-muted">
                  {new Date(r.resume.createdAt).toLocaleDateString()} · shows {r.resume.keywordScoreAfter}% of the job&apos;s skills · {r.app.stage}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setOpening(r.app)}>
                    Open job
                  </Button>
                  <Button variant="secondary" onClick={() => download(r)}>
                    Download
                  </Button>
                  <Button variant="danger-quiet" onClick={() => setDeleting(r)}>
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <h2 className="mb-5 text-[28px] font-semibold tracking-display">Sources</h2>
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
