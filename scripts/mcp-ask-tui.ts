import blessed from "blessed";
import { Command } from "commander";
import { runAsk } from "./mcp-ask-core.js";

async function main(): Promise<void> {
  const program = new Command();
  program.option("-q, --question <text>", "Natural language question");
  program.option("--budget <number>", "Move budget (default 30)");
  program.parse(process.argv);
  const { question = "", budget } = program.opts<{ question?: string; budget?: string }>();
  const parsedBudget = budget !== undefined && Number.isFinite(Number(budget)) ? Number(budget) : undefined;

  const screen = blessed.screen({ smartCSR: true, title: "MCP Ask TUI" });
  const logBox = blessed.box({
    label: "Steps",
    top: 0,
    left: 0,
    width: "70%",
    height: "100%-3",
    tags: true,
    border: "line",
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    vi: true,
    scrollbar: { ch: " " },
  });

  const answerBox = blessed.box({
    label: "Answer",
    top: 0,
    right: 0,
    width: "30%",
    height: "100%-3",
    tags: true,
    border: "line",
    scrollable: true,
    keys: true,
    mouse: true,
    vi: true,
    scrollbar: { ch: " " },
  });

  const input = blessed.textbox({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    inputOnFocus: true,
    border: "line",
    label: "Question (Enter to run, q to quit)",
  });

  screen.append(logBox);
  screen.append(answerBox);
  screen.append(input);

  let lines: string[] = [];
  const log = (line: string) => {
    const time = new Date().toISOString().split("T")[1].replace("Z", "");
    lines.push(`{gray-fg}[${time}]{/gray-fg} ${line}`);
    logBox.setContent(lines.join("\n"));
    logBox.setScrollPerc(100);
    screen.render();
  };

  const quit = () => process.exit(0);
  screen.key(["q", "C-c"], quit);
  input.key(["q", "C-c"], quit);

  let running = false;
  const runQuestion = async (q: string) => {
    if (running) return;
    running = true;
    lines = [];
    logBox.setContent("");
    answerBox.setContent("");
    screen.render();
    try {
      log("Starting...");
      const { facts, llm } = await runAsk(q, log, { budget: parsedBudget });
      let budgetLine = "";
      try {
        const parsed = JSON.parse(facts);
        if (parsed?.budget && typeof parsed.budget.total === "number") {
          budgetLine = `Budget: total=${parsed.budget.total} used=${parsed.budget.used} remaining=${parsed.budget.remaining}\n\n`;
        }
      } catch {
        // ignore parse errors; fall back to raw facts
      }
      answerBox.setContent(`${budgetLine}Facts (no heuristics):\n${facts}\n\nLLM:\n${llm}`);
      log("Done");
    } catch (err: any) {
      answerBox.setContent(`Error: ${err?.message ?? err}`);
      log(`Error: ${err?.message ?? err}`);
    } finally {
      running = false;
      screen.render();
    }
  };

  input.on("submit", async (value) => {
    const q = String(value || "").trim();
    input.clearValue();
    input.focus();
    if (!q) return;
    await runQuestion(q);
  });

  input.focus();
  screen.render();

  if (question) {
    input.setValue(question);
    await runQuestion(question);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
