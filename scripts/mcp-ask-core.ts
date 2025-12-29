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
const DEFAULT_BUDGET_ENV = Number(process.env.MCP_BUDGET);
const DEFAULT_BUDGET = Number.isFinite(DEFAULT_BUDGET_ENV) ? DEFAULT_BUDGET_ENV : 30;
const COST_LIST_CLASSES = 1;
const COST_LIST_IRI_BY_CLASS = 10;
const COST_OPEN_AND_MOVES = 3;

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
  budget?: { total: number; used: number; remaining: number };
};

type PlannerAction =
  | { action: "listClasses"; args?: { limit?: number } }
  | { action: "listIriByClass"; args: { classIri: string; limit?: number } }
  | { action: "open_and_moves"; args: { focusIri?: string; maxEdges?: number } }
  | { action: "answer"; args?: Record<string, unknown> };

async function planner(
  question: string,
  summary: {
    classes: string[];
    nodes: number;
    pending: number;
    stepsTaken: number;
    recentActions: string[];
    actionSummary: string;
    queuePreview: string[];
    budgetTotal: number;
    budgetUsed: number;
    budgetRemaining: number;
  },
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
Available MCP tools (actions map 1:1 to tool calls):
- listClasses(limit?): returns JSON with a "classes" array of IRIs.
- listIriByClass(classIri, limit?): returns JSON with an "items" array; each item has an iri of that class. Default class: ${DEFAULT_CLASS}.
- open_and_moves(focusIri, maxEdges?): runs MCP open then moves to fetch outgoing edges from that node; "follow" moves carry predicateIri/objectIri.
- answer: stop planning and hand off to the answering step.
Constraints and guidance:
- Hard caps: max classes ${MAX_CLASSES}, max nodes ${MAX_NODES}, max edges per node ${MAX_EDGES_PER_NODE}.
- Plan within ${MAX_STEPS} steps total.
- Budget applies: costs -> listClasses=${COST_LIST_CLASSES}, listIriByClass=${COST_LIST_IRI_BY_CLASS}, open_and_moves=${COST_OPEN_AND_MOVES}. Stay within the budget shown in the user summary.
- Do NOT repeat listClasses once classes are populated, unless you expect new classes.
- Avoid calling listIriByClass on the same class twice; move on to opens.
- If there is a non-empty pending queue, prefer open_and_moves until drained or caps reached.
- Use recentActions/actionSummary and queuePreview to avoid redundant calls; skip actions that add no new coverage.
- Stop early with answer if no further useful calls remain.
`;
  const user = `Question: ${question}
Current summary: classes=${summary.classes.length}, nodes=${summary.nodes}, pending=${summary.pending}, stepsTaken=${summary.stepsTaken}, recentActions=${summary.recentActions.join(";")}, actionSummary=${summary.actionSummary}, queuePreview=${summary.queuePreview.join(";")}, budgetTotal=${summary.budgetTotal}, budgetUsed=${summary.budgetUsed}, budgetRemaining=${summary.budgetRemaining}.
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
3) Chain edges aggressively to answer relational questions, but only when the chain is coherent for the SAME entities. Example: to find pets in a City, require City hasResident Person AND that Person hasPet Animal; then the Animal counts as in that City and you must cite BOTH edges. Apply similar chaining for spouses/parents/descendants when implied.
4) If needed info is UNKNOWN or nodes are missing, answer UNKNOWN.
5) IRIs are opaque; do not fabricate labels.
6) Be concise.
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

