import { describe, expect, test } from "bun:test";
import { detectPrompt } from "./split";

// cursor on the last line unless given
const d = (lines: string[], cursorY = lines.length - 1) => detectPrompt(lines.join("\n"), cursorY);

describe("detectPrompt", () => {
  test("sudo password", () => {
    expect(d(["$ sudo systemctl restart x", "[sudo] password for kdesutter: "])?.kind).toBe("password");
  });

  test("read -p style y/n", () => {
    const p = d(["Deploying to prod", "Continue? (y/n) "]);
    expect(p).toMatchObject({ kind: "yesno", question: "Continue? (y/n)" });
  });

  test("typed answer doesn't change the question", () => {
    expect(d(["Continue? (y/n) y"])?.question).toBe("Continue? (y/n)");
  });

  test("inquirer confirm with default", () => {
    expect(d(["? Overwrite existing files? (Y/n) "])?.kind).toBe("yesno");
  });

  test("inquirer list", () => {
    const p = d(["? Pick a platform (Use arrow keys)", "  ios", "❯ android", "  web"], 0);
    expect(p).toMatchObject({ kind: "select", question: "Pick a platform", selected: 1 });
    expect(p!.options.map((o) => o.label)).toEqual(["ios", "android", "web"]);
  });

  test("prompts (expo) list", () => {
    const p = d(["? Choose a template: › - Use arrow-keys. Return to submit.", "❯   blank", "    tabs", "    bare"]);
    expect(p).toMatchObject({ kind: "select", question: "Choose a template:", selected: 0 });
    expect(p!.options.map((o) => o.label)).toEqual(["blank", "tabs", "bare"]);
  });

  test("clack select", () => {
    const p = d(["┌  create-thing", "│", "◆  Pick a template", "│  ○ Minimal", "│  ● Full", "└"]);
    expect(p).toMatchObject({ kind: "select", question: "Pick a template", selected: 1 });
  });

  test("numbered menu with marker", () => {
    const p = d(["Do you want to proceed?", "❯ 1. Yes", "  2. No"]);
    expect(p).toMatchObject({ kind: "menu", question: "Do you want to proceed?" });
    expect(p!.options.map((o) => o.num)).toEqual([1, 2]);
  });

  test("text input", () => {
    expect(d(["? What is your app named? › my-app"])).toMatchObject({ kind: "input", question: "What is your app named?" });
  });

  test("press enter to continue", () => {
    expect(d(["Build done.", "Press Enter to continue..."])?.kind).toBe("enter");
  });

  test("dev server output is not a prompt", () => {
    expect(d(["  VITE v6.0.0  ready in 300 ms", "  ➜  Local:   http://localhost:5173/", "  ➜  press h + enter to show help"])).toBeNull();
    expect(d(["› Metro waiting on exp://192.168.86.5:8081", "› Press a │ open Android", "› Press i │ open iOS simulator"])).toBeNull();
  });

  test("plain numbered output is not a menu", () => {
    expect(d(["Steps:", " 1. build", " 2. test", "done"])).toBeNull();
  });

  test("aligned lines without a question are not a list", () => {
    expect(d(["Files:", "❯ a.ts", "  b.ts"])).toBeNull();
  });

  test("y/n far up in the log is ignored", () => {
    expect(d(["Continue? (y/n) y", "ok", "building…", "still building"])).toBeNull();
  });
});
