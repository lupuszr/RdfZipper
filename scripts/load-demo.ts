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
  :City a owl:Class .
  :age a owl:DatatypeProperty ; rdfs:domain :Person ; rdfs:range xsd:integer .
  :jobTitle a owl:DatatypeProperty ; rdfs:domain :Person ; rdfs:range xsd:string .
  :livesIn a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :City .
  :hasResident a owl:ObjectProperty ; owl:inverseOf :livesIn .
  :hasParent a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :Person .
  :hasSpouse a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :Person ; a owl:SymmetricProperty .
  :hasPet a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :Animal .
  :hasDescendant a owl:ObjectProperty ; owl:inverseOf :hasAncestor .
  :barks a owl:DatatypeProperty ; rdfs:domain :Animal ; rdfs:range xsd:boolean .
  :speciesName a owl:DatatypeProperty ; rdfs:domain :Animal ; rdfs:range xsd:string .

  # cities
  :Riverford a :City .
  :Oakridge a :City .
  :Seaview a :City .
  :Hillcrest a :City .
  :Mapleton a :City .
  :Stonebridge a :City .
  :Lakeside a :City .

  # core instances (kept for tests)
  :Alice a :Person ; :age 30 ; :jobTitle "nurse" ; :livesIn :Riverford ; :hasSpouse :Bob ; :hasParent :Dave ; :hasParent :Carol ; :hasPet :Fido .
  :Bob   a :Person ; :age 32 ; :jobTitle "engineer" ; :livesIn :Riverford ; :hasSpouse :Alice ; :hasPet :Hank .
  :Carol a :Person ; :age 55 ; :jobTitle "librarian" ; :livesIn :Riverford ; :hasSpouse :Dave .
  :Dave  a :Person ; :age 60 ; :jobTitle "retired" ; :livesIn :Riverford ; :hasSpouse :Carol ; :hasParent :Eve .
  :Eve   a :Person ; :age 80 ; :jobTitle "retired" ; :livesIn :Riverford .
  :Fido a :Animal ; :barks true ; :speciesName "dog" .
  :Hank a :Animal ; :barks true ; :speciesName "hyena" .

  # Family 1 (Oakridge)
  :Liam_Harris a :Person ; :age 45 ; :jobTitle "civil engineer" ; :livesIn :Oakridge ; :hasSpouse :Nina_Harris ; :hasPet :Rover_Harris .
  :Nina_Harris a :Person ; :age 43 ; :jobTitle "teacher" ; :livesIn :Oakridge ; :hasSpouse :Liam_Harris .
  :Leo_Harris a :Person ; :age 18 ; :jobTitle "student" ; :livesIn :Oakridge ; :hasParent :Liam_Harris ; :hasParent :Nina_Harris .
  :Mia_Harris a :Person ; :age 16 ; :jobTitle "student" ; :livesIn :Oakridge ; :hasParent :Liam_Harris ; :hasParent :Nina_Harris .
  :Rover_Harris a :Animal ; :barks true ; :speciesName "dog" .

  # Family 2 (Seaview)
  :Oliver_Reyes a :Person ; :age 38 ; :jobTitle "chef" ; :livesIn :Seaview ; :hasSpouse :Ava_Reyes ; :hasPet :Coco_Reyes .
  :Ava_Reyes a :Person ; :age 36 ; :jobTitle "graphic designer" ; :livesIn :Seaview ; :hasSpouse :Oliver_Reyes .
  :Isla_Reyes a :Person ; :age 10 ; :jobTitle "student" ; :livesIn :Seaview ; :hasParent :Oliver_Reyes ; :hasParent :Ava_Reyes .
  :Ethan_Reyes a :Person ; :age 8 ; :jobTitle "student" ; :livesIn :Seaview ; :hasParent :Oliver_Reyes ; :hasParent :Ava_Reyes .
  :Coco_Reyes a :Animal ; :barks false ; :speciesName "cat" .

  # Family 3 (Hillcrest)
  :Henry_Clark a :Person ; :age 50 ; :jobTitle "doctor" ; :livesIn :Hillcrest ; :hasSpouse :Evelyn_Clark ; :hasPet :Bolt_Clark .
  :Evelyn_Clark a :Person ; :age 48 ; :jobTitle "lawyer" ; :livesIn :Hillcrest ; :hasSpouse :Henry_Clark .
  :Noah_Clark a :Person ; :age 20 ; :jobTitle "student" ; :livesIn :Hillcrest ; :hasParent :Henry_Clark ; :hasParent :Evelyn_Clark .
  :Chloe_Clark a :Person ; :age 17 ; :jobTitle "student" ; :livesIn :Hillcrest ; :hasParent :Henry_Clark ; :hasParent :Evelyn_Clark .
  :Bolt_Clark a :Animal ; :barks true ; :speciesName "dog" .

  # Family 4 (Mapleton)
  :Logan_Blake a :Person ; :age 42 ; :jobTitle "architect" ; :livesIn :Mapleton ; :hasSpouse :Penelope_Blake ; :hasPet :Sunny_Blake .
  :Penelope_Blake a :Person ; :age 40 ; :jobTitle "pharmacist" ; :livesIn :Mapleton ; :hasSpouse :Logan_Blake .
  :Owen_Blake a :Person ; :age 14 ; :jobTitle "student" ; :livesIn :Mapleton ; :hasParent :Logan_Blake ; :hasParent :Penelope_Blake .
  :Nora_Blake a :Person ; :age 12 ; :jobTitle "student" ; :livesIn :Mapleton ; :hasParent :Logan_Blake ; :hasParent :Penelope_Blake .
  :Sunny_Blake a :Animal ; :barks false ; :speciesName "parrot" .

  # Family 5 (Stonebridge)
  :Jack_Foster a :Person ; :age 47 ; :jobTitle "mechanic" ; :livesIn :Stonebridge ; :hasSpouse :Hazel_Foster ; :hasPet :Bruno_Foster .
  :Hazel_Foster a :Person ; :age 45 ; :jobTitle "accountant" ; :livesIn :Stonebridge ; :hasSpouse :Jack_Foster .
  :Ella_Foster a :Person ; :age 19 ; :jobTitle "student" ; :livesIn :Stonebridge ; :hasParent :Jack_Foster ; :hasParent :Hazel_Foster .
  :Mason_Foster a :Person ; :age 16 ; :jobTitle "student" ; :livesIn :Stonebridge ; :hasParent :Jack_Foster ; :hasParent :Hazel_Foster .
  :Bruno_Foster a :Animal ; :barks true ; :speciesName "dog" .

  # Family 6 (Lakeside)
  :Samuel_Ward a :Person ; :age 52 ; :jobTitle "professor" ; :livesIn :Lakeside ; :hasSpouse :Nova_Ward ; :hasPet :Pebble_Ward .
  :Nova_Ward a :Person ; :age 50 ; :jobTitle "researcher" ; :livesIn :Lakeside ; :hasSpouse :Samuel_Ward .
  :Ivy_Ward a :Person ; :age 15 ; :jobTitle "student" ; :livesIn :Lakeside ; :hasParent :Samuel_Ward ; :hasParent :Nova_Ward .
  :Eli_Ward a :Person ; :age 13 ; :jobTitle "student" ; :livesIn :Lakeside ; :hasParent :Samuel_Ward ; :hasParent :Nova_Ward .
  :Pebble_Ward a :Animal ; :barks false ; :speciesName "turtle" .

  # Family 7 (Seaview extended)
  :Mateo_Rivera a :Person ; :age 35 ; :jobTitle "bartender" ; :livesIn :Seaview ; :hasSpouse :Mila_Rivera ; :hasPet :Storm_Rivera .
  :Mila_Rivera a :Person ; :age 34 ; :jobTitle "nurse" ; :livesIn :Seaview ; :hasSpouse :Mateo_Rivera .
  :Aria_Rivera a :Person ; :age 6 ; :jobTitle "student" ; :livesIn :Seaview ; :hasParent :Mateo_Rivera ; :hasParent :Mila_Rivera .
  :Storm_Rivera a :Animal ; :barks true ; :speciesName "dog" .

  # Family 8 (Oakridge extended)
  :Theodore_Mills a :Person ; :age 44 ; :jobTitle "pilot" ; :livesIn :Oakridge ; :hasSpouse :Ellie_Mills ; :hasPet :Shadow_Mills .
  :Ellie_Mills a :Person ; :age 42 ; :jobTitle "vet" ; :livesIn :Oakridge ; :hasSpouse :Theodore_Mills .
  :Lily_Mills a :Person ; :age 11 ; :jobTitle "student" ; :livesIn :Oakridge ; :hasParent :Theodore_Mills ; :hasParent :Ellie_Mills .
  :Shadow_Mills a :Animal ; :barks true ; :speciesName "dog" .

  # Family 9 (Hillcrest extended)
  :Aiden_Price a :Person ; :age 41 ; :jobTitle "firefighter" ; :livesIn :Hillcrest ; :hasSpouse :Lily_Price ; :hasPet :Maple_Price .
  :Lily_Price a :Person ; :age 39 ; :jobTitle "photographer" ; :livesIn :Hillcrest ; :hasSpouse :Aiden_Price .
  :Rowan_Price a :Person ; :age 9 ; :jobTitle "student" ; :livesIn :Hillcrest ; :hasParent :Aiden_Price ; :hasParent :Lily_Price .
  :Maple_Price a :Animal ; :barks false ; :speciesName "cat" .

  # Family 10 (Mapleton extended)
  :Daniel_Scott a :Person ; :age 46 ; :jobTitle "software developer" ; :livesIn :Mapleton ; :hasSpouse :Aria_Scott ; :hasPet :Pixel_Scott .
  :Aria_Scott a :Person ; :age 44 ; :jobTitle "product manager" ; :livesIn :Mapleton ; :hasSpouse :Daniel_Scott .
  :Hazel_Scott a :Person ; :age 13 ; :jobTitle "student" ; :livesIn :Mapleton ; :hasParent :Daniel_Scott ; :hasParent :Aria_Scott .
  :Pixel_Scott a :Animal ; :barks false ; :speciesName "gecko" .

  # Family 11 (Stonebridge extended)
  :Jacob_Reed a :Person ; :age 37 ; :jobTitle "carpenter" ; :livesIn :Stonebridge ; :hasSpouse :Scarlett_Reed ; :hasPet :Poppy_Reed .
  :Scarlett_Reed a :Person ; :age 35 ; :jobTitle "baker" ; :livesIn :Stonebridge ; :hasSpouse :Jacob_Reed .
  :Liam_Reed a :Person ; :age 7 ; :jobTitle "student" ; :livesIn :Stonebridge ; :hasParent :Jacob_Reed ; :hasParent :Scarlett_Reed .
  :Poppy_Reed a :Animal ; :barks false ; :speciesName "cat" .

  # Family 12 (Lakeside extended)
  :Logan_Young a :Person ; :age 33 ; :jobTitle "data analyst" ; :livesIn :Lakeside ; :hasSpouse :Penelope_Young ; :hasPet :Echo_Young .
  :Penelope_Young a :Person ; :age 32 ; :jobTitle "teacher" ; :livesIn :Lakeside ; :hasSpouse :Logan_Young .
  :Milo_Young a :Person ; :age 4 ; :jobTitle "student" ; :livesIn :Lakeside ; :hasParent :Logan_Young ; :hasParent :Penelope_Young .
  :Echo_Young a :Animal ; :barks true ; :speciesName "dog" .

  # Extended elders
  :Grace_Harris a :Person ; :age 70 ; :jobTitle "retired" ; :livesIn :Oakridge .
  :Liam_Harris :hasParent :Grace_Harris .
  :Nina_Harris :hasParent :Grace_Harris .

  :Victor_Clark a :Person ; :age 75 ; :jobTitle "retired" ; :livesIn :Hillcrest .
  :Henry_Clark :hasParent :Victor_Clark .
  :Evelyn_Clark :hasParent :Victor_Clark .
}
`;

await bg.update('CLEAR ALL');
await bg.update(insert);

const testA = `
PREFIX :    <https://example.org/guardian#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:<http://www.w3.org/2000/01/rdf-schema#>
INSERT DATA {
  :Student rdfs:subClassOf :Person .
  :John rdf:type :Student .
}`;

const testB = `
PREFIX :    <https://example.org/guardian#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:<http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
INSERT DATA {
  :hasParent rdfs:subPropertyOf :hasAncestor .
  :hasAncestor rdf:type owl:TransitiveProperty .
}`;

await bg.update(testA);
await bg.update(testB);
await bg.update('CREATE ENTAILMENTS');

console.log('OK: loaded demo triples into Blazegraph');
console.log('Tip: run `npm run tui` (default focus is https://example.org/guardian#Alice)');
