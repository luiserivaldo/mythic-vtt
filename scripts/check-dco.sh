#!/usr/bin/env bash
# Fails if a commit in <base>..<head> lacks a Signed-off-by line whose email matches the commit's
# author or committer. Merge commits are skipped. An optional third argument excludes commits
# already reachable from that ref (used for develop -> main, whose commits were checked earlier).
set -euo pipefail

base=${1:?usage: check-dco.sh <base> <head> [exclude-ref]}
head=${2:?usage: check-dco.sh <base> <head> [exclude-ref]}
range=("$base..$head")
if [ -n "${3:-}" ]; then range+=("^$3"); fi

fail=0
checked=0
while read -r sha; do
  [ -z "$sha" ] && continue
  checked=$((checked + 1))
  author=$(git log -1 --format='%ae' "$sha")
  committer=$(git log -1 --format='%ce' "$sha")
  ok=0
  while IFS= read -r email; do
    [ -z "$email" ] && continue
    email=$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')
    if [ "$email" = "$(printf '%s' "$author" | tr '[:upper:]' '[:lower:]')" ] \
      || [ "$email" = "$(printf '%s' "$committer" | tr '[:upper:]' '[:lower:]')" ]; then
      ok=1
    fi
  done < <(git log -1 --format='%B' "$sha" | sed -n 's/^[Ss]igned-off-by: .* <\(.*@.*\)>[[:space:]]*$/\1/p')
  if [ "$ok" -eq 0 ]; then
    echo "::error::Commit ${sha:0:10} has no Signed-off-by line matching its author or committer email. See CONTRIBUTING.md (Developer Certificate of Origin)."
    fail=1
  fi
done < <(git rev-list --no-merges "${range[@]}")

echo "Checked $checked commit(s)."
exit "$fail"
