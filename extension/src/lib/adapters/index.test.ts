import { describe, expect, it } from "vitest";
import { pickAdapter } from "./index";

function fakeLocation(hostname: string): Location {
  return { hostname } as Location;
}

describe("pickAdapter", () => {
  it("picks the greenhouse adapter on a greenhouse.io host", () => {
    expect(pickAdapter(fakeLocation("job-boards.greenhouse.io")).name).toBe("greenhouse");
  });

  it("picks the lever adapter on a lever.co host", () => {
    expect(pickAdapter(fakeLocation("jobs.lever.co")).name).toBe("lever");
  });

  it("picks the ashby adapter on an ashbyhq.com host", () => {
    expect(pickAdapter(fakeLocation("jobs.ashbyhq.com")).name).toBe("ashby");
  });

  it("falls back to generic for anything else", () => {
    expect(pickAdapter(fakeLocation("careers.example.com")).name).toBe("generic");
  });

  it("does not false-positive on a hostname that merely contains 'lever'", () => {
    expect(pickAdapter(fakeLocation("clevermarketing.example.com")).name).toBe("generic");
  });
});
