import { describe, expect, it } from "vitest";
import { BLANK_SYNCED_DATA, type SyncedProfile } from "../types";
import { fillForm } from "./fillEngine";

function profile(overrides: Partial<SyncedProfile> = {}): SyncedProfile {
  return { ...BLANK_SYNCED_DATA.profile, fullName: "Alex Rivera", email: "alex@example.com", ...overrides };
}

function setBody(html: string) {
  document.body.innerHTML = html;
  return document.body;
}

describe("fillForm — text fields", () => {
  it("fills a labeled email field", () => {
    const root = setBody(`<label for="e">Email</label><input id="e" type="email" />`);
    fillForm(root, profile());
    expect((document.getElementById("e") as HTMLInputElement).value).toBe("alex@example.com");
  });

  it("splits full name into first/last name fields", () => {
    const root = setBody(`
      <label for="fn">First Name</label><input id="fn" />
      <label for="ln">Last Name</label><input id="ln" />
    `);
    fillForm(root, profile());
    expect((document.getElementById("fn") as HTMLInputElement).value).toBe("Alex");
    expect((document.getElementById("ln") as HTMLInputElement).value).toBe("Rivera");
  });

  it("reports skipped-no-data for a matched field with no stored value", () => {
    const root = setBody(`<label for="p">Portfolio</label><input id="p" />`);
    const outcomes = fillForm(root, profile({ portfolio: "" }));
    expect(outcomes).toContainEqual({ label: "Portfolio", status: "skipped-no-data" });
  });

  it("reports skipped-unmatched for a field it can't identify at all", () => {
    const root = setBody(`<input id="x" />`);
    const outcomes = fillForm(root, profile());
    expect(outcomes.some((o) => o.status === "skipped-unmatched")).toBe(true);
  });

  it("never touches a submit button", () => {
    const root = setBody(`<label for="e">Email</label><input id="e" /><button type="submit" id="s">Submit application</button>`);
    fillForm(root, profile());
    const btn = document.getElementById("s") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.onclick).toBeNull();
  });
});

describe("fillForm — legal/identity questions (safety-critical)", () => {
  it("NEVER fills a legal yes/no select when the profile field is unset", () => {
    const root = setBody(`
      <label for="auth">Are you legally authorized to work in the United States?</label>
      <select id="auth"><option>Select...</option><option>Yes</option><option>No</option></select>
    `);
    const outcomes = fillForm(root, profile({ authorizedToWorkUS: "" }));
    const select = document.getElementById("auth") as HTMLSelectElement;
    expect(select.selectedIndex).toBe(0); // untouched
    expect(outcomes).toContainEqual(
      expect.objectContaining({ label: expect.stringContaining("authorized to work"), status: "skipped-no-data" }),
    );
  });

  it("fills the legal yes/no select correctly when the profile has a stored answer", () => {
    const root = setBody(`
      <label for="auth">Are you legally authorized to work in the United States?</label>
      <select id="auth"><option>Select...</option><option>Yes</option><option>No</option></select>
    `);
    fillForm(root, profile({ authorizedToWorkUS: "yes" }));
    const select = document.getElementById("auth") as HTMLSelectElement;
    expect(select.value).toBe("Yes");
  });

  it("answers sponsorship with the correct, independent field — never conflates it with work authorization", () => {
    const root = setBody(`
      <fieldset>
        <legend>Will you now or in the future require visa sponsorship?</legend>
        <label><input type="radio" name="sponsor" value="yes" />Yes</label>
        <label><input type="radio" name="sponsor" value="no" />No</label>
      </fieldset>
    `);
    // Authorized to work (yes) and requires sponsorship (yes) are NOT contradictory — e.g. OPT.
    fillForm(root, profile({ authorizedToWorkUS: "yes", requiresSponsorship: "yes" }));
    const yes = document.querySelector('input[value="yes"]') as HTMLInputElement;
    const no = document.querySelector('input[value="no"]') as HTMLInputElement;
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
  });

  it("leaves a radio-group legal question untouched when unset, and reports it", () => {
    const root = setBody(`
      <fieldset>
        <legend>Will you now or in the future require visa sponsorship?</legend>
        <label><input type="radio" name="sponsor" value="yes" />Yes</label>
        <label><input type="radio" name="sponsor" value="no" />No</label>
      </fieldset>
    `);
    const outcomes = fillForm(root, profile({ requiresSponsorship: "" }));
    expect([...document.querySelectorAll('input[name="sponsor"]')].some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(outcomes).toContainEqual(expect.objectContaining({ status: "skipped-no-data" }));
  });

  it("never answers an unrecognized legal-sounding question — flags it instead of guessing", () => {
    const root = setBody(`
      <fieldset>
        <legend>Do you hold a valid security clearance?</legend>
        <label><input type="radio" name="clearance" value="yes" />Yes</label>
        <label><input type="radio" name="clearance" value="no" />No</label>
      </fieldset>
    `);
    const outcomes = fillForm(root, profile({ authorizedToWorkUS: "yes", requiresSponsorship: "no" }));
    expect([...document.querySelectorAll('input[name="clearance"]')].some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(outcomes).toContainEqual(expect.objectContaining({ status: "skipped-needs-review" }));
  });
});

describe("fillForm — EEO fields", () => {
  it("selects the decline-to-answer option when the profile field is blank", () => {
    const root = setBody(`
      <label for="g">Gender</label>
      <select id="g"><option>Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select>
    `);
    fillForm(root, profile({ gender: "" }));
    expect((document.getElementById("g") as HTMLSelectElement).value).toBe("Decline to self-identify");
  });

  it("matches a stored EEO answer to the closest option text", () => {
    const root = setBody(`
      <label for="v">Veteran status</label>
      <select id="v"><option>Select...</option><option>I am a protected veteran</option><option>I am not a protected veteran</option></select>
    `);
    fillForm(root, profile({ veteran: "not a veteran" }));
    expect((document.getElementById("v") as HTMLSelectElement).value).toBe("I am not a protected veteran");
  });
});

describe("fillForm — free text / essay questions", () => {
  it("flags an unmatched textarea as needing an AI draft rather than filling it", () => {
    const root = setBody(`<label for="why">Why do you want to work here?</label><textarea id="why"></textarea>`);
    const outcomes = fillForm(root, profile());
    expect((document.getElementById("why") as HTMLTextAreaElement).value).toBe("");
    expect(outcomes).toContainEqual(expect.objectContaining({ status: "skipped-needs-review" }));
  });
});
