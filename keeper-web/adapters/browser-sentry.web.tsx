import React from 'react';

export function SentryWrapper<T>(App: T) { return App; }
export function initializeSentry() {}
export function registerSentryNavigationContainer(navigationRef?: any) {
  // The local browser E2E harness may navigate to upstream screens using real
  // Realm records and transaction payloads. Keep this test hook absent from the
  // normal hosted page.
  if (typeof window !== 'undefined' && (window as any).__KEEPER_SIMULATOR_DEBUG__) {
    (window as any).__keeperNavigation = navigationRef?.current || navigationRef;
  }
}
function recordError(kind: string, error?: unknown) {
  if (typeof window === 'undefined' || !(window as any).__KEEPER_SIMULATOR_DEBUG__) return;
  const events = ((window as any).__keeperBrowserDebug ||= []);
  events.push({ at: Date.now(), op: `sentry.${kind}`, message: error instanceof Error ? error.message : String(error ?? '') , stack: error instanceof Error ? error.stack : undefined });
  if (events.length > 100) events.splice(0, events.length - 100);
}
export function captureException(error?: unknown) { recordError('captureException', error); }
export function captureMessage(message?: unknown) { recordError('captureMessage', message); }
export function captureError(error?: unknown) { recordError('captureError', error); }
export function setUser() {}
export const Sentry = { captureException, captureMessage, setUser };
export default Sentry;

export function SentryBoundary({ children }: React.PropsWithChildren) { return <>{children}</>; }
// Keeper uses this as a higher-order component: SentryErrorBoundary(Screen).
// Returning a rendered fragment here would hand React Navigation an element
// object where it expects a component type and crash on the first wrapped route.
export function SentryErrorBoundary<T extends React.ComponentType<any>>(Screen: T): T {
  return Screen;
}
