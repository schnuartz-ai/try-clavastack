import {chromium} from 'playwright';

// Use the regular browser's headless mode for production acceptance. The
// separate Chromium 153 headless shell crashes in its optimized WASM engine
// when this app is repeatedly reloaded/reset on GitHub's Linux runners.
// Keep explicit engine selection available for the exact-build diagnostic.
export function launchBullBrowser() {
  const selected = process.env.BULL_BROWSER_CHANNEL || (process.env.CI ? 'chromium' : 'chrome');
  return chromium.launch({
    ...(selected === 'headless-shell' ? {} : {channel:selected}),
    ...(process.env.BULL_BROWSER_JS_FLAGS ? {args:[`--js-flags=${process.env.BULL_BROWSER_JS_FLAGS}`]} : {}),
    headless:true,
  });
}
