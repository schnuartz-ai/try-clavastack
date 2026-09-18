#!/usr/bin/env bash
set -euo pipefail

# Rebuild the browser runtime from the latest Specter tree. Set
# SPECTER_SOURCE_SHA when a reproducible historical build is needed, or set
# SPECTER_SRC to an already checked-out source tree when iterating locally.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REPO="${SOURCE_REPO_OVERRIDE:-https://github.com/cryptoadvance/specter-diy.git}"
SOURCE_BRANCH="${SPECTER_SOURCE_BRANCH:-master}"
SOURCE_SHA="${SPECTER_SOURCE_SHA:-}"
AB_WORK_ROOT="${AB_WORK_ROOT:-$ROOT/.browser-work}"
SPECTER_SRC="${SPECTER_SRC:-$AB_WORK_ROOT/specter-diy}"
EMSDK_ENV="${EMSDK_ENV:-$AB_WORK_ROOT/emsdk/emsdk_env.sh}"

if [[ ! -d "$SPECTER_SRC/.git" ]]; then
  mkdir -p "$(dirname "$SPECTER_SRC")"
  git clone --branch "$SOURCE_BRANCH" "$SOURCE_REPO" "$SPECTER_SRC"
else
  git -C "$SPECTER_SRC" remote set-url origin "$SOURCE_REPO"
fi

# Resolve the upstream branch on every build. The generated artifacts remain
# immutable and are addressed by this resolved commit, so the current pointe
# can safely move to the newest tested firmware.
if [[ -z "$SOURCE_SHA" ]]; then
  SOURCE_SHA="$(git ls-remote "$SOURCE_REPO" "refs/heads/$SOURCE_BRANCH" | awk 'NR == 1 {print $1}')"
  if [[ -z "$SOURCE_SHA" ]]; then
    echo "Could not resolve latest Specter commit on $SOURCE_BRANCH" >&2
    exit 1
  fi
fi
git -C "$SPECTER_SRC" fetch --force origin "$SOURCE_SHA"
git -C "$SPECTER_SRC" checkout --force "$SOURCE_SHA"
if [[ "$(git -C "$SPECTER_SRC" rev-parse HEAD)" != "$SOURCE_SHA" ]]; then
  echo "Specter checkout did not reach $SOURCE_SHA" >&2
  exit 1
fi
REPOSITORY_PATH="${SOURCE_REPO#https://github.com/}"
REPOSITORY_PATH="${REPOSITORY_PATH%.git}"
ARTIFACT_ROOT="${AB_ARTIFACT_ROOT:-$ROOT/builds}"
OUT="$ARTIFACT_ROOT/$REPOSITORY_PATH/$SOURCE_SHA"
git -C "$SPECTER_SRC" submodule update --init --recursive

if ! command -v emcc >/dev/null; then
  # A pinned emsdk installation can be supplied outside this repository.
  if [[ ! -f "$EMSDK_ENV" ]]; then
    EMSDK_DIR="$(dirname "$EMSDK_ENV")"
    mkdir -p "$(dirname "$EMSDK_DIR")"
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
    "$EMSDK_DIR/emsdk" install 3.1.74
    "$EMSDK_DIR/emsdk" activate 3.1.74
  fi
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
freeze('browser-freeze/common')
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

# Asyncify can leave thousands of non-overlapping locals in each function.
# Coalesce them before publishing: Android workers have a much smaller native
# call stack than desktop workers. Increasing -sSTACK_SIZE does not fix that.
WASM_OPT="${WASM_OPT:-$(dirname "$(command -v emcc)")/../bin/wasm-opt}"
python3 "$ROOT/browser/optimize-wasm.py" \
  "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.wasm" "$WASM_OPT"

python3 "$ROOT/browser/normalize-glue.py" "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.js"
mkdir -p "$OUT"
cp "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.js" "$OUT/"
cp "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.wasm" "$OUT/"
cp "$SPECTER_SRC/f469-disco/micropython/ports/unix/micropython.data" "$OUT/"
BROWSER_WASM_OPTIMIZED=1 python3 "$ROOT/browser/write-manifest.py" "$SPECTER_SRC" "$OUT" "$REPOSITORY_PATH"
echo "Browser artifacts: $OUT"
