import { describe, expect, test } from "bun:test";
import { speakable } from "./tts";

describe("speakable", () => {
  test("drops fenced code blocks", () => {
    const out = speakable("Fixed it:\n\n```ts\nconst x = 1;\n```\n\nRestart the bridge.");
    expect(out).not.toContain("const x");
    expect(out).toContain("Fixed it");
    expect(out).toContain("Restart the bridge.");
  });

  test("unwraps inline markup, headings and lists", () => {
    const out = speakable("## Done\n\n- **build** ok\n- see `bridge.ts`\n- [docs](https://x.dev)");
    expect(out).toBe("Done\n\nbuild ok\nsee bridge.ts\ndocs");
  });

  test("caps long replies on a sentence boundary", () => {
    const long = `${"Alles staat klaar. ".repeat(200)}einde`;
    const out = speakable(long);
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out.endsWith(".")).toBe(true);
  });

  test("returns empty for a code-only reply", () => {
    expect(speakable("```\nbun test\n```")).toBe("");
  });
});
