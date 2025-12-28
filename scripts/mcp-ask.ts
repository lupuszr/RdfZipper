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
    // Heuristic fallback: open and list moves on Alice
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

async function main(): Promise<void> {
  const program = new Command();
  program.option('-q, --question <text>', 'Natural language question');
  program.parse(process.argv);
  const { question = '' } = program.opts<{ question?: string }>();

  if (!question.trim()) {
    console.error('Please provide a question with -q/--question (e.g., "Who is the father of Alice?")');
    process.exit(1);
  }

  const planResult = await plan(question);
  const focusIri = typeof planResult.args?.focusIri === 'string' ? planResult.args.focusIri : iriFromName('Alice');

  const transport = new StdioClientTransport({ command: SERVER_CMD, args: SERVER_ARGS, stderr: 'ignore' });
  const client = new Client({ name: 'guardian-zipper-client', version: '0.1.0' });
  await client.connect(transport);

  // Open at focus
  const openRes = await client.callTool({ name: 'open', arguments: { focusIri } });
  const openData = safeJson(firstText(openRes));
  const cursorId = openData?.cursorId;
  if (!cursorId) throw new Error('cursorId missing from open response');

  // Fetch moves
  const movesRes = await client.callTool({ name: 'moves', arguments: { cursorId } });
  const movesData = safeJson(firstText(movesRes));
  const moves = Array.isArray(movesData?.moves) ? movesData.moves : [];

  // Identify parents and ancestors
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

  const facts = {
    focus: focusIri,
    parents,
    ancestors
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
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
    const answer = resp.choices[0]?.message?.content?.trim() ?? 'No answer';
    console.log(answer);
  } else {
    console.log('No OPENAI_API_KEY set; showing extracted facts:');
    console.log(JSON.stringify(facts, null, 2));
  }

  await client.close();
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
