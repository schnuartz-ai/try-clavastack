#!/usr/bin/env bash
set -euo pipefail

# Build the real LVGL 9 MockUI application used by the legacy Playground VNC
# services. The old src/main.py wallet is deliberately not frozen here.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  generic)
    REPOSITORY="${AB_REPOSITORY:?AB_REPOSITORY is required for generic Playground builds}"
    SOURCE_BRANCH=${SOURCE_BRANCH_OVERRIDE:-main}
    SOURCE_SHA=${SOURCE_SHA_OVERRIDE:-}
    POINTER_NAME="" ;;
  k9ert)
    REPOSITORY=k9ert/specter-playground
    SOURCE_BRANCH=${SOURCE_BRANCH_OVERRIDE:-main}
    SOURCE_SHA=${SOURCE_SHA_OVERRIDE:-}
    POINTER_NAME=variants/specter-playground.json ;;
  play-fast)
    REPOSITORY=schnuartz-ai/specter-playground
    SOURCE_BRANCH=${SOURCE_BRANCH_OVERRIDE:-main}
    SOURCE_SHA=${SOURCE_SHA_OVERRIDE:-}
    POINTER_NAME=variants/specter-playground-fast.json ;;
  schnuartz)
    REPOSITORY=Schnuartz/specter-playground
    SOURCE_BRANCH=${SOURCE_BRANCH_OVERRIDE:-main}
    SOURCE_SHA=${SOURCE_SHA_OVERRIDE:-}
    POINTER_NAME=variants/specter-playground-schnuartz.json ;;
  schnuartz-alternative)
    REPOSITORY=schnuartz-ai/specter-playground-schnuartz
    SOURCE_BRANCH=${SOURCE_BRANCH_OVERRIDE:-main}
    SOURCE_SHA=${SOURCE_SHA_OVERRIDE:-}
    POINTER_NAME=variants/specter-playground-schnuartz-alternative.json ;;
  *) echo "Usage: $0 k9ert|play-fast|schnuartz|schnuartz-alternative" >&2; exit 2 ;;
esac
# Both forks use the repository name `specter-playground`; include the owner
# so a clean build cannot accidentally reuse the other fork's checkout.
CHECKOUT_KEY="${REPOSITORY//\//-}"
if [[ "${1:-}" = schnuartz-alternative ]]; then CHECKOUT_KEY+="-alternative"; fi
AB_WORK_ROOT="${AB_WORK_ROOT:-$ROOT/.browser-work}"
FORK_SRC="${FORK_SRC:-$AB_WORK_ROOT/$CHECKOUT_KEY}"
EMSDK_ENV="${EMSDK_ENV:-$AB_WORK_ROOT/emsdk/emsdk_env.sh}"
if [[ ! -e "$FORK_SRC/.git" ]]; then
  mkdir -p "$(dirname "$FORK_SRC")"
  git clone --branch "$SOURCE_BRANCH" "https://github.com/$REPOSITORY.git" "$FORK_SRC"
else
  git -C "$FORK_SRC" remote set-url origin "https://github.com/$REPOSITORY.git"
fi
if [[ -z "$SOURCE_SHA" ]]; then
  SOURCE_SHA="$(git ls-remote "https://github.com/$REPOSITORY.git" "refs/heads/$SOURCE_BRANCH" | awk 'NR == 1 {print $1}')"
  if [[ -z "$SOURCE_SHA" ]]; then
    echo "Could not resolve latest $REPOSITORY commit on $SOURCE_BRANCH" >&2
    exit 1
  fi
fi
git -C "$FORK_SRC" fetch --force origin "$SOURCE_SHA"
git -C "$FORK_SRC" checkout --force "$SOURCE_SHA"
test "$(git -C "$FORK_SRC" rev-parse HEAD)" = "$SOURCE_SHA" || { echo "Wrong fork commit" >&2; exit 1; }
ARTIFACT_ROOT="${AB_ARTIFACT_ROOT:-$ROOT/builds}"
OUT="$ARTIFACT_ROOT/${REPOSITORY}-mockui/$SOURCE_SHA"
# Only the firmware build inputs are needed here.  A fully recursive checkout
# also downloads every optional MicroPython port library, which makes a clean
# browser build unnecessarily slow and can leave it stuck in unrelated git
# metadata operations.
if [[ "${SKIP_SUBMODULE_UPDATE:-0}" != 1 ]]; then
  git -C "$FORK_SRC" submodule update --init bootloader f469-disco
fi
if [[ "${SKIP_SUBMODULE_UPDATE:-0}" != 1 ]] && [[ -e "$FORK_SRC/f469-disco/.git" ]] && git -C "$FORK_SRC/f469-disco" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$FORK_SRC/f469-disco" submodule update --init \
    micropython usermods/secp256k1 usermods/udisplay_f469/lvgl
  # The bundled uhashlib user module uses axTLS' AES implementation.  Other
  # MicroPython port libraries are disabled by the flags below and are not
  # build inputs for this browser target.
  git -C "$FORK_SRC/f469-disco/micropython" submodule update --init \
    lib/axtls lib/mbedtls lib/micropython-lib
  # secp256k1-embedded vendors the actual cryptography library as another
  # submodule; the user module includes its sources during qstr extraction.
  git -C "$FORK_SRC/f469-disco/usermods/secp256k1" submodule update --init secp256k1
