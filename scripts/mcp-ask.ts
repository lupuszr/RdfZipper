import { Command } from "commander";
import { runAsk } from "./mcp-ask-core.js";

async function main(): Promise<void> {
  const program = new Command();
  program.requiredOption("-q, --question <text>", "Natural language question");
  program.parse(process.argv);
  const { question } = program.opts<{ question: string }>();

  const steps: string[] = [];
  const log = (s: string) => {
    steps.push(s);
    console.log(s);
  };

  const { facts, llm } = await runAsk(question, log);
  console.log("\n--- FACTS ---\n" + facts);
  console.log("\n--- LLM ---\n" + llm);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