export async function runAsk(question: string, log: (s: string) => void, opts?: { budget?: number }) {
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
  const listedClasses = new Set<string>();
  const nodes = new Map<string, NodeFact>();
  const queue: string[] = [];
  const steps: string[] = [];
  const actionHistory: string[] = [];

  const budgetTotal = Math.max(0, Math.floor(opts?.budget ?? DEFAULT_BUDGET));
  let budgetUsed = 0;
  const budgetRemaining = () => Math.max(0, budgetTotal - budgetUsed);
  const costForAction = (a: PlannerAction["action"]): number => {
    if (a === "listClasses") return COST_LIST_CLASSES;
    if (a === "listIriByClass") return COST_LIST_IRI_BY_CLASS;
    if (a === "open_and_moves") return COST_OPEN_AND_MOVES;
    return 0;
  };
  const trySpend = (action: PlannerAction["action"], context: string): boolean => {
    const cost = costForAction(action);
    if (cost > budgetRemaining()) {
      steps.push(`budget exhausted before ${context} (cost ${cost})`);
      log(`budget exhausted before ${context} (cost ${cost})`);
      return false;
    }
    budgetUsed += cost;
    steps.push(`budget spend ${action} cost=${cost} remaining=${budgetRemaining()}`);
    log(`budget spend ${action} cost=${cost} remaining=${budgetRemaining()}`);
    return true;
  };

  const questionLc = question.toLowerCase();
  const matchesQuestion = (iri: string) => questionLc.includes(lastSegment(iri).toLowerCase());

  const enqueueNode = (iri: string, priority = false) => {
    if (!nodes.has(iri) && !queue.includes(iri) && nodes.size + queue.length < MAX_NODES) {
      if (priority) {
        queue.unshift(iri);
      } else {
        queue.push(iri);
      }
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
    items.forEach((it: any) => enqueueNode(it.iri, matchesQuestion(it.iri)));
    listedClasses.add(normClass);
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
    const recentActions = actionHistory.slice(-30);
    const actionCounts = recentActions.reduce((acc: Record<string, number>, a) => {
      acc[a] = (acc[a] ?? 0) + 1;
      return acc;
    }, {});
    const actionSummary = Object.entries(actionCounts)
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
    const queuePreview = queue.slice(0, 3);

    const summary = {
      classes,
      nodes: nodes.size,
      pending: queue.length,
      stepsTaken: step,
      recentActions,
      actionSummary,
      queuePreview,
      budgetTotal,
      budgetUsed,
      budgetRemaining: budgetRemaining(),
    };
    let action = await planner(question, summary);
    const lastAction = actionHistory[actionHistory.length - 1];

    const overrideToOpenOrAnswer = (reason: string): void => {
      const fallback: PlannerAction["action"] = queue.length ? "open_and_moves" : "answer";
      steps.push(`planner override (${reason}) -> ${fallback}`);
      log(`planner override (${reason}) -> ${fallback}`);
      action = fallback === "open_and_moves" ? { action: "open_and_moves", args: {} } : { action: "answer", args: {} };
    };

    if (action.action === "listClasses" && classes.length > 0) {
      overrideToOpenOrAnswer("listClasses already done");
    }

    if (action.action === "listIriByClass") {
      const classIri = String(action.args?.classIri ?? DEFAULT_CLASS);
      if (listedClasses.has(classIri)) {
        overrideToOpenOrAnswer(`class already listed ${classIri}`);
      }
    }

    if (lastAction === action.action && action.action !== "open_and_moves") {
      overrideToOpenOrAnswer("repeat action");
    }

    const actionCost = costForAction(action.action);
    if (action.action !== "answer" && actionCost > budgetRemaining()) {
      steps.push(`budget exhausted before ${action.action} (cost ${actionCost}) -> answer`);
      log(`budget exhausted before ${action.action} (cost ${actionCost}) -> answer`);
      action = { action: "answer", args: {} };
    }

    if (action.action === "answer") {
      steps.push("planner -> answer");
      log("Planner chose answer");
      actionHistory.push(action.action);
      break;
    }

    let executed = false;
    if (action.action === "listClasses") {
      if (!trySpend("listClasses", "listClasses")) {
        actionHistory.push(action.action);
        break;
      }
      await callListClasses();
      executed = true;
    } else if (action.action === "listIriByClass") {
      if (!trySpend("listIriByClass", "listIriByClass")) {
        actionHistory.push(action.action);
        break;
      }
      const classIri = action.args?.classIri ?? DEFAULT_CLASS;
      await callListIriByClass(String(classIri));
      executed = true;
    } else if (action.action === "open_and_moves") {
      const target = action.args?.focusIri ? String(action.args.focusIri) : queue.shift();
      if (!target) {
        log("open_and_moves skipped (no target)");
      } else {
        if (!trySpend("open_and_moves", "open_and_moves")) {
          actionHistory.push(action.action);
          break;
        }
        const maxEdges = Math.min(
          Number(action.args?.maxEdges ?? MAX_EDGES_PER_NODE) || MAX_EDGES_PER_NODE,
          MAX_EDGES_PER_NODE,
        );
        await callOpenAndMoves(target, maxEdges);
        executed = true;
      }
    }

    if (budgetRemaining() <= 0) {
      steps.push("budget exhausted; stopping opens");
      log("budget exhausted; stopping opens");
      actionHistory.push(action.action);
      break;
    }

    if (executed) {
      actionHistory.push(action.action);
    }
  }

  // Class sweep
  log(`Post-planner summary: classes=${classes.length}, nodes=${nodes.size}, queue=${queue.length}`);
  if (!classes.length) {
    if (!trySpend("listClasses", "listClasses sweep")) {
      log("budget exhausted before listClasses sweep");
    } else {
      await callListClasses();
    }
  }
  const classList = (classes.length ? classes : [DEFAULT_CLASS]).slice().sort((a, b) => {
    if (a === DEFAULT_CLASS) return -1;
    if (b === DEFAULT_CLASS) return 1;
    const aGuardian = a.startsWith(DEFAULT_FOCUS_BASE);
    const bGuardian = b.startsWith(DEFAULT_FOCUS_BASE);
    if (aGuardian && !bGuardian) return -1;
    if (!aGuardian && bGuardian) return 1;
    return a.localeCompare(b);
  });
  log(`Sweeping classes (${classList.length}): ${classList.join(", ")}`);
  for (const c of classList) {
    if (nodes.size + queue.length >= MAX_NODES) break;
    if (!trySpend("listIriByClass", `listIriByClass(${c})`)) {
      log("budget exhausted during class sweep");
      break;
    }
    await callListIriByClass(c);
  }
  log(`Queue before opens: ${queue.length}`);
  const relationKeywords = ["father", "mother", "parent", "spouse", "husband", "wife", "pet", "child", "kid", "descendant"];
  const questionNeedsRelations = relationKeywords.some((kw) => questionLc.includes(kw));
  let openedTarget = false;
  while (queue.length && nodes.size < MAX_NODES) {
    if (!trySpend("open_and_moves", "open_and_moves queue")) {
      log("budget exhausted before opening queue");
      break;
    }
    const iri = queue.shift()!;
    await callOpenAndMoves(iri, MAX_EDGES_PER_NODE);
    if (matchesQuestion(iri)) {
      openedTarget = true;
    }
    if (openedTarget && questionNeedsRelations) {
      log("Early stop after opening target(s) relevant to question");
      break;
    }
    if (budgetRemaining() <= 0) {
      log("budget exhausted during opens");
      break;
    }
  }
  const firstNode = nodes.size ? Array.from(nodes.values())[0] : undefined;
  const factsObj: Facts = {
    focus: firstNode?.iri ?? "",
    nodes: Array.from(nodes.values()),
    classes,
    steps,
    budget: { total: budgetTotal, used: budgetUsed, remaining: budgetRemaining() },
  };

  const facts = JSON.stringify(factsObj, null, 2);
  log(
    `FACTS nodes=${factsObj.nodes.length}, classes=${factsObj.classes.length}, steps=${factsObj.steps.length}, budget=${factsObj.budget?.remaining}/${factsObj.budget?.total}`,
  );
  factsObj.nodes.forEach((n) => {
    log(`node ${lastSegment(n.iri)} edges=${n.edges.length} complete=${n.complete_outgoing} truncated=${n.edges_truncated}`);
  });
  log(`LLM input (trimmed 1k): ${facts.substring(0, 1000)}${facts.length > 1000 ? "..." : ""}`);
  const llm = await answerWithLLM(question, factsObj, log);

  await client.close();
  log("Closed MCP client");
  return { facts, llm };
}
