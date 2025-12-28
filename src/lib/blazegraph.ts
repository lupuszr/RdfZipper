export type SparqlBindingValue = {
  type: 'uri' | 'literal' | 'bnode' | string;
  value: string;
  datatype?: string;
  'xml:lang'?: string;
};

export type SparqlJsonResults = {
  head: { vars: string[] };
  results: { bindings: Record<string, SparqlBindingValue>[] };
};

export class BlazegraphClient {
  constructor(readonly endpoint: string) {}

  /**
   * Blazegraph supports SPARQL Protocol; urlencoded `query=` is the most compatible.
   */
  async query(sparql: string): Promise<SparqlJsonResults> {
    const body = new URLSearchParams({ query: sparql }).toString();
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        accept: 'application/sparql-results+json'
      },
      body
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SPARQL query failed (${res.status} ${res.statusText}): ${text}`);
    }

    const json = (await res.json()) as SparqlJsonResults;
    return json;
  }

  /**
   * SPARQL Update via urlencoded `update=`.
   */
  async update(sparqlUpdate: string): Promise<void> {
    const body = new URLSearchParams({ update: sparqlUpdate }).toString();
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
      },
      body
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SPARQL update failed (${res.status} ${res.statusText}): ${text}`);
    }
  }
}
