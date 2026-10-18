import { describe, expect, it } from "vitest";
import { historyAfterStartOver } from "./history";

describe("historyAfterStartOver", () => {
  it("keeps the resume she had (and everything before it) one Undo away", () => {
    expect(historyAfterStartOver(["v1"], "v2 edited")).toEqual(["v1", "v2 edited"]);
  });
  it("adds nothing for the very first draft", () => {
    expect(historyAfterStartOver([], null)).toEqual([]);
  });
});
