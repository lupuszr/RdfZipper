import type { SparqlBindingValue } from './blazegraph.js';

export function isIri(v: SparqlBindingValue): boolean {
  return v.type === 'uri';
}

export function termToDisplay(v: SparqlBindingValue): string {
  if (v.type === 'uri') return shortenIri(v.value);
  if (v.type === 'bnode') return `_:${v.value}`;
  // literal
  if (v.datatype) return `"${v.value}"^^${shortenIri(v.datatype)}`;
  if (v['xml:lang']) return `"${v.value}"@${v['xml:lang']}`;
  return `"${v.value}"`;
}

export function shortenIri(iri: string): string {
  // Heuristic: keep fragment or last path segment
  const hash = iri.lastIndexOf('#');
  if (hash >= 0 && hash < iri.length - 1) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  if (slash >= 0 && slash < iri.length - 1) return iri.slice(slash + 1);
  return iri;
}

export function stableLexKey(x: string): string {
  // normalize to avoid locale variance
  return x.normalize('NFKC');
}
