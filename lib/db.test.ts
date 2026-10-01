import { beforeEach, describe, expect, it } from "vitest";
import {
  db,
  deleteAnswerBankEntry,
  deleteContact,
  getAnswerBank,
  getContactsForApplication,
  saveAnswerBankEntry,
  saveContact,
} from "./db";
import type { Contact } from "./types";

beforeEach(async () => {
  await db.answerBank.clear();
  await db.contacts.clear();
});

describe("answer bank", () => {
  it("saves and lists entries", async () => {
    await saveAnswerBankEntry({ question: "Why this company?", answer: "...", tags: ["general"] });
    const all = await getAnswerBank();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ question: "Why this company?" });
  });

  it("deletes an entry", async () => {
    const id = await saveAnswerBankEntry({ question: "Q", answer: "A", tags: [] });
    await deleteAnswerBankEntry(id);
    expect(await getAnswerBank()).toHaveLength(0);
  });
});

describe("contacts", () => {
  const contact = (overrides: Partial<Contact> = {}): Contact => ({
    applicationId: 1,
    name: "Jane Doe",
    role: "Recruiter",
    linkedinUrl: "https://linkedin.com/in/jane",
    type: "recruiter",
    status: "to-contact",
    draft: "",
    ...overrides,
  });

  it("filters contacts by application id", async () => {
    await saveContact(contact({ applicationId: 1 }));
    await saveContact(contact({ applicationId: 2 }));
    const forApp1 = await getContactsForApplication(1);
    expect(forApp1).toHaveLength(1);
    expect(forApp1[0].applicationId).toBe(1);
  });

  it("deletes a contact", async () => {
    const id = await saveContact(contact());
    await deleteContact(id);
    expect(await getContactsForApplication(1)).toHaveLength(0);
  });
});
