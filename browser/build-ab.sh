#!/usr/bin/env bash
set -euo pipefail

# Build one user-requested, already-resolved GitHub revision. The caller must
# provide a repository and a full commit SHA; no branch names reach this script.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOSITORY="${1:?repository owner/name required}"
COMMIT="${2:?commit SHA required}"
ADAPTER="${3:?adapter diy|mockui required}"

case "$REPOSITORY" in
  */specter-diy)
    test "$ADAPTER" = diy
    SOURCE_REPO_OVERRIDE="https://github.com/$REPOSITORY.git" \
      SPECTER_SOURCE_SHA="$COMMIT" \
      bash "$ROOT/browser/build-browser.sh"
    ;;
  k9ert/specter-playground)
    test "$ADAPTER" = mockui
    SOURCE_SHA_OVERRIDE="$COMMIT" bash "$ROOT/browser/build-playground-mockui.sh" k9ert
    OUTPUT_REPOSITORY="$REPOSITORY-mockui"
    ;;
  schnuartz-ai/specter-playground)
    test "$ADAPTER" = mockui
    SOURCE_SHA_OVERRIDE="$COMMIT" bash "$ROOT/browser/build-playground-mockui.sh" play-fast
    OUTPUT_REPOSITORY="$REPOSITORY-mockui"
    ;;
  Schnuartz/specter-playground)
    test "$ADAPTER" = mockui
    SOURCE_SHA_OVERRIDE="$COMMIT" bash "$ROOT/browser/build-playground-mockui.sh" schnuartz
    OUTPUT_REPOSITORY="$REPOSITORY-mockui"
    ;;
  schnuartz-ai/specter-playground-schnuartz)
    test "$ADAPTER" = mockui
    SOURCE_SHA_OVERRIDE="$COMMIT" bash "$ROOT/browser/build-playground-mockui.sh" schnuartz-alternative
    OUTPUT_REPOSITORY="$REPOSITORY-mockui"
    ;;
  */specter-playground)
    test "$ADAPTER" = mockui
    AB_REPOSITORY="$REPOSITORY" SOURCE_SHA_OVERRIDE="$COMMIT" \
      bash "$ROOT/browser/build-playground-mockui.sh" generic
    OUTPUT_REPOSITORY="$REPOSITORY-mockui"
    ;;
  *) echo "Unsupported Specter repository: $REPOSITORY" >&2; exit 2 ;;
esac

ARTIFACT_ROOT="${AB_ARTIFACT_ROOT:-$ROOT/builds}"
echo "$ARTIFACT_ROOT/${OUTPUT_REPOSITORY:-$REPOSITORY}/$COMMIT"
