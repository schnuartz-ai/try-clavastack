#!/usr/bin/env bash
set -euo pipefail

# The Playground wallet Python still calls LVGL's classic API. Freeze its
# unchanged src tree against the compatible Specter DIY Unix/LVGL platform.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  k9ert)
    REPOSITORY=k9ert/specter-playground
    SOURCE_SHA=2b5c1acf95e4ba4b5faa04a07c64cf8164d65ce4 ;;
  schnuartz)
    REPOSITORY=schnuartz-ai/specter-playground-schnuartz
    SOURCE_SHA=c553caf1edbedfbe7c4161408518b315d31cfc51 ;;
  *) echo "Usage: $0 k9ert|schnuartz" >&2; exit 2 ;;
esac
PLATFORM_SHA=eb8397d2b53bfe43cec0571f8efa235aa352d8ec
FORK_SRC="${FORK_SRC:-$ROOT/.browser-work/${REPOSITORY#*/}}"
PLATFORM_SRC="${PLATFORM_SRC:-$ROOT/.browser-work/specter-diy}"
EMSDK_ENV="${EMSDK_ENV:-$ROOT/.browser-work/emsdk/emsdk_env.sh}"
OUT="$ROOT/builds/$REPOSITORY/$SOURCE_SHA"

if [[ ! -d "$FORK_SRC/.git" ]]; then
  mkdir -p "$(dirname "$FORK_SRC")"
  git clone "https://github.com/$REPOSITORY.git" "$FORK_SRC"
  git -C "$FORK_SRC" checkout "$SOURCE_SHA"
fi
test "$(git -C "$FORK_SRC" rev-parse HEAD)" = "$SOURCE_SHA" || {
  echo "Playground checkout must be at $SOURCE_SHA" >&2; exit 1;
}
if [[ ! -d "$PLATFORM_SRC/.git" ]]; then
  mkdir -p "$(dirname "$PLATFORM_SRC")"
  git clone --recursive https://github.com/schnuartz-ai/specter-diy.git "$PLATFORM_SRC"
  git -C "$PLATFORM_SRC" checkout "$PLATFORM_SHA"
fi
test "$(git -C "$PLATFORM_SRC" rev-parse HEAD)" = "$PLATFORM_SHA" || {
  echo "LVGL platform checkout must be at $PLATFORM_SHA" >&2; exit 1;
}
git -C "$PLATFORM_SRC" submodule update --init --recursive

if ! command -v emcc >/dev/null; then
  test -f "$EMSDK_ENV" || { echo "Emscripten 3.1.74 required" >&2; exit 1; }
  source "$EMSDK_ENV" >/dev/null
fi
test "$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" = 3.1.74

python3 "$ROOT/browser/patch-source.py" "$PLATFORM_SRC"
ln -sfn "$FORK_SRC/src" "$PLATFORM_SRC/browser_fork_src"
cat > "$PLATFORM_SRC/browser.manifest.py" <<'EOF'
freeze('f469-disco/usermods/udisplay_f469/display_unixport')
freeze('f469-disco/libs/common')
freeze('browser_fork_src')
EOF
make -C "$PLATFORM_SRC/f469-disco/micropython/mpy-cross" -j4
if [[ "${BROWSER_CLEAN:-1}" = 1 ]]; then
  make -C "$PLATFORM_SRC/f469-disco/micropython/ports/unix" \
    BUILD=build-specter-web-browser PROG=micropython.js clean
fi
rm -f "$PLATFORM_SRC/f469-disco/micropython/ports/unix"/micropython.{js,wasm,data}
make -C "$PLATFORM_SRC/f469-disco/micropython/ports/unix" -j4 \
  DEBUG="${BROWSER_DEBUG:-0}" \
  BUILD=build-specter-web-browser PROG=micropython.js \
  CC=emcc LD=emcc AR=emar STRIP=true SIZE=true \
  MICROPY_PY_BTREE=0 MICROPY_PY_FFI=0 MICROPY_PY_SOCKET=0 \
  MICROPY_PY_THREAD=0 MICROPY_PY_TERMIOS=0 MICROPY_PY_USSL=0 \
  MICROPY_USE_READLINE=1 \
  USER_C_MODULES="$PLATFORM_SRC/f469-disco/usermods" \
  FROZEN_MANIFEST="$PLATFORM_SRC/browser.manifest.py" \
  CFLAGS_EXTRA="-DMICROPY_NLR_SETJMP=1 -DMICROPY_PY_UCRYPTOLIB=1 -DMICROPY_SSL_AXTLS=1 -Wno-error -sUSE_SDL=2 -ffile-prefix-map=$PLATFORM_SRC=/specter-platform -ffile-prefix-map=$FORK_SRC=/specter-playground ${BROWSER_CFLAGS_DEBUG:-}" \
  LDFLAGS_ARCH= \
  LDFLAGS_EXTRA="-sUSE_SDL=2 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=0 -sSTACK_SIZE=8388608 -sEXPORTED_RUNTIME_METHODS=FS,ccall --preload-file $ROOT/browser/runtime@/browser -Wl,--allow-multiple-definition ${BROWSER_LINK_DEBUG:-}"

python3 "$ROOT/browser/normalize-glue.py" "$PLATFORM_SRC/f469-disco/micropython/ports/unix/micropython.js"
mkdir -p "$OUT"
cp "$PLATFORM_SRC/f469-disco/micropython/ports/unix"/micropython.{js,wasm,data} "$OUT/"
python3 "$ROOT/browser/write-manifest.py" "$FORK_SRC" "$OUT" "$REPOSITORY" "$PLATFORM_SHA"
echo "Browser artifacts: $OUT"
