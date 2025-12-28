import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { BlazegraphClient } from '../lib/blazegraph.js';
import { CursorStore, ZipperEngine, type Move } from '../lib/zipper.js';

const DEFAULT_ENDPOINT = process.env.BLAZEGRAPH_ENDPOINT ?? 'http://localhost:8889/blazegraph/namespace/kb/sparql';
const MAX_EDGES_CAP = 200;
const DEFAULT_MAX_EDGES = 50;
const LIST_CAP = 50;

const DEFAULT_ALLOWED = [
  'https://example.org/guardian#age',
  'https://example.org/guardian#hasParent',
  'https://example.org/guardian#hasSpouse',
  'https://example.org/guardian#hasPet',
  'https://example.org/guardian#barks',
  'https://example.org/guardian#speciesName',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  'https://example.org/guardian#hasAncestor'
];

const bg = new BlazegraphClient(DEFAULT_ENDPOINT);
const store = new CursorStore();
const engine = new ZipperEngine(bg, store);

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function getAllowlist(allow?: unknown): string[] | undefined {
  if (!allow) return DEFAULT_ALLOWED;
  if (!Array.isArray(allow)) throw new Error('allow must be an array of IRIs');
  const items = allow.map((a) => String(a)).filter(Boolean);
  return items.length ? Array.from(new Set(items)) : DEFAULT_ALLOWED;
}

function getMaxEdges(maxEdges?: unknown): number {
  if (maxEdges === undefined) return DEFAULT_MAX_EDGES;
  const n = Number(maxEdges);
  if (!Number.isFinite(n) || n <= 0) throw new Error('maxEdges must be a positive number');
  return Math.min(n, MAX_EDGES_CAP);
}

async function listClasses(limit: number): Promise<string[]> {
  const q = `SELECT DISTINCT ?c WHERE { ?s a ?c } ORDER BY STR(?c) LIMIT ${limit}`;
  const res = await bg.query(q);
  return res.results.bindings.map((b) => b['c']?.value).filter(Boolean) as string[];
}

async function listIriByClass(classIri: string, limit: number): Promise<Array<{ iri: string; label?: string }>> {
  const q = `
    SELECT DISTINCT ?s ?label WHERE {
      ?s a <${classIri}> .
      OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label }
    }
    ORDER BY STR(?s)
    LIMIT ${limit}
  `;
  const res = await bg.query(q);
  return res.results.bindings
    .map((b) => {
      const iri = b['s']?.value;
      const label = b['label']?.value;
      if (!iri) return null;
      return label ? { iri, label } : { iri };
    })
    .filter((x): x is { iri: string; label?: string } => x !== null);
}

const server = new McpServer({ name: 'guardian-zipper-mcp', version: '0.1.0' });

server.registerTool(
  'open',
  {
    description: 'Open a zipper cursor at a focus IRI',
    inputSchema: z.object({
      focusIri: z.string(),
      maxEdges: z.number().int().positive().optional(),
      allow: z.array(z.string()).optional()
    })
  },
  async ({ focusIri, maxEdges, allow }) => {
    const cursor = engine.open({
      focusIri,
      maxEdges: getMaxEdges(maxEdges),
      allowedPredicates: getAllowlist(allow)
    });
    return ok({ cursorId: cursor.id, focusIri: cursor.focusIri, trail: cursor.trail });
  }
);

server.registerTool(
  'moves',
  {
    description: 'List ordered moves for a cursor',
    inputSchema: z.object({ cursorId: z.string() })
  },
  async ({ cursorId }) => {
    const { cursor, moves } = await engine.moves(cursorId);
    return ok({ focusIri: cursor.focusIri, trail: cursor.trail, moves });
  }
);

server.registerTool(
  'refresh',
  {
    description: 'Refresh moves for a cursor (alias of moves)',
    inputSchema: z.object({ cursorId: z.string() })
  },
  async ({ cursorId }) => {
    const { cursor, moves } = await engine.moves(cursorId);
    return ok({ focusIri: cursor.focusIri, trail: cursor.trail, moves });
  }
);

server.registerTool(
  'applyFollow',
  {
    description: 'Apply a follow move by moveId',
    inputSchema: z.object({ cursorId: z.string(), moveId: z.string() })
  },
  async ({ cursorId, moveId }) => {
    const { moves } = await engine.moves(cursorId);
    const move = moves.find((m) => m.moveId === moveId);
    if (!move) throw new Error('invalid_move: moveId not found');
    if (move.kind !== 'follow') throw new Error('invalid_move: selected move is not navigable');
    const next = await engine.applyFollow(cursorId, move as Extract<Move, { kind: 'follow' }>);
    return ok({ focusIri: next.focusIri, trail: next.trail, appliedMoveId: moveId });
  }
);

server.registerTool(
  'back',
  {
    description: 'Go back one step in the trail',
    inputSchema: z.object({ cursorId: z.string() })
  },
  async ({ cursorId }) => {
    const next = engine.back(cursorId);
    return ok({ focusIri: next.focusIri, trail: next.trail });
  }
);

server.registerTool(
  'ping',
  {
    description: 'Health check against the SPARQL endpoint',
    inputSchema: z.object({}).optional()
  },
  async () => {
    const q = 'SELECT (COUNT(*) AS ?c) WHERE { ?s ?p ?o } LIMIT 1';
    const res = await bg.query(q);
    const count = res.results.bindings[0]?.['c']?.value ?? '0';
    return ok({ ok: true, endpoint: DEFAULT_ENDPOINT, sampleCount: Number(count) || 0 });
  }
);

server.registerTool(
  'listClasses',
  {
    description: 'List distinct classes present in the graph',
    inputSchema: z.object({ limit: z.number().int().positive().max(LIST_CAP).optional() })
  },
  async ({ limit }) => {
    const classes = await listClasses(Math.min(limit ?? LIST_CAP, LIST_CAP));
    return ok({ classes });
  }
);

server.registerTool(
  'listIriByClass',
  {
    description: 'List IRIs for a given class',
    inputSchema: z.object({
      classIri: z.string(),
      limit: z.number().int().positive().max(LIST_CAP).optional()
    })
  },
  async ({ classIri, limit }) => {
    const items = await listIriByClass(classIri, Math.min(limit ?? LIST_CAP, LIST_CAP));
    return ok({ classIri, items });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
