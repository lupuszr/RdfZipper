import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OpenAI } from "openai";

const SERVER_CMD = "npx";
const SERVER_ARGS = ["tsx", "src/mcp/server.ts"];
const DEFAULT_FOCUS_BASE = "https://example.org/guardian#";
const DEFAULT_CLASS = `${DEFAULT_FOCUS_BASE}Person`;
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const MAX_STEPS = 10;
const MAX_CLASSES = 1000;
const MAX_NODES = 10000;
const MAX_EDGES_PER_NODE = 200;
const SERVER_LIST_LIMIT = 1000; // must not exceed MCP server LIST_CAP

function lastSegment(iri: string): string {
  const m = iri.match(/[^/#]+$/);
  return m ? m[0] : iri;
}

function firstText(res: any): string | undefined {
  const content = (res as any)?.content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0] as any;
  return typeof first?.text === "string" ? first.text : undefined;
}

function safeJson(text?: string): any {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type Edge = {
  p: string;
  o: string;
  type: "iri" | "literal";
  datatype?: string;
  lang?: string;
};

type NodeFact = {
  iri: string;
  edges: Edge[];
  complete_outgoing: boolean;
  edges_truncated: boolean;
};

type Facts = {
  focus: string;
  nodes: NodeFact[];
  classes: string[];
  steps: string[];
};

type PlannerAction =
  | { action: "listClasses"; args?: { limit?: number } }
  | { action: "listIriByClass"; args: { classIri: string; limit?: number } }
  | { action: "open_and_moves"; args: { focusIri: string; maxEdges?: number } }
  | { action: "answer"; args?: Record<string, unknown> };

async function planner(
  question: string,
  summary: { classes: string[]; nodes: number; pending: number; stepsTaken: number },
): Promise<PlannerAction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback: discover classes, then list default class IRIs, then answer
    if (summary.stepsTaken === 0) return { action: "listClasses", args: { limit: MAX_CLASSES } };
    if (summary.stepsTaken === 1)
      return { action: "listIriByClass", args: { classIri: DEFAULT_CLASS, limit: MAX_NODES } };
    return { action: "answer", args: {} };
  }

  const client = new OpenAI({ apiKey });
  const system = `You are a planner that chooses the NEXT MCP tool call. Output ONLY JSON: {"action":"...","args":{...}}.
Allowed actions:
- listClasses(limit?): discover class IRIs.
- listIriByClass(classIri, limit?): get IRIs of that class (use limits to respect caps). Default class: ${DEFAULT_CLASS}.
- open_and_moves(focusIri, maxEdges?): fetch outgoing edges for a node.
- answer: stop planning; proceed to final answer.
Constraints:
- Hard caps: max classes ${MAX_CLASSES}, max nodes ${MAX_NODES}, max edges per node ${MAX_EDGES_PER_NODE}.
- Plan within ${MAX_STEPS} steps total.
- Aim to cover multiple classes (people, animals, etc.) within caps.
`;
  const user = `Question: ${question}
Current summary: classes=${summary.classes.length}, nodes=${summary.nodes}, pending=${summary.pending}, stepsTaken=${summary.stepsTaken}.
Return the next action only.`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
  });

  const text = resp.choices[0]?.message?.content?.trim();
  const parsed = safeJson(text);
  if (
    parsed &&
    typeof parsed.action === "string" &&
    (parsed.action === "answer" ||
      parsed.action === "listClasses" ||
      parsed.action === "listIriByClass" ||
      parsed.action === "open_and_moves")
  ) {
    return parsed as PlannerAction;
  }
  return { action: "answer", args: {} };
}

async function answerWithLLM(question: string, facts: Facts, log: (s: string) => void): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "No OPENAI_API_KEY set";

  const oa = new OpenAI({ apiKey });
  const system = `You are a constrained RDF-facts interpreter.
You will receive:
- A user question.
- FACTS JSON: bounded nodes with outgoing edges, and completeness flags.
Rules:
1) Use ONLY nodes/edges in FACTS. Do not assume missing nodes.
2) For a node: if complete_outgoing=true AND edges_truncated=false, then predicates not listed are FALSE for that node. Otherwise missing predicates are UNKNOWN.
3) If needed info is UNKNOWN or nodes are missing, answer UNKNOWN.
4) IRIs are opaque; do not fabricate labels.
5) Be concise.
Output format (no extra text):
- JSON: {"status":"certain|unknown", "debug?": <explain if unknown>, "answer":<boolean|string|array>,"evidence":[{"s":iri,"p":iri,"o":iri}...]}
- evidence must cite only edges from FACTS. If status=unknown, evidence may be empty.
`;
  const userContent = `Question: ${question}\nFACTS:${JSON.stringify(facts, null, 2)}`;
  log("LLM input prepared");
  const resp = await oa.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    temperature: 0,
  });
  const ans = resp.choices[0]?.message?.content?.trim() ?? "No answer";
  log(`LLM output: ${ans.substring(0, 200)}${ans.length > 200 ? "..." : ""}`);
  return ans;
}

