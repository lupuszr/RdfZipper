# Guardian Zipper POC (TypeScript + Blazegraph + TUI)

This POC demonstrates a **zipper-style deterministic graph browser** over an RDF store (Blazegraph):
- Cursor/state lives **outside** RDF (in the client process).
- All navigation is **bounded + deterministic** (stable ordering, caps).
- The UI only lets you choose from enumerated next moves (no free-form SPARQL).

## Requirements
- Node.js >= 18
- Docker + Docker Compose

## 1) Build + start Blazegraph (local image, Apple Silicon ready)

We build a local image from the bundled `blazegraph.jar` (Java 11, arm64-safe).

```bash
npm i
docker compose build blazegraph   # or let npm run blazegraph:up build it
npm run blazegraph:up
```

- Heap is controlled via `JAVA_OPTS` in `docker-compose.yml` (default `-Xmx2g`).
- Blazegraph should be reachable at:

```
http://localhost:8889/blazegraph/namespace/kb/sparql
```

Apple Silicon (M1/M2/M3) users: the official Blazegraph image is amd64-only. The compose file pins `platform: linux/amd64`, so Docker Desktop will use emulation automatically. If you prefer per-command, run:

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 npm run blazegraph:up
```

## 2) Load demo data + entailments

```bash
npm run demo:load
```

## 3) Inference smoke test

```bash
./scripts/inference_smoke_test.sh
```

If it fails with a namespace mismatch, delete any persisted Blazegraph journal/volume and recreate the namespace (the properties must match the expected axioms/quads/truthMaintenance settings).

## 4) Run the TUI

The default allowlist now includes the inference predicates (`urn:test#hasAncestor`, `urn:test#hasParent`) so inferred ancestor edges are visible when you navigate.

```bash
npm run tui
```

### Keys
- **↑/↓**: select edge
- **Enter**: follow edge (only if object is IRI)
- **b**: back
- **r**: refresh
- **q**: quit

## Notes
- Set a different SPARQL endpoint:

```bash
BLAZEGRAPH_ENDPOINT=http://localhost:8889/blazegraph/namespace/kb/sparql npm run tui
```

- Default start focus is `https://example.org/guardian#Alice`.
  Override:

```bash
npm run tui -- --focus https://example.org/guardian#Bob
```
