#!/usr/bin/env bash
set -euo pipefail

# Build the real LVGL 9 MockUI application used by the legacy Playground VNC
# services. The old src/main.py wallet is deliberately not frozen here.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  k9ert) REPOSITORY=k9ert/specter-playground; SOURCE_SHA=2b5c1acf95e4ba4b5faa04a07c64cf8164d65ce4 ;;
  schnuartz) REPOSITORY=schnuartz-ai/specter-playground-schnuartz; SOURCE_SHA=5d3e5ba2f667d035bd2375b370fb6fc7c33da458 ;;
  *) echo "Usage: $0 k9ert|schnuartz" >&2; exit 2 ;;
esac
FORK_SRC="${FORK_SRC:-$ROOT/.browser-work/${REPOSITORY#*/}}"
EMSDK_ENV="${EMSDK_ENV:-$ROOT/.browser-work/emsdk/emsdk_env.sh}"
OUT="$ROOT/builds/${REPOSITORY}-mockui/$SOURCE_SHA"
if [[ ! -d "$FORK_SRC/.git" ]]; then
  mkdir -p "$(dirname "$FORK_SRC")"
  git clone --recursive "https://github.com/$REPOSITORY.git" "$FORK_SRC"
  git -C "$FORK_SRC" checkout "$SOURCE_SHA"
fi
test "$(git -C "$FORK_SRC" rev-parse HEAD)" = "$SOURCE_SHA" || { echo "Wrong fork commit" >&2; exit 1; }
git -C "$FORK_SRC" submodule update --init --recursive

apply_if_needed() {
  local repo="$1" patch="$2"
  local top prefix
  top="$(git -C "$repo" rev-parse --show-toplevel)"
  if [[ "$top" = "$repo" ]]; then
    if git -C "$repo" apply --reverse --check "$patch" 2>/dev/null; then return; fi
    git -C "$repo" apply "$patch"
  else
    # Schnuartz vendors these sources; apply relative to the containing Git
    # root so git apply cannot silently ignore all paths from a subdirectory.
    prefix="${repo#"$top"/}"
    [[ "$prefix" != "$repo" ]] || { echo "Patch path is outside Git root: $repo" >&2; exit 1; }
    if git -C "$top" apply --directory="$prefix" --reverse --check "$patch" 2>/dev/null; then return; fi
    git -C "$top" apply --directory="$prefix" "$patch"
  fi
}
apply_if_needed "$FORK_SRC/f469-disco/micropython" "$ROOT/browser/v9-patches/micropython.patch"
apply_if_needed "$FORK_SRC/f469-disco/usermods" "$ROOT/browser/v9-patches/usermods.patch"
apply_if_needed "$FORK_SRC/f469-disco/usermods/secp256k1" "$ROOT/browser/v9-patches/secp256k1.patch"
if [[ "$1" = schnuartz ]]; then
  python3 "$ROOT/browser/patch-playground-qstr.py" "$FORK_SRC/f469-disco/micropython"
fi

if ! command -v emcc >/dev/null; then
  test -f "$EMSDK_ENV" || { echo "Emscripten 3.1.74 required" >&2; exit 1; }
  source "$EMSDK_ENV" >/dev/null
fi
test "$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" = 3.1.74

make -C "$FORK_SRC" build-i18n
if [[ "$1" = k9ert ]]; then make -C "$FORK_SRC" build-themes; fi
python3 "$ROOT/browser/prepare-mockui.py" "$FORK_SRC"
make -C "$FORK_SRC/f469-disco/micropython/mpy-cross" -j4

PORT="$FORK_SRC/f469-disco/micropython/ports/unix"
if [[ "${BROWSER_CLEAN:-1}" = 1 ]]; then
  make -C "$PORT" BUILD=build-specter-mockui-browser PROG=micropython.js clean
fi
make -C "$PORT" -j4 \
  BUILD=build-specter-mockui-browser PROG=micropython.js \
  CC=emcc LD=emcc AR=emar STRIP=true SIZE=true \
  MICROPY_PY_BTREE=0 MICROPY_PY_FFI=0 MICROPY_PY_SOCKET=0 \
  MICROPY_PY_THREAD=0 MICROPY_PY_TERMIOS=0 MICROPY_PY_USSL=0 \
  MICROPY_USE_READLINE=1 \
  USER_C_MODULES="$FORK_SRC/f469-disco/usermods" \
  FROZEN_MANIFEST="$FORK_SRC/browser.manifest.py" \
  CFLAGS_EXTRA="-DMICROPY_NLR_SETJMP=1 -DMODULE_DISPLAY_ENABLED=1 -DMODULE_HASHLIB_ENABLED=1 -DMICROPY_PY_HASHLIB=0 -DSTATIC=static -Wno-error -sUSE_SDL=2 -ffile-prefix-map=$FORK_SRC=/specter-playground" \
  LDFLAGS_ARCH= \
  LDFLAGS_EXTRA="-sUSE_SDL=2 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=0 -sSTACK_SIZE=8388608 -sEXPORTED_RUNTIME_METHODS=FS,ccall --preload-file $ROOT/browser/runtime@/browser --preload-file $FORK_SRC/build/flash_image@/flash -Wl,--allow-multiple-definition"

python3 "$ROOT/browser/normalize-glue.py" "$PORT/build-specter-mockui-browser/micropython.js"
mkdir -p "$OUT"
cp "$PORT/build-specter-mockui-browser"/micropython.{js,wasm,data} "$OUT/"
python3 "$ROOT/browser/write-manifest.py" "$FORK_SRC" "$OUT" "$REPOSITORY" mockui
echo "MockUI browser artifacts: $OUT"
