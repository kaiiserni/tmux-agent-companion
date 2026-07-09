import { describe, expect, test } from "bun:test";
import { parseMenu } from "./menu";

describe("parseMenu", () => {
  test("single menu parses options with descriptions", () => {
    const out = parseMenu(["❯ 1. Yes", "  2. No, tell Claude what to do differently", "     keeps the current state", " esc to cancel"].join("\n"));
    expect(out).toEqual([
      { num: 1, label: "Yes", description: "" },
      { num: 2, label: "No, tell Claude what to do differently", description: "keeps the current state" },
    ]);
  });

  test("plan bullets above the menu are dropped (numbering restart, marker)", () => {
    const out = parseMenu(
      ["Plan:", " 1. Build the thing", " 2. Test the thing", " 3. Ship it", "", "❯ 1. Approve", "  2. Reject"].join("\n"),
    );
    expect(out.map((o) => o.label)).toEqual(["Approve", "Reject"]);
  });

  test("numbered sub-list inside a description stays a description", () => {
    const out = parseMenu(["❯ 1. Approach A", "     1. step one", "     2. step two", "  2. Approach B"].join("\n"));
    expect(out.map((o) => o.num)).toEqual([1, 2]);
    expect(out[0]!.description).toBe("1. step one 2. step two");
  });

  test("marker block wins over a numbered list rendered below it", () => {
    const out = parseMenu(["❯ 1. Yes", "  2. No", "", "Next steps:", " 1. streamed item", " 2. another item"].join("\n"));
    expect(out.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  test("no marker anywhere falls back to the last block", () => {
    const out = parseMenu([" 1. old item", " 2. old item two", "", " 1. fresh menu", " 2. fresh second"].join("\n"));
    expect(out.map((o) => o.label)).toEqual(["fresh menu", "fresh second"]);
  });

  test("no numbered lines gives empty menu", () => {
    expect(parseMenu("just some output\nnothing numbered")).toEqual([]);
  });
});
