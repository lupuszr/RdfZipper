import blessed from 'blessed';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OpenAI } from 'openai';
import { Command } from 'commander';

const SERVER_CMD = 'npx';
const SERVER_ARGS = ['tsx', 'src/mcp/server.ts'];
const DEFAULT_FOCUS_BASE = 'https://example.org/guardian#';
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

function iriFromName(name: string): string {
  return `${DEFAULT_FOCUS_BASE}${name}`;
}

function lastSegment(iri: string): string {
  const m = iri.match(/[^/#]+$/);
  return m ? m[0] : iri;
}

function firstText(res: any): string | undefined {
  const content = (res as any)?.content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0] as any;
  return typeof first?.text === 'string' ? first.text : undefined;
}

function safeJson(text?: string): any {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function plan(question: string): Promise<{ tool: string; args: Record<string, unknown> }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { tool: 'open_and_moves', args: { focusIri: iriFromName('Alice') } };
  }

  const client = new OpenAI({ apiKey });
  const system = `You are a planner that chooses ONE MCP tool to call. Output ONLY JSON like {"tool":"open_and_moves","args":{"focusIri":"https://example.org/guardian#Alice"}}.
Allowed tools:
- open_and_moves: args focusIri (IRI string)
- listClasses: args limit (int optional)
- listIriByClass: args classIri (IRI string), limit (int optional)
- ping: args {}
No free-form text. No extra fields.`;

  const user = `Question: ${question}
Default focus candidates: Alice, Bob, Carol, Dave (guardian namespace). If asking about relationships of a person, pick open_and_moves with that person's IRI.`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0
  });

  const text = resp.choices[0]?.message?.content?.trim();
  const parsed = safeJson(text);
  if (parsed && typeof parsed.tool === 'string' && parsed.args) return parsed as any;
  return { tool: 'open_and_moves', args: { focusIri: iriFromName('Alice') } };
}

async function answerWithLLM(question: string, facts: any): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return `No OPENAI_API_KEY set; facts: ${JSON.stringify(facts, null, 2)}`;

  const oa = new OpenAI({ apiKey });
  const system = `You are a concise assistant. Answer the user question using ONLY the provided facts. Do not invent data. If the facts do not contain the answer, say you cannot determine from the provided facts.`;
  const userContent = `Question: ${question}\nFacts: ${JSON.stringify(facts, null, 2)}`;
  const resp = await oa.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent }
    ],
    temperature: 0
  });
  return resp.choices[0]?.message?.content?.trim() ?? 'No answer';
}

async function run(question: string, log: (line: string) => void): Promise<string> {
  log(`Question: ${question}`);

  const planResult = await plan(question);
  const focusIri = typeof planResult.args?.focusIri === 'string' ? planResult.args.focusIri : iriFromName('Alice');
  log(`Planner chose focus: ${focusIri}`);

  const transport = new StdioClientTransport({ command: SERVER_CMD, args: SERVER_ARGS, stderr: 'ignore' });
  const client = new Client({ name: 'guardian-zipper-client', version: '0.1.0' });
  await client.connect(transport);
  log('Connected to MCP server');

  const openRes = await client.callTool({ name: 'open', arguments: { focusIri } });
  const openData = safeJson(firstText(openRes));
  const cursorId = openData?.cursorId;
  if (!cursorId) throw new Error('cursorId missing from open response');
  log(`Opened cursor: ${cursorId}`);

  const movesRes = await client.callTool({ name: 'moves', arguments: { cursorId } });
  const movesData = safeJson(firstText(movesRes));
  const moves = Array.isArray(movesData?.moves) ? movesData.moves : [];
  log(`Moves retrieved: ${moves.length}`);
  if (moves.length) {
    log('Moves detail:');
    log(JSON.stringify(moves, null, 2));
  }

  const parents = Array.from(
    new Set(
      moves
        .filter((m: any) => m.predicateIri === `${DEFAULT_FOCUS_BASE}hasParent` && m.objectIri)
        .map((m: any) => m.objectIri as string)
    )
  );
  const ancestors = Array.from(
    new Set(
      moves
        .filter((m: any) => m.predicateIri === `${DEFAULT_FOCUS_BASE}hasAncestor` && m.objectIri)
        .map((m: any) => m.objectIri as string)
    )
  );

  log(`Parents: ${parents.map((p) => lastSegment(String(p))).join(', ') || 'none'}`);
  log(`Ancestors: ${ancestors.map((a) => lastSegment(String(a))).join(', ') || 'none'}`);

  const facts = { focus: focusIri, parents, ancestors };
  const answer = await answerWithLLM(question, facts);

  await client.close();
  log('Closed MCP client');
  return answer;
}

async function main(): Promise<void> {
  const program = new Command();
  program.option('-q, --question <text>', 'Natural language question');
  program.parse(process.argv);
  const { question = '' } = program.opts<{ question?: string }>();

  const screen = blessed.screen({ smartCSR: true, title: 'MCP Ask TUI' });
  const logBox = blessed.box({
    label: 'Steps',
    top: 0,
    left: 0,
    width: '70%',
    height: '100%-3',
    tags: true,
    border: 'line',
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    vi: true,
    scrollbar: { ch: ' ' }
  });

  const answerBox = blessed.box({
    label: 'Answer',
    top: 0,
    right: 0,
    width: '30%',
    height: '100%-3',
    tags: true,
    border: 'line',
    scrollable: true,
    keys: true,
    mouse: true,
    vi: true,
    scrollbar: { ch: ' ' }
  });

  const input = blessed.textbox({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    inputOnFocus: true,
    border: 'line',
    label: 'Question (Enter to run, q to quit)'
  });

  screen.append(logBox);
  screen.append(answerBox);
  screen.append(input);

  let lines: string[] = [];
  const log = (line: string) => {
    const time = new Date().toISOString().split('T')[1].replace('Z', '');
    lines.push(`{gray-fg}[${time}]{/gray-fg} ${line}`);
    logBox.setContent(lines.join('\n'));
    logBox.setScrollPerc(100);
    screen.render();
  };

  screen.key(['q', 'C-c'], () => process.exit(0));

  let running = false;
  const runQuestion = async (q: string) => {
    if (running) return;
    running = true;
    lines = [];
    logBox.setContent('');
    answerBox.setContent('');
    screen.render();
    try {
      log('Starting...');
      const answer = await run(q, log);
      answerBox.setContent(answer);
      log('Done');
    } catch (err: any) {
      answerBox.setContent(`Error: ${err?.message ?? err}`);
      log(`Error: ${err?.message ?? err}`);
    } finally {
      running = false;
      screen.render();
    }
  };

  input.on('submit', async (value) => {
    const q = String(value || '').trim();
    input.clearValue();
    input.focus();
    if (!q) return;
    await runQuestion(q);
  });

  input.focus();
  screen.render();

  // Initial question from CLI (optional)
  if (question) {
    input.setValue(question);
    await runQuestion(question);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
