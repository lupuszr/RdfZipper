import blessed from 'blessed';
import { Command } from 'commander';
import { BlazegraphClient } from './lib/blazegraph.js';
import { CursorStore, ZipperEngine, type Move } from './lib/zipper.js';
import { shortenIri, termToDisplay } from './lib/util.js';

const DEFAULT_ENDPOINT = 'http://localhost:8889/blazegraph/namespace/kb/sparql';
const DEFAULT_FOCUS = 'https://example.org/guardian#Alice';

const DEFAULT_ALLOWED = [
  'https://example.org/guardian#age',
  'https://example.org/guardian#hasParent',
  'https://example.org/guardian#hasSpouse',
  'https://example.org/guardian#hasPet',
  'https://example.org/guardian#barks',
  'https://example.org/guardian#speciesName',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  'https://example.org/guardian#hasAncestor',
  'https://example.org/guardian#hasParent'
];

const program = new Command();
program
  .name('guardian-zipper-tui')
  .option('--endpoint <url>', 'Blazegraph SPARQL endpoint', process.env.BLAZEGRAPH_ENDPOINT ?? DEFAULT_ENDPOINT)
  .option('--focus <iri>', 'Start focus IRI', DEFAULT_FOCUS)
  .option('--max-edges <n>', 'Max edges to list per focus', (v) => Number(v), 50)
  .option('--allow-all', 'Disable predicate allowlist (show all outgoing edges)', false)
  .option('--allow <csv>', 'Comma-separated list of allowed predicate IRIs')
  .parse(process.argv);

const opts = program.opts();

const endpoint: string = opts.endpoint;
const focusIri: string = opts.focus;
const maxEdges: number = Number.isFinite(opts.maxEdges) ? opts.maxEdges : 50;
const allowAll: boolean = !!opts.allowAll;

const allowedPredicates: string[] | undefined = allowAll
  ? undefined
  : (typeof opts.allow === 'string' && opts.allow.trim().length > 0
      ? opts.allow.split(',').map((s: string) => s.trim()).filter(Boolean)
      : DEFAULT_ALLOWED);

const bg = new BlazegraphClient(endpoint);
const store = new CursorStore();
const engine = new ZipperEngine(bg, store);

const cursor = engine.open({ focusIri, maxEdges, allowedPredicates });

// ---- UI ----

const screen = blessed.screen({
  smartCSR: true,
  title: 'Guardian Zipper POC'
});

const header = blessed.box({
  top: 0,
  left: 0,
  height: 3,
  width: '100%',
  tags: true,
  border: 'line',
  style: { border: { fg: 'cyan' } }
});

const footer = blessed.box({
  bottom: 0,
  left: 0,
  height: 3,
  width: '100%',
  tags: true,
  border: 'line',
  style: { border: { fg: 'cyan' } }
});

const log = blessed.log({
  bottom: 3,
  left: 0,
  height: 7,
  width: '100%',
  border: 'line',
  label: ' log ',
  tags: true,
  scrollable: true,
  alwaysScroll: true,
  style: { border: { fg: 'cyan' } }
});

const list = blessed.list({
  top: 3,
  left: 0,
  height: '100%-13',
  width: '60%',
  keys: true,
  vi: true,
  mouse: true,
  border: 'line',
  label: ' outgoing edges ',
  style: {
    border: { fg: 'cyan' },
    selected: { bg: 'blue' }
  }
});

const detail = blessed.box({
  top: 3,
  left: '60%',
  height: '100%-13',
  width: '40%',
  border: 'line',
  label: ' detail ',
  tags: true,
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  style: { border: { fg: 'cyan' } }
});

screen.append(header);
screen.append(list);
screen.append(detail);
screen.append(log);
screen.append(footer);

footer.setContent(
  '{bold}Enter{/bold}=follow  {bold}b{/bold}=back  {bold}r{/bold}=refresh  {bold}q{/bold}=quit'
);

