import { describe, expect, it } from "vitest";
import { base64ToFile, setFileInput } from "./resumeUpload";

describe("base64ToFile", () => {
  it("decodes base64 bytes into a File with the right name and type", async () => {
    const base64 = btoa("hello world");
    const file = base64ToFile(base64, "resume.docx");
    expect(file.name).toBe("resume.docx");
    expect(file.type).toContain("wordprocessingml");
    const text = await file.text();
    expect(text).toBe("hello world");
  });
});

describe("setFileInput", () => {
  // jsdom's HTMLInputElement.files setter validates against its own internal FileList type,
  // which a hand-rolled DataTransfer polyfill can't produce — so this checks the function's
  // actual behavior (assigns via a real DataTransfer, fires both events) against a plain stub
  // rather than a jsdom-native <input>. The real target (Chrome) fully supports this pattern.
  it("assigns the file via DataTransfer and fires change/input events", () => {
    const file = base64ToFile(btoa("abc"), "resume.docx");
    const events: string[] = [];
    const stub = {
      files: null as FileList | null,
      dispatchEvent(e: Event) {
        events.push(e.type);
        return true;
      },
    } as unknown as HTMLInputElement;

    setFileInput(stub, file);

    expect(stub.files?.length).toBe(1);
    expect(stub.files?.[0].name).toBe("resume.docx");
    expect(events).toEqual(["input", "change"]);
  });
});
