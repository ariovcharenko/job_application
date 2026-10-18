import { describe, expect, it, vi } from "vitest";
import { cleanLabel } from "./label";
import { watchForNewFields } from "./watch";

describe("cleanLabel", () => {
  it("drops asterisks, required/optional marks and trailing colons", () => {
    expect(cleanLabel("First Name *")).toBe("First Name");
    expect(cleanLabel("Email✱")).toBe("Email");
    expect(cleanLabel("Phone (optional)")).toBe("Phone");
    expect(cleanLabel("Resume required")).toBe("Resume");
    expect(cleanLabel("  Website:  ")).toBe("Website");
  });
});

describe("watchForNewFields", () => {
  it("reports only fields that appear after it started, once, and never fills them", async () => {
    document.body.innerHTML = `<input id="old" />`;
    const seen: number[] = [];
    const w = watchForNewFields(document.body, (n) => seen.push(n), { debounceMs: 10 });
    const next = document.createElement("div");
    next.innerHTML = `<label for="a">City</label><input id="a" /><select id="b"><option>x</option></select>`;
    document.body.appendChild(next);
    await vi.waitFor(() => expect(seen).toEqual([2]));
    expect((document.getElementById("a") as HTMLInputElement).value).toBe("");
    document.body.appendChild(document.createElement("p"));
    await new Promise((r) => setTimeout(r, 40));
    expect(seen).toEqual([2]);
    w.stop();
    const more = document.createElement("input");
    document.body.appendChild(more);
    await new Promise((r) => setTimeout(r, 40));
    expect(seen).toEqual([2]);
  });
});
