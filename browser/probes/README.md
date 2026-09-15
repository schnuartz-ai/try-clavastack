# Pointer / GC regression

Build both MockUI variants, then run `npm run test:pointer-gc`.
The test serves the real worker and WASM artifacts on a temporary localhost
port, installs `pointer-gc.py` into that worker's in-memory filesystem, and
sends twelve press/release pairs. Each LVGL press callback explicitly runs
`gc.collect()`. Every callback and the main loop must finish without an error.
It does not load or modify persisted simulator state.

The old bridge called `lv_sdl_mouse_handler()` directly from a worker message.
That can execute Python while `display.update()` has suspended the main stack
in `emscripten_sleep()`. GC also suspends through `emscripten_scan_registers()`;
starting it from that second entry overwrites Asyncify's pending continuation.
This violates Emscripten's [Asyncify reentrancy requirements](https://emscripten.org/docs/porting/asyncify.html#reentrancy).

The bridge now uses `SDL_PushEvent()`. LVGL's existing SDL timer drains the
queue during the main loop, so callbacks and GC use the active main stack.
The previous extra `lv_indev_read()` is also removed: the SDL mouse handler
already performs that read.

Results, including error stacks, are saved in `test-results/pointer-gc.json`.
Use `TEST_VARIANTS=play` or `TEST_VARIANTS=schnuartz` to test one variant;
`TEST_PLAY_BUILD` and `TEST_SCHNUARTZ_BUILD` can select a baseline artifact
directory by its URL path within this repository. The baseline should fail.
This test reproduces the pointer/GC failure; it does not establish that every
reported `RangeError` or freeze had the same cause.
