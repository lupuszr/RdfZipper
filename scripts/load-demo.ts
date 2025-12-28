import { BlazegraphClient } from '../src/lib/blazegraph.js';

const endpoint = process.env.BLAZEGRAPH_ENDPOINT ?? 'http://localhost:8889/blazegraph/namespace/kb/sparql';
const bg = new BlazegraphClient(endpoint);

const insert = `
PREFIX :      <https://example.org/guardian#>
PREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl:   <http://www.w3.org/2002/07/owl#>
PREFIX xsd:   <http://www.w3.org/2001/XMLSchema#>

INSERT DATA {
  # schema
  :Person a owl:Class .
  :Animal a owl:Class .

  :age a owl:DatatypeProperty ; rdfs:domain :Person ; rdfs:range xsd:integer .
  :hasParent a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :Person .
  :hasSpouse a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :Person ; a owl:SymmetricProperty .
  :hasPet a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :Animal .

  :barks a owl:DatatypeProperty ; rdfs:domain :Animal ; rdfs:range xsd:boolean .
  :speciesName a owl:DatatypeProperty ; rdfs:domain :Animal ; rdfs:range xsd:string .

  # instances
  :Alice a :Person ; :age 30 ; :hasSpouse :Bob ; :hasParent :Carol ; :hasPet :Fido .
  :Bob   a :Person ; :age 32 ; :hasSpouse :Alice ; :hasParent :Dave  ; :hasPet :Hank .
  :Carol a :Person ; :age 55 .
  :Dave  a :Person ; :age 60 .

  :Fido a :Animal ; :barks true ; :speciesName "dog" .
  :Hank a :Animal ; :barks true ; :speciesName "hyena" .
}
`;

await bg.update('CLEAR ALL');
await bg.update(insert);

console.log('OK: loaded demo triples into Blazegraph');
console.log('Tip: run `npm run tui` (default focus is https://example.org/guardian#Alice)');
