import { randomUUID } from 'node:crypto';
import type { BlazegraphClient, SparqlBindingValue } from './blazegraph.js';
import { isIri, stableLexKey, termToDisplay } from './util.js';

export type Frame = {
  from: string;
  viaPredicate: string;
};

export type Cursor = {
  id: string;
  focusIri: string;
  trail: Frame[];
  createdAt: number;
  // fixed parameters ("policy") for determinism / bounds
  maxEdges: number;
  allowedPredicates?: string[]; // full IRIs
};

export type Move =
  | {
      kind: 'follow';
      moveId: string;
      predicateIri: string;
      objectIri: string;
      label: string;
    }
  | {
      kind: 'show';
      moveId: string;
      predicateIri: string;
      object: SparqlBindingValue;
      label: string;
    };

export class CursorStore {
  private readonly cursors = new Map<string, Cursor>();

  createCursor(init: Omit<Cursor, 'id' | 'createdAt'>): Cursor {
    const cursor: Cursor = {
      ...init,
      id: randomUUID(),
      createdAt: Date.now()
    };
    this.cursors.set(cursor.id, cursor);
    return cursor;
  }

  get(cursorId: string): Cursor {
    const c = this.cursors.get(cursorId);
    if (!c) throw new Error(`unknown cursor: ${cursorId}`);
    return c;
  }

  set(cursor: Cursor): void {
    this.cursors.set(cursor.id, cursor);
  }
}

export class ZipperEngine {
  constructor(
    private readonly bg: BlazegraphClient,
    private readonly store: CursorStore
  ) {}

  open(params: { focusIri: string; maxEdges?: number; allowedPredicates?: string[] }): Cursor {
    const maxEdges = params.maxEdges ?? 50;
    const allowedPredicates = params.allowedPredicates?.length ? [...params.allowedPredicates] : undefined;

    return this.store.createCursor({
      focusIri: params.focusIri,
      trail: [],
      maxEdges,
      allowedPredicates
    });
  }

  async moves(cursorId: string): Promise<{ cursor: Cursor; moves: Move[] }>
  {
    const cursor = this.store.get(cursorId);

    const filter = cursor.allowedPredicates?.length
      ? `FILTER(?p IN (${cursor.allowedPredicates.map(p => `<${p}>`).join(', ')}))`
      : '';

    const q = `
      SELECT ?p ?o WHERE {
        <${cursor.focusIri}> ?p ?o .
        ${filter}
      }
      ORDER BY STR(?p) STR(?o)
      LIMIT ${cursor.maxEdges}
    `;

    const res = await this.bg.query(q);

    const moves: Move[] = res.results.bindings
      .map((row) => {
        const p = row['p'];
        const o = row['o'];
        if (!p || !o) return null;

        const predicateIri = p.value;
        if (isIri(o)) {
          const objectIri = o.value;
          return {
            kind: 'follow' as const,
            moveId: '',
            predicateIri,
            objectIri,
            label: `${stableLabel(predicateIri)} → ${stableLabel(objectIri)}`
          };
        }
        return {
          kind: 'show' as const,
          moveId: '',
          predicateIri,
          object: o,
          label: `${stableLabel(predicateIri)} → ${termToDisplay(o)}`
        };
      })
      .filter((x): x is Move => x !== null);

    // stable move IDs based on sorted order (the SPARQL ORDER BY is the primary stability guarantee)
    for (let i = 0; i < moves.length; i++) {
      moves[i] = { ...moves[i], moveId: `m${i}` } as Move;
    }

    return { cursor, moves };
  }

  async applyFollow(cursorId: string, move: Extract<Move, { kind: 'follow' }>): Promise<Cursor> {
    const cursor = this.store.get(cursorId);

    const next: Cursor = {
      ...cursor,
      focusIri: move.objectIri,
      trail: [...cursor.trail, { from: cursor.focusIri, viaPredicate: move.predicateIri }]
    };

    this.store.set(next);
    return next;
  }

  back(cursorId: string): Cursor {
    const cursor = this.store.get(cursorId);
    if (cursor.trail.length === 0) return cursor;

    const last = cursor.trail[cursor.trail.length - 1];
    const next: Cursor = {
      ...cursor,
      focusIri: last.from,
      trail: cursor.trail.slice(0, -1)
    };

    this.store.set(next);
    return next;
  }
}

function stableLabel(iri: string): string {
  return stableLexKey(iri).split('#').pop() ?? iri;
}
