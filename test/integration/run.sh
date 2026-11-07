#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="${SMOKE_REPO:-}"
if [ -z "$work" ]; then
  work="${TMPDIR:-/tmp}/gitstudio-fixture-$$"
  mkdir -p "$work"
  cd "$work"
  git init -q -b main
  git config user.email smoke@example.com
  git config user.name Smoke
  printf 'base\n' > README.md
  printf 'a\n' > a.txt
  git add . && git commit -qm base
  mkdir sub && printf 'sub\n' > sub/b.txt
  git add . && git commit -qm sub
  printf 'third\n' >> a.txt
  git commit -qam third
  git checkout -qb feature
  printf 'feature\n' > feature.txt
  git add feature.txt && git commit -qm feature
  git checkout -q main
  printf 'fourth\n' >> a.txt
  git commit -qam fourth
  printf 'stash\n' >> a.txt
  git stash push -qm 'smoke stash'
  git init -q --bare origin.git
  git remote add origin "$work/origin.git"
  git push -qu origin main
fi
tmp="${TMPDIR:-/tmp}/gitstudio-smoke-$$"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT
code_bin="${CODE_BIN:-code}"
"$code_bin" \
  --extensionDevelopmentPath="$root" \
  --extensionTestsPath="$root/test/integration/smoke.js" \
  --user-data-dir="$tmp/user" \
  --extensions-dir="$tmp/ext" \
  --folder-uri="file://$work" \
  --disable-gpu \
  --disable-workspace-trust \
  --skip-welcome \
  --skip-release-notes \
  --no-sandbox
