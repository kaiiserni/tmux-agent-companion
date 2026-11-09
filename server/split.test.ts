import { describe, expect, test } from "bun:test";
import { detectPendingCommand, detectPrompt, normalizeCmd, pickStager } from "./split";

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

describe("detectPendingCommand", () => {
  const PROMPT = "[I]  kdesutter  ~  Documents  …  main  12⬆  850⬇  97✎  3674?  $ ";
  const at = (line: string) => Bun.stringWidth(line);

  test("staged command at Kai's fish prompt", () => {
    const line = PROMPT + "bash ~/.cache/main0-tmp/ovh/sei-close75.sh";
    expect(detectPendingCommand(["SEI2-EXIT 10:48:27Z", line], 1, at(line))).toMatchObject({
      kind: "command",
      question: "bash ~/.cache/main0-tmp/ovh/sei-close75.sh",
    });
  });

  test("powerline arrow closing the prompt is not a command", () => {
    const line = "[I]  kdesutter \ue0b0 ~ \ue0b0 Gem0 \ue0b0 main \ue0b0 $ \ue0b0 ";
    expect(detectPendingCommand([line.trimEnd()], 0, at(line))).toBeNull();
    expect(detectPendingCommand([line + "ls -la"], 0, at(line + "ls -la"))?.question).toBe("ls -la");
  });

  test("empty prompt is not pending", () => {
    expect(detectPendingCommand([PROMPT], 0, at(PROMPT))).toBeNull();
  });

  test("autosuggestion right of the cursor is ignored", () => {
    expect(detectPendingCommand([PROMPT + "bash ~/old-script.sh"], 0, at(PROMPT))).toBeNull();
    const typed = PROMPT + "ba";
    expect(detectPendingCommand([typed + "sh ~/old-script.sh"], 0, at(typed))?.question).toBe("ba");
  });

  test("wrapped long command", () => {
    const lines = [PROMPT + "bash ~/very/long/path/that/wraps/", "onto/the/next/line.sh"];
    const p = detectPendingCommand(lines, 1, at(lines[1]!));
    expect(p?.question).toBe("bash ~/very/long/path/that/wraps/onto/the/next/line.sh");
    expect(p?.row).toBe(0);
  });

  test("output line without a prompt is not a command", () => {
    expect(detectPendingCommand(["building…", "done"], 1, 4)).toBeNull();
  });

  test("redirect in the command doesn't cut it", () => {
    const line = "~ $ ./run.sh > out.log";
    expect(detectPendingCommand([line], 0, at(line))?.question).toBe("./run.sh > out.log");
  });
});

describe("pickStager", () => {
  const line = (hhmm: string, cmd: string) => ({
    minute: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)),
    text: normalizeCmd(cmd),
  });
  const now = 11 * 60 + 30;

  test("agent whose send-keys holds the staged text", () => {
    const logs = new Map([
      ["%115", [line("11:20", `tmux send-keys -t cc-x:0.3 -l "bash ~/.cache/ovh/sei-close75.sh"`)]],
      ["%285", [line("11:25", `tmux send-keys -t cc-x:1.0 "bun run dev" Enter`)]],
    ]);
    expect(pickStager("bash ~/.cache/ovh/sei-close75.sh", logs, now)).toBe("%115");
  });

  test("pipes logged as spaces still match", () => {
    const logs = new Map([["%7", [line("11:29", "tmux send-keys -t x -l 'ps aux   grep bun'")]]]);
    expect(pickStager("ps aux | grep bun", logs, now)).toBe("%7");
  });

  test("most recent stager wins, across midnight too", () => {
    const logs = new Map([
      ["%1", [line("23:50", "send-keys -l 'make deploy-prod'")]],
      ["%2", [line("00:05", "send-keys -l 'make deploy-prod'")]],
    ]);
    expect(pickStager("make deploy-prod", logs, 10)).toBe("%2");
  });

  test("stale or too short gives no owner", () => {
    const logs = new Map([["%1", [line("08:00", "send-keys -l 'make deploy-prod'"), line("11:29", "send-keys -l ls")]]]);
    expect(pickStager("make deploy-prod", logs, 21 * 60)).toBeNull();
    expect(pickStager("ls", logs, now)).toBeNull();
  });
});
