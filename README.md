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

## 4) MCP server (stdio)

```bash
npm run mcp:server
```

Exposes zipper-only tools: `open`, `moves`/`refresh`, `applyFollow`, `back`, `listClasses`, `listIriByClass`, `ping`. Defaults to the same allowlist as the TUI (includes `hasAncestor`).

## 5) MCP ask (toy NL → MCP planner)

```bash
npm run mcp:ask -- --question "Who is the grandfather of Alice?"
```

(Required flag: provide a question.)
- Uses a tiny planner: if `OPENAI_API_KEY` is set, it asks the LLM to pick the MCP tool/args and to phrase the answer from extracted facts; otherwise it falls back to a deterministic plan and prints the facts (parents/ancestors).
- Traverses via MCP tools only; no direct SPARQL.

### MCP ask TUI

```bash
npm run mcp:ask:tui -- --question "Who is the father of Alice?"
```

Question flag is optional; you can also launch and type a question in the TUI input.
Shows steps (tool calls, extracted facts) and the final answer (LLM-formatted if `OPENAI_API_KEY` is set; otherwise prints facts).

## 6) Run the TUI

The default allowlist now includes the inference predicates (`https://example.org/guardian#hasAncestor`, `https://example.org/guardian#hasParent`) so inferred ancestor edges are visible when you navigate.

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
