import './browser-polyfills';
import 'react-native-gesture-handler';
import { BackHandler, Linking } from 'react-native';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import KeeperWebApp from './web-app';

const bootMarkers = ((globalThis as any).__keeperBootMarkers ??= []);
bootMarkers.push('entry-module-loaded');
const nativeDOMConstructors = (globalThis as any).__keeperDOMConstructors;
if (nativeDOMConstructors?.Element && window.Element !== nativeDOMConstructors.Element) {
  Object.defineProperty(window, 'Element', {
    configurable: true,
    writable: true,
    value: nativeDOMConstructors.Element,
  });
}

// React Navigation subscribes to the hardware-back event even in the browser.
// RN Web warns on that mobile-only event, so expose a harmless browser
// subscription while leaving all navigation behavior in the upstream app.
const browserBackHandler = BackHandler as any;
browserBackHandler.addEventListener = () => ({ remove() {} });
browserBackHandler.removeEventListener = () => {};

// Keeper's app controller uses the React Native native-only bulk cleanup API
// when its deep-link listener is torn down. React Native Web exposes the same
// listeners through addEventListener subscriptions, but has no equivalent
// removeAllListeners method. Clear only the requested event bucket so normal
// browser URL listeners keep React Native Web's behavior.
const browserLinking = Linking as any;
browserLinking.removeAllListeners = (eventType: string) => {
  if (eventType && browserLinking._eventCallbacks) {
    browserLinking._eventCallbacks[eventType] = [];
  }
};

const rootTag = document.getElementById('keeper-native-root');

if (!rootTag) throw new Error('Missing Keeper web root element.');

const reactRoot = createRoot(rootTag, {
  onUncaughtError: (error: Error, errorInfo: { componentStack?: string }) => {
    (globalThis as any).__keeperReactErrors ??= [];
    (globalThis as any).__keeperReactErrors.push({
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  },
});
(globalThis as any).__keeperReactRoot = reactRoot;
bootMarkers.push('react-dom-root-created');
flushSync(() => reactRoot.render(<KeeperWebApp />));
bootMarkers.push('application-render-requested');

// The outer demo page also hosts Specter and its QR bridge. Let it distinguish
// the iframe runtime loading from the actual upstream Keeper UI being mounted.
// Wait for React Native Web to paint into the root so the status never claims
// Keeper is ready while the iframe is still blank.
let appMountedNotified = false;
const announceAppMounted = () => {
  if (appMountedNotified || !rootTag.childElementCount) return;
  appMountedNotified = true;
  (globalThis as any).__keeperAppMounted = true;
  mountObserver.disconnect();
  window.parent.postMessage({ type: 'keeper-app-mounted' }, window.location.origin);
};
const mountObserver = new MutationObserver(announceAppMounted);
mountObserver.observe(rootTag, { childList: true, subtree: true });
requestAnimationFrame(announceAppMounted);