let lastMoves: Move[] = [];
let isRefreshing = false;

function setHeader(): void {
  const c = store.get(cursor.id);
  const trail = c.trail.map(f => `${shortenIri(f.from)} -[${shortenIri(f.viaPredicate)}]->`).join(' ');
  header.setContent(
    `{bold}endpoint{/bold}: ${endpoint}\n` +
      `{bold}focus{/bold}: ${c.focusIri}\n` +
      `{bold}trail{/bold}: ${trail || '(empty)'}`
  );
}

function setDetailForMove(m?: Move): void {
  if (!m) {
    detail.setContent('');
    return;
  }
  if (m.kind === 'follow') {
    detail.setContent(
      `{bold}move{/bold}: ${m.moveId}\n` +
        `{bold}kind{/bold}: follow\n` +
        `{bold}predicate{/bold}: ${m.predicateIri}\n` +
        `{bold}object{/bold}: ${m.objectIri}\n\n` +
        `Press {bold}Enter{/bold} to follow.`
    );
    return;
  }

  detail.setContent(
    `{bold}move{/bold}: ${m.moveId}\n` +
      `{bold}kind{/bold}: show\n` +
      `{bold}predicate{/bold}: ${m.predicateIri}\n` +
      `{bold}object{/bold}: ${termToDisplay(m.object)}\n\n` +
      `This is a literal / bnode; it is not navigable.`
  );
}

function syncDetailFromSelection(): void {
  const idx = typeof list.selected === 'number' ? list.selected : 0;
  const m = lastMoves[idx];
  setDetailForMove(m);
}

async function refresh(): Promise<void> {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    setHeader();
    list.setItems(['(loading…)']);
    screen.render();

    const { moves } = await engine.moves(cursor.id);
    lastMoves = moves;

    if (moves.length === 0) {
      list.setItems(['(no outgoing edges under policy)']);
      setDetailForMove(undefined);
      return;
    }

    list.setItems(moves.map(m => m.label));
    list.select(0);
    setDetailForMove(moves[0]);
  } catch (e) {
    log.log(`{red-fg}ERROR{/red-fg}: ${(e as Error).message}`);
    list.setItems(['(error)']);
  } finally {
    setHeader();
    isRefreshing = false;
    screen.render();
  }
}

// Blessed event names differ between element types/versions.
// Update the detail panel deterministically by reacting to navigation keys.
list.on('keypress', (_ch, key) => {
  if (!key) return;
  const names = new Set(['up', 'down', 'k', 'j', 'pageup', 'pagedown', 'home', 'end']);
  if (!names.has(key.name)) return;
  setImmediate(() => {
    syncDetailFromSelection();
    screen.render();
  });
});

list.on('click', () => {
  setImmediate(() => {
    syncDetailFromSelection();
    screen.render();
  });
});

screen.key(['q', 'C-c'], () => process.exit(0));

screen.key(['r'], async () => {
  log.log('refresh');
  await refresh();
});

screen.key(['b'], async () => {
  const before = store.get(cursor.id);
  engine.back(cursor.id);
  const after = store.get(cursor.id);
  if (before.focusIri === after.focusIri) {
    log.log('back: (at root)');
  } else {
    log.log(`back: ${shortenIri(before.focusIri)} → ${shortenIri(after.focusIri)}`);
  }
  await refresh();
});

screen.key(['enter'], async () => {
  const idx = list.selected;
  const m = lastMoves[idx];
  if (!m) return;

  if (m.kind !== 'follow') {
    log.log('enter: selected edge is not navigable');
    return;
  }

  const before = store.get(cursor.id);
  await engine.applyFollow(cursor.id, m);
  const after = store.get(cursor.id);
  log.log(`follow: ${shortenIri(before.focusIri)} -[${shortenIri(m.predicateIri)}]-> ${shortenIri(after.focusIri)}`);
  await refresh();
});

// initial render
log.log('starting…');
await refresh();
list.focus();
screen.render();