else
  echo "Using populated f469-disco sources without a valid nested Git dir" >&2
fi

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
# This patch's paths already start with usermods/, unlike the other two.
# Upgrade an existing build workspace that still has the direct-call bridge.
if grep -q 'lv_sdl_mouse_handler(&event);' "$FORK_SRC/f469-disco/usermods/udisplay_f469/lv_sdl_hal/SDL/modSDL.c"; then
  apply_if_needed "$FORK_SRC/f469-disco" "$ROOT/browser/v9-patches/browser-pointer-events.patch"
fi
apply_if_needed "$FORK_SRC/f469-disco" "$ROOT/browser/v9-patches/usermods.patch"
apply_if_needed "$FORK_SRC/f469-disco/usermods/secp256k1" "$ROOT/browser/v9-patches/secp256k1.patch"
if [[ "$1" = schnuartz || "$1" = schnuartz-alternative || "$1" = play-fast ]]; then
  python3 "$ROOT/browser/patch-playground-qstr.py" "$FORK_SRC/f469-disco/micropython"
fi
python3 "$ROOT/browser/limit-lvgl.py" \
  "$FORK_SRC/f469-disco/usermods/udisplay_f469/lvgl/lvgl.mk"

if ! command -v emcc >/dev/null; then
  if [[ ! -f "$EMSDK_ENV" ]]; then
    EMSDK_DIR="$(dirname "$EMSDK_ENV")"
    mkdir -p "$(dirname "$EMSDK_DIR")"
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
    "$EMSDK_DIR/emsdk" install 3.1.74
    "$EMSDK_DIR/emsdk" activate 3.1.74
  fi
  source "$EMSDK_ENV" >/dev/null
fi
test "$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" = 3.1.74

make -C "$FORK_SRC" build-i18n
# Both MockUI forks load their compiled default theme from /flash/themes during
# startup. Omitting this step makes SpecterGui fail before MOCKUI_READY.
if [[ "$1" != schnuartz-alternative ]]; then
  make -C "$FORK_SRC" build-themes
fi
python3 "$ROOT/browser/prepare-mockui.py" "$FORK_SRC"
make -C "$FORK_SRC/f469-disco/micropython/mpy-cross" -j4

PORT="$FORK_SRC/f469-disco/micropython/ports/unix"
if [[ "${BROWSER_CLEAN:-1}" = 1 ]]; then
  make -C "$PORT" BUILD=build-specter-mockui-browser PROG=micropython.js clean
fi
# Stackless keeps recursive Python bytecode calls in heap code states. This
# avoids exhausting the browser engine's JS/WASM call stack before
# MicroPython's linear-memory cstack check can raise an exception.
make -C "$PORT" -j4 \
  BUILD=build-specter-mockui-browser PROG=micropython.js \
  CC=emcc LD=emcc AR=emar STRIP=true SIZE=true \
  MICROPY_PY_BTREE=0 MICROPY_PY_FFI=0 MICROPY_PY_SOCKET=0 \
  MICROPY_PY_THREAD=0 MICROPY_PY_TERMIOS=0 MICROPY_PY_USSL=0 \
  MICROPY_USE_READLINE=1 \
  USER_C_MODULES="$FORK_SRC/f469-disco/usermods" \
  FROZEN_MANIFEST="$FORK_SRC/browser.manifest.py" \
  CFLAGS_EXTRA="-DMICROPY_NLR_SETJMP=1 -DMICROPY_STACKLESS=1 -DMICROPY_STACKLESS_STRICT=1 -DMODULE_DISPLAY_ENABLED=1 -DMODULE_HASHLIB_ENABLED=1 -DMICROPY_PY_HASHLIB=0 -DSTATIC=static -Wno-error -sUSE_SDL=2 -ffile-prefix-map=$FORK_SRC=/specter-playground" \
  LDFLAGS_ARCH= \
  LDFLAGS_EXTRA="-sUSE_SDL=2 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=0 -sSTACK_SIZE=8388608 -sEXPORTED_RUNTIME_METHODS=FS,ccall --preload-file $ROOT/browser/runtime@/browser --preload-file $FORK_SRC/build/flash_image@/flash -Wl,--allow-multiple-definition"

WASM_OPT="${WASM_OPT:-$(dirname "$(command -v emcc)")/../bin/wasm-opt}"
python3 "$ROOT/browser/optimize-wasm.py" \
  "$PORT/build-specter-mockui-browser/micropython.wasm" "$WASM_OPT"

python3 "$ROOT/browser/normalize-glue.py" "$PORT/build-specter-mockui-browser/micropython.js"
mkdir -p "$OUT"
cp "$PORT/build-specter-mockui-browser"/micropython.{js,wasm,data} "$OUT/"
BROWSER_POINTER_NAME="$POINTER_NAME" BROWSER_WASM_OPTIMIZED=1 \
  python3 "$ROOT/browser/write-manifest.py" "$FORK_SRC" "$OUT" "$REPOSITORY" mockui
echo "MockUI browser artifacts: $OUT"
