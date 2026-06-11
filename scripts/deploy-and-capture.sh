#!/usr/bin/env bash
# deploy-and-capture.sh
#
# Runs `vercel deploy` (preview by default; pass --prod to ship prod),
# captures the deployment URL from stdout, writes it to
# `.vercel/last-deploy-url`, and prints it in a large banner at the end.
#
# Usage:
#   ./scripts/deploy-and-capture.sh                  # preview deploy
#   ./scripts/deploy-and-capture.sh --prod           # production deploy
#   ./scripts/deploy-and-capture.sh --prod --yes     # any extra vercel flags
#
# Reads project name from .vercel/project.json so the script works in
# both the Core (contract) and Pulse repos with no edits.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_FILE="$REPO_ROOT/.vercel/project.json"
REPO_FILE="$REPO_ROOT/.vercel/repo.json"

if [[ ! -f "$PROJECT_FILE" && ! -f "$REPO_FILE" ]]; then
  echo "ERROR: neither .vercel/project.json nor .vercel/repo.json found. Run \`vercel link\` first." >&2
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: \`vercel\` CLI not found in PATH." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: \`jq\` not found in PATH (used to read .vercel/*.json)." >&2
  exit 1
fi

# Prefer project.json (classic single-project link); fall back to repo.json
# (new repo-link model, which is what `vercel link` writes for git-managed
# projects). The `.directory == "."` filter picks the project for this repo
# root when repo.json contains multiple entries.
if [[ -f "$PROJECT_FILE" ]]; then
  PROJECT_NAME="$(jq -r '.projectName // .name // empty' "$PROJECT_FILE")"
else
  PROJECT_NAME="$(jq -r '[.projects[] | select(.directory == ".")][0].name // .projects[0].name // empty' "$REPO_FILE")"
fi

if [[ -z "$PROJECT_NAME" ]]; then
  echo "ERROR: could not read project name from .vercel/." >&2
  exit 1
fi

if ! vercel whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in to Vercel. Run \`vercel login\` first." >&2
  exit 1
fi

LOG_FILE="$(mktemp -t vedryx-deploy-XXXXXX.log)"
trap 'rm -f "$LOG_FILE"' EXIT

echo "==> Deploying project: $PROJECT_NAME"
echo "==> Args: $*"
echo "==> Log: $LOG_FILE"
echo ""

# Stream vercel output to both stdout and the log file so we can grep it
# after the deploy completes. `tee` preserves the exit status of vercel
# via PIPESTATUS.
set +e
vercel deploy "$@" 2>&1 | tee "$LOG_FILE"
DEPLOY_EXIT=${PIPESTATUS[0]}
set -e

if [[ $DEPLOY_EXIT -ne 0 ]]; then
  echo "" >&2
  echo "ERROR: \`vercel deploy\` exited with status $DEPLOY_EXIT" >&2
  exit "$DEPLOY_EXIT"
fi

# Vercel prints lines like:
#   https://vedryx-contract-abc123-devwithsmiles-projects.vercel.app
# (preview) or
#   https://vedryxtech.com
# (prod alias confirm). Grab the last https://...vercel.app URL emitted,
# falling back to the last https:// URL if no vercel.app URL appears.
DEPLOY_URL="$(grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' "$LOG_FILE" | tail -n 1 || true)"

if [[ -z "$DEPLOY_URL" ]]; then
  DEPLOY_URL="$(grep -oE 'https://[a-zA-Z0-9._/-]+' "$LOG_FILE" | tail -n 1 || true)"
fi

if [[ -z "$DEPLOY_URL" ]]; then
  echo "ERROR: deploy completed but no URL was captured from stdout." >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/.vercel"
printf '%s\n' "$DEPLOY_URL" > "$REPO_ROOT/.vercel/last-deploy-url"

BAR="$(printf '=%.0s' {1..72})"
echo ""
echo "$BAR"
echo ""
echo "   DEPLOYED: $DEPLOY_URL"
echo ""
echo "   (also written to .vercel/last-deploy-url)"
echo ""
echo "$BAR"
