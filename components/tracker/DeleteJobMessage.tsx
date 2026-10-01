import type { Application } from "@/lib/types";

/** The body of "Delete this job?", shared by the table's trash icon and the job dialog. */
export default function DeleteJobMessage({ app }: { app: Pick<Application, "role" | "company"> }) {
  return (
    <>
      <span className="font-medium text-ink">
        {app.role || "This job"}
        {app.company ? ` at ${app.company}` : ""}
      </span>{" "}
      and its saved resume and contacts will be deleted. Files in your resume folder are kept.
    </>
  );
}
