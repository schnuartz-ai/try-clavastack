// React 18+ batches updates from browser events automatically. This matches
// React Redux's own no-op fallback for non-DOM renderers while preserving the
// real upstream store, reducers, selectors, and subscriptions.
export function unstable_batchedUpdates<T>(callback: () => T): T {
  return callback();
}
