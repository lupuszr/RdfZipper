import { BlazegraphClient } from '../src/lib/blazegraph.js';

const endpoint = process.env.BLAZEGRAPH_ENDPOINT ?? 'http://localhost:8889/blazegraph/namespace/kb/sparql';

const bg = new BlazegraphClient(endpoint);

await bg.update('CLEAR ALL');
console.log('OK: cleared all triples');
