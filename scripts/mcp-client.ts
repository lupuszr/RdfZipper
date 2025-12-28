import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_CMD = 'npx';
const SERVER_ARGS = ['tsx', 'src/mcp/server.ts'];

async function main(): Promise<void> {
  const transport = new StdioClientTransport({ command: SERVER_CMD, args: SERVER_ARGS });
  const client = new Client({ name: 'guardian-zipper-client', version: '0.1.0' });

  await client.connect(transport);

  const tools = await client.listTools();
  console.log('tools:', JSON.stringify(tools, null, 2));

  const openRes = await client.callTool({ name: 'open', arguments: { focusIri: 'https://example.org/guardian#Alice' } });
  console.log('open:', JSON.stringify(openRes, null, 2));
  const openData = safeJson(firstText(openRes));
  const cursorId = openData?.cursorId;
  if (!cursorId) throw new Error('cursorId missing from open response');

  const movesRes = await client.callTool({ name: 'moves', arguments: { cursorId } });
  console.log('moves:', JSON.stringify(movesRes, null, 2));
  const movesData = safeJson(firstText(movesRes));
  const moves = Array.isArray(movesData?.moves) ? movesData.moves : [];

  const classesRes = await client.callTool({ name: 'listClasses', arguments: { limit: 20 } });
  console.log('listClasses:', JSON.stringify(classesRes, null, 2));

  const iriRes = await client.callTool({ name: 'listIriByClass', arguments: { classIri: 'https://example.org/guardian#Person', limit: 20 } });
  console.log('listIriByClass:', JSON.stringify(iriRes, null, 2));

  const followMove = moves.find((m: any) => m.kind === 'follow');
  if (followMove) {
    const followRes = await client.callTool({ name: 'applyFollow', arguments: { cursorId, moveId: followMove.moveId } });
    console.log('applyFollow:', JSON.stringify(followRes, null, 2));
  }

  await client.close();
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
  } catch (e) {
    return undefined;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
