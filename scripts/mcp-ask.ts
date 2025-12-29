import { Command } from "commander";
import { runAsk } from "./mcp-ask-core.js";

async function main(): Promise<void> {
  const program = new Command();
  program.requiredOption("-q, --question <text>", "Natural language question");
  program.option("--budget <number>", "Move budget (default 30)");
  program.parse(process.argv);
  const { question, budget } = program.opts<{ question: string; budget?: string }>();

  const parsedBudget = budget !== undefined && Number.isFinite(Number(budget)) ? Number(budget) : undefined;

  const steps: string[] = [];
  const log = (s: string) => {
    steps.push(s);
    console.log(s);
  };

  const { facts, llm } = await runAsk(question, log, { budget: parsedBudget });
  console.log("\n--- FACTS ---\n" + facts);
  console.log("\n--- LLM ---\n" + llm);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
