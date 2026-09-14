#!/usr/bin/env bash
set -euo pipefail

# Rebuild the browser runtime from a pinned Specter tree. Set SPECTER_SRC to an
# already checked-out, clean source tree when iterating locally.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REPO="https://github.com/Schnuartz/specter-diy.git"
SOURCE_SHA="89431c644cc300c55b53220d262a31be02353969"
SPECTER_SRC="${SPECTER_SRC:-$ROOT/.browser-work/specter-diy}"
EMSDK_ENV="${EMSDK_ENV:-$ROOT/.browser-work/emsdk/emsdk_env.sh}"
OUT="$ROOT/builds/Schnuartz/specter-diy/$SOURCE_SHA"

if [[ ! -d "$SPECTER_SRC/.git" ]]; then
  mkdir -p "$(dirname "$SPECTER_SRC")"
  git clone "$SOURCE_REPO" "$SPECTER_SRC"
  git -C "$SPECTER_SRC" checkout "$SOURCE_SHA"
fi
test "$(git -C "$SPECTER_SRC" rev-parse HEAD)" = "$SOURCE_SHA" || {
  echo "Specter checkout is not at the pinned commit $SOURCE_SHA" >&2
  exit 1
}
git -C "$SPECTER_SRC" submodule update --init --recursive

if ! command -v emcc >/dev/null; then
  # A pinned emsdk installation can be supplied outside this repository.
  test -f "$EMSDK_ENV" || { echo "Emscripten 3.1.74 is required" >&2; exit 1; }
  # shellcheck source=/dev/null
  source "$EMSDK_ENV" >/dev/null
fi
test "$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" = 3.1.74 || {
  echo "Expected Emscripten 3.1.74" >&2
  exit 1
}

python3 "$ROOT/browser/patch-source.py" "$SPECTER_SRC"
cat > "$SPECTER_SRC/browser.manifest.py" <<'EOF'
freeze('f469-disco/usermods/udisplay_f469/display_unixport')
freeze('f469-disco/libs/common')
freeze('src')
EOF
# This older MicroPython records a stack marker from a local variable by design.
# Modern GCC diagnoses that pattern as dangling-pointer; keep other warnings fatal.
make -C "$SPECTER_SRC/f469-disco/micropython/mpy-cross" -j4 \
  CFLAGS_EXTRA=-Wno-error=dangling-pointer

# The older MicroPython makefiles do not track a changed frozen manifest or
# Emscripten link flags reliably. Rebuild the dedicated browser target.
if [[ "${BROWSER_CLEAN:-1}" = 1 ]]; then
  make -C "$SPECTER_SRC/f469-disco/micropython/ports/unix" \
    BUILD=build-specter-web-browser PROG=micropython.js clean
fi
rm -f "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.js" \
  "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.wasm" \
  "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.data"

make -C "$SPECTER_SRC/f469-disco/micropython/ports/unix" -j4 \
  DEBUG="${BROWSER_DEBUG:-0}" \
  BUILD=build-specter-web-browser PROG=micropython.js \
  CC=emcc LD=emcc AR=emar STRIP=true SIZE=true \
  MICROPY_PY_BTREE=0 MICROPY_PY_FFI=0 MICROPY_PY_SOCKET=0 \
  MICROPY_PY_THREAD=0 MICROPY_PY_TERMIOS=0 MICROPY_PY_USSL=0 \
  MICROPY_USE_READLINE=1 \
  USER_C_MODULES="$SPECTER_SRC/f469-disco/usermods" \
  FROZEN_MANIFEST="$SPECTER_SRC/browser.manifest.py" \
  CFLAGS_EXTRA="-DMICROPY_NLR_SETJMP=1 -DMICROPY_PY_UCRYPTOLIB=1 -DMICROPY_SSL_AXTLS=1 -Wno-error -sUSE_SDL=2 -ffile-prefix-map=$SPECTER_SRC=/specter-diy ${BROWSER_NLR_FLAGS:-} ${BROWSER_CFLAGS_DEBUG:-}" \
  LDFLAGS_ARCH= \
  LDFLAGS_EXTRA="-sUSE_SDL=2 ${BROWSER_ASYNCIFY_FLAGS:--sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536} -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=0 -sSTACK_SIZE=${BROWSER_STACK_SIZE:-8388608} -sEXPORTED_RUNTIME_METHODS=FS,ccall --preload-file $ROOT/browser/runtime@/browser -Wl,--allow-multiple-definition ${BROWSER_NLR_FLAGS:-} ${BROWSER_LINK_DEBUG:-}"

python3 "$ROOT/browser/normalize-glue.py" "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.js"
mkdir -p "$OUT"
cp "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.js" "$OUT/"
cp "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.wasm" "$OUT/"
cp "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.data" "$OUT/"
python3 "$ROOT/browser/write-manifest.py" "$SPECTER_SRC" "$OUT" "Schnuartz/specter-diy"
echo "Browser artifacts: $OUT"
