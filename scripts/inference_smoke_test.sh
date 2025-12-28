#!/usr/bin/env bash
set -euo pipefail

ENDPOINT=${BLAZEGRAPH_ENDPOINT:-http://localhost:8889/blazegraph/namespace/kb/sparql}
BASE=${ENDPOINT%/sparql}
ROOT=${ROOT_URL:-http://localhost:8889/blazegraph}
NS=kb

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

# Fetch namespace properties and validate expected config
prop_resp=$(curl -sS -w "\n%{http_code}" "${ROOT}/namespace/${NS}/properties") || fail "unable to fetch namespace properties"
prop_body=${prop_resp%$'\n'*}
prop_code=${prop_resp##*$'\n'}
if [[ "${prop_code}" != "200" ]]; then
  fail "namespace properties fetch failed (HTTP ${prop_code}); delete persisted journal/volume or recreate namespace"
fi

grep_prop() {
  echo "${prop_body}" | grep -E "^$1=" | head -n1 | cut -d'=' -f2-
}

quads=$(grep_prop "com.bigdata.rdf.store.AbstractTripleStore.quads")
tm=$(grep_prop "com.bigdata.rdf.sail.truthMaintenance")
axioms=$(grep_prop "com.bigdata.rdf.store.AbstractTripleStore.axiomsClass")

if [[ "${quads}" != "false" || "${tm}" != "true" || "${axioms}" != "com.bigdata.rdf.axioms.OwlAxioms" ]]; then
  echo "Namespace properties:" >&2
  echo "  quads=${quads}" >&2
  echo "  truthMaintenance=${tm}" >&2
  echo "  axiomsClass=${axioms}" >&2
  fail "namespace properties mismatch; delete persisted journal/volume or recreate namespace"
fi

# Force entailments materialization
curl -sS -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "update=CREATE ENTAILMENTS" \
  "${BASE}" >/dev/null

ask() {
  local query="$1"
  local expect="$2"
  resp=$(curl -sS -H "Accept: application/sparql-results+json" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "query=${query}" \
    "${BASE}")
  python - <<'PY' "$resp" "$expect"
import json, sys
resp=sys.argv[1]
expect=sys.argv[2].lower()=='true'
data=json.loads(resp)
val=data.get('boolean')
if val is None:
    print('Invalid ASK response', file=sys.stderr)
    sys.exit(1)
if val!=expect:
    print(f"ASK mismatch: got {val}, expected {expect}", file=sys.stderr)
    sys.exit(1)
PY
}

ask 'ASK { <https://example.org/guardian#John> a <https://example.org/guardian#Person> }' true
ask 'ASK { <https://example.org/guardian#John> a <https://example.org/guardian#NonPerson> }' false
ask 'ASK { <https://example.org/guardian#Alice> <https://example.org/guardian#hasAncestor> <https://example.org/guardian#Dave> }' true
ask 'ASK { <https://example.org/guardian#Alice> <https://example.org/guardian#hasAncestor> <https://example.org/guardian#Eve> }' false

echo "OK: inference smoke test passed"
