"use client";

import { useEffect, useRef, useState } from "react";
import { getProvider } from "@/lib/ai";
import { AIError } from "@/lib/ai/provider";
import { deleteContact, getAnswerBank, getContactsForApplication, getProfile, saveContact } from "@/lib/db";
import { buildOutreachSearches } from "@/lib/outreach/linkedin";
import { draftOutreachMessage } from "@/lib/outreach/draft";
import type { Application, Contact } from "@/lib/types";
import { safeHttpUrl } from "@/lib/safeUrl";
import { Button, ConfirmDialog, ExternalLinkIcon, inputClass, Modal, Notice, SelectField } from "@/components/ui";

const CONTACT_TYPES: { value: Contact["type"]; label: string }[] = [
  { value: "recruiter", label: "Recruiter" },
  { value: "hiring-manager", label: "Hiring manager" },
  { value: "alumni", label: "Alumni" },
  { value: "engineer", label: "Engineer" },
  { value: "other", label: "Other" },
];

const STATUSES: { value: Contact["status"]; label: string }[] = [
  { value: "to-contact", label: "To contact" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
];

export default function OutreachDialog({ application, onClose }: { application: Application & { id: number }; onClose: () => void }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [school, setSchool] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftingId, setDraftingId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [newContact, setNewContact] = useState({ name: "", role: "", linkedinUrl: "", type: "recruiter" as Contact["type"] });

  const latest = useRef<Contact[] | null>(null);
  latest.current = contacts;
  const refresh = async () => setContacts(await getContactsForApplication(application.id));
  // Typing shows at once and is saved shortly after it stops (a write and re-read per keystroke
  // made the inputs lag and could drop characters). Anything still waiting is written on close.
  const pending = useRef(new Map<number, { contact: Contact; timer: ReturnType<typeof setTimeout> }>());
  useEffect(() => {
    refresh();
    getProfile().then((p) => setSchool(p.school));
    const queue = pending.current;
    return () => {
      for (const { contact, timer } of queue.values()) {
        clearTimeout(timer);
        void saveContact(contact);
      }
      queue.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addContact = async () => {
    if (!newContact.name.trim() && !newContact.linkedinUrl.trim()) return;
    await saveContact({
      applicationId: application.id,
      name: newContact.name.trim(),
      role: newContact.role.trim(),
      linkedinUrl: newContact.linkedinUrl.trim(),
      type: newContact.type,
      status: "to-contact",
      draft: "",
    });
    setNewContact({ name: "", role: "", linkedinUrl: "", type: "recruiter" });
    await refresh();
  };

  const updateContact = async (contact: Contact, patch: Partial<Contact>) => {
    const next = { ...contact, ...patch };
    if (next.id === undefined) {
      await saveContact(next);
      await refresh();
      return;
    }
    const id = next.id;
    setContacts((list) => list?.map((c) => (c.id === id ? next : c)) ?? list);
    clearTimeout(pending.current.get(id)?.timer);
    const timer = setTimeout(() => {
      pending.current.delete(id);
      void saveContact(next);
    }, 300);
    pending.current.set(id, { contact: next, timer });
  };

  const removeContact = async (id?: number) => {
    if (id === undefined) return;
    clearTimeout(pending.current.get(id)?.timer);
    pending.current.delete(id);
    await deleteContact(id);
    await refresh();
  };

  const draftFor = async (contact: Contact) => {
    setError(null);
    setDraftingId(contact.id ?? -1);
    try {
      const [provider, answerBank] = await Promise.all([getProvider(), getAnswerBank()]);
      const profile = await getProfile();
      const draft = await draftOutreachMessage(provider, contact, application, profile, answerBank);
      const text = `Connection note (${draft.note.length} chars):\n${draft.note}\n\nFollow-up after connecting:\n${draft.followUp}`;
      // Merge into the newest copy, so edits made while drafting aren't lost.
      const now = latest.current?.find((c) => c.id === contact.id) ?? contact;
      await updateContact(now, { draft: text });
    } catch (e) {
      const needsKey = e instanceof AIError && e.kind === "no_key";
      setError(needsKey ? "Add your Anthropic API key in Settings first." : e instanceof Error ? e.message : String(e));
    } finally {
      setDraftingId(null);
    }
  };

  if (!contacts) return null;

  const searches = buildOutreachSearches(application.company, application.role, school);

  return (
    <Modal title={`Reach out at ${application.company || application.role}`} onClose={onClose}>
      <p className="text-sm text-muted">Search LinkedIn in a new tab. Nothing is sent for you.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {searches.map((s) => (
          <a
            key={s.label}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.12] bg-white px-3 py-1 text-sm transition hover:border-black/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
          >
            {s.label}
            <ExternalLinkIcon className="h-3 w-3 text-muted" />
          </a>
        ))}
      </div>

      <h3 className="mb-2 mt-6 text-[15px] font-semibold">Contacts</h3>
      <div className="grid gap-3">
        {contacts.map((c) => (
          <div key={c.id} className="rounded-2xl border border-black/[0.08] p-3 sm:p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={c.name}
                placeholder="Name"
                aria-label="Name"
                onChange={(e) => updateContact(c, { name: e.target.value })}
                className={inputClass}
              />
              <input
                value={c.role}
                placeholder="Their role"
                aria-label="Their role"
                onChange={(e) => updateContact(c, { role: e.target.value })}
                className={inputClass}
              />
              <input
                value={c.linkedinUrl}
                placeholder="LinkedIn URL"
                aria-label="LinkedIn URL"
                onChange={(e) => updateContact(c, { linkedinUrl: e.target.value })}
                className={`${inputClass} sm:col-span-2`}
              />
              <SelectField label="Type" value={c.type} onChange={(v) => updateContact(c, { type: v as Contact["type"] })} options={CONTACT_TYPES} />
              <SelectField label="Status" value={c.status} onChange={(v) => updateContact(c, { status: v as Contact["status"] })} options={STATUSES} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => draftFor(c)} disabled={draftingId === (c.id ?? -1)}>
                {draftingId === (c.id ?? -1) ? "Drafting..." : c.draft ? "Redraft message" : "Draft message"}
              </Button>
              <Button variant="danger-quiet" onClick={() => setRemoving(c)}>
                Remove
              </Button>
              {safeHttpUrl(c.linkedinUrl) && (
                <a
                  href={safeHttpUrl(c.linkedinUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 text-sm font-medium text-accent hover:underline"
                >
                  Open profile
                  <ExternalLinkIcon />
                </a>
              )}
            </div>
            {c.draft && (
              <textarea
                value={c.draft}
                onChange={(e) => updateContact(c, { draft: e.target.value })}
                rows={5}
                aria-label={`Draft message for ${c.name || "this contact"}`}
                className={`mt-3 ${inputClass}`}
              />
            )}
          </div>
        ))}
        {contacts.length === 0 && <p className="text-sm text-muted">No contacts yet.</p>}
      </div>

      <div className="mt-4 grid gap-2.5 rounded-2xl bg-paper p-3 sm:grid-cols-2 sm:p-4">
        <p className="text-[13px] font-medium text-black/60 sm:col-span-2">Add a contact</p>
        <input
          value={newContact.name}
          placeholder="Name"
          aria-label="New contact name"
          onChange={(e) => setNewContact((n) => ({ ...n, name: e.target.value }))}
          className={inputClass}
        />
        <input
          value={newContact.role}
          placeholder="Their role"
          aria-label="New contact role"
          onChange={(e) => setNewContact((n) => ({ ...n, role: e.target.value }))}
          className={inputClass}
        />
        <input
          value={newContact.linkedinUrl}
          placeholder="LinkedIn URL"
          aria-label="New contact LinkedIn URL"
          onChange={(e) => setNewContact((n) => ({ ...n, linkedinUrl: e.target.value }))}
          className={`${inputClass} sm:col-span-2`}
        />
        <SelectField label="Type" value={newContact.type} onChange={(v) => setNewContact((n) => ({ ...n, type: v as Contact["type"] }))} options={CONTACT_TYPES} />
        <div className="self-end">
          <Button onClick={addContact}>Add contact</Button>
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {removing && (
        <ConfirmDialog
          title="Remove this contact?"
          message={
            <>
              {removing.name || "This contact"} and any message drafted for them will be removed from this job. This can&apos;t be undone.
            </>
          }
          confirmLabel="Remove contact"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await removeContact(removing.id);
            setRemoving(null);
          }}
        />
      )}
    </Modal>
  );
}
