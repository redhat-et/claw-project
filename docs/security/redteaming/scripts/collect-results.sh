#!/bin/sh
set -eu

namespace="${NAMESPACE:-redteam}"
destination="${1:-results}"
pod=claw-redteam-results

mkdir -p "$destination"
cleanup() {
  oc delete pod "$pod" -n "$namespace" --ignore-not-found >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

oc apply -n "$namespace" -f manifests/results-reader.yaml
oc wait -n "$namespace" --for=condition=Ready "pod/$pod" --timeout=90s
oc cp "$namespace/$pod:/results/results.json" "$destination/results.json"
oc cp "$namespace/$pod:/results/redteam.yaml" "$destination/redteam.yaml"
oc cp "$namespace/$pod:/results/report.md" "$destination/report.md"
printf 'Results copied to %s\n' "$destination"