export async function runAsk(question: string, log: (s: string) => void) {
  log(`Question: ${question}`);
  const transport = new StdioClientTransport({
    command: SERVER_CMD,
    args: SERVER_ARGS,
    stderr: "ignore",
  });
  const client = new Client({ name: "guardian-zipper-client", version: "0.1.0" });
  await client.connect(transport);
  log("Connected to MCP server");

  const classes: string[] = [];
  const nodes = new Map<string, NodeFact>();
  const queue: string[] = [];
  const steps: string[] = [];

  const enqueueNode = (iri: string) => {
    if (!nodes.has(iri) && !queue.includes(iri) && nodes.size + queue.length < MAX_NODES) {
      queue.push(iri);
    }
  };

  const addEdges = (iri: string, moves: any[], maxEdges: number) => {
    const edges: Edge[] = moves.map((m: any) => {
      if (m.kind === "follow") {
        return { p: m.predicateIri, o: m.objectIri, type: "iri" };
      }
      const obj = m.object;
      return {
        p: m.predicateIri,
        o: obj.value,
        type: "literal",
        datatype: obj.datatype,
        lang: obj["xml:lang"],
      };
    });
    const truncated = moves.length >= maxEdges;
    nodes.set(iri, { iri, edges, complete_outgoing: !truncated, edges_truncated: truncated });
  };

  const callListClasses = async () => {
    const resp = await client.callTool({ name: "listClasses", arguments: { limit: SERVER_LIST_LIMIT } });
    const data = safeJson(firstText(resp));
    const found = Array.isArray(data?.classes) ? data.classes.slice(0, MAX_CLASSES) : [];
    found.forEach((c: string) => {
      if (!classes.includes(c) && classes.length < MAX_CLASSES) classes.push(c);
    });
    steps.push(`listClasses -> ${found.length}`);
    log(`listClasses found ${found.length}: ${found.join(", ")}`);
  };

  const callListIriByClass = async (classIri: string) => {
    const normClass = classIri.includes("://") ? classIri : `${DEFAULT_FOCUS_BASE}${classIri.replace(/^:/, "")}`;
    const resp = await client.callTool({ name: "listIriByClass", arguments: { classIri: normClass, limit: SERVER_LIST_LIMIT } });
    const data = safeJson(firstText(resp));
    const items = Array.isArray(data?.items) ? data.items : [];
    items.forEach((it: any) => enqueueNode(it.iri));
    const msg = `listIriByClass(${normClass}) -> ${items.length}`;
    steps.push(msg);
    log(msg);
  };

  const callOpenAndMoves = async (focusIri: string, maxEdges: number) => {
    const openRes = await client.callTool({ name: "open", arguments: { focusIri, maxEdges } });
    const openData = safeJson(firstText(openRes));
    const cursorId = openData?.cursorId;
    if (!cursorId) throw new Error("cursorId missing from open response");
    const movesRes = await client.callTool({ name: "moves", arguments: { cursorId } });
    const movesData = safeJson(firstText(movesRes));
    const moves = Array.isArray(movesData?.moves) ? movesData.moves : [];
    addEdges(focusIri, moves, maxEdges);
    steps.push(`open_and_moves(${lastSegment(focusIri)}) -> ${moves.length}`);
    log(`open_and_moves ${focusIri} => ${moves.length}`);
    moves.filter((m: any) => m.kind === "follow").forEach((m: any) => enqueueNode(m.objectIri));
  };

  // Planner loop
  for (let step = 0; step < MAX_STEPS; step++) {
    const summary = { classes, nodes: nodes.size, pending: queue.length, stepsTaken: step };
    const action = await planner(question, summary);
    if (action.action === "answer") {
      steps.push("planner -> answer");
      log("Planner chose answer");
      break;
    }
    if (action.action === "listClasses") {
      await callListClasses();
    } else if (action.action === "listIriByClass") {
      const classIri = action.args?.classIri ?? DEFAULT_CLASS;
      await callListIriByClass(String(classIri));
    } else if (action.action === "open_and_moves") {
      const target = action.args?.focusIri ? String(action.args.focusIri) : queue.shift();
      if (target) {
        const maxEdges = Math.min(
          Number(action.args?.maxEdges ?? MAX_EDGES_PER_NODE) || MAX_EDGES_PER_NODE,
          MAX_EDGES_PER_NODE,
        );
        await callOpenAndMoves(target, maxEdges);
      } else {
        log("open_and_moves skipped (no target)");
      }
    }
  }

  // Class sweep
  log(`Post-planner summary: classes=${classes.length}, nodes=${nodes.size}, queue=${queue.length}`);
  if (!classes.length) await callListClasses();
  const classList = classes.length ? classes : [DEFAULT_CLASS];
  log(`Sweeping classes (${classList.length}): ${classList.join(", ")}`);
  for (const c of classList) {
    if (nodes.size + queue.length >= MAX_NODES) break;
    await callListIriByClass(c);
  }
  log(`Queue before opens: ${queue.length}`);
  while (queue.length && nodes.size < MAX_NODES) {
    const iri = queue.shift()!;
    await callOpenAndMoves(iri, MAX_EDGES_PER_NODE);
  }

  const firstNode = nodes.size ? Array.from(nodes.values())[0] : undefined;
  const factsObj: Facts = {
    focus: firstNode?.iri ?? "",
    nodes: Array.from(nodes.values()),
    classes,
    steps,
  };

  const facts = JSON.stringify(factsObj, null, 2);
  log(`FACTS nodes=${factsObj.nodes.length}, classes=${factsObj.classes.length}, steps=${factsObj.steps.length}`);
  factsObj.nodes.forEach((n) => {
    log(`node ${lastSegment(n.iri)} edges=${n.edges.length} complete=${n.complete_outgoing} truncated=${n.edges_truncated}`);
  });
  log(`LLM input (trimmed 1k): ${facts.substring(0, 1000)}${facts.length > 1000 ? "..." : ""}`);
  const llm = await answerWithLLM(question, factsObj, log);

  await client.close();
  log("Closed MCP client");
  return { facts, llm };
}
