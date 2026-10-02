// React Native's app internals still request a few native services on web.
// The actual UI and app services are provided by React Native Web and the
// Keeper-specific browser adapters; these methods only satisfy native UI
// lifecycle calls that have no browser implementation.
const noop = () => {};
globalThis.__keeperBootMarkers?.push('native-shims-loaded');
const browserQueueMicrotask = globalThis.queueMicrotask.bind(globalThis);
const browserRequestIdleCallback = globalThis.requestIdleCallback?.bind(globalThis);
const browserCancelIdleCallback = globalThis.cancelIdleCallback?.bind(globalThis);
const emptyViewManagerConfig = {
  ViewManagerNames: [],
  genericBubblingEventTypes: {},
  genericDirectEventTypes: {},
};
const reportException = (kind, error) => {
  globalThis.__keeperNativeExceptions ??= [];
  globalThis.__keeperNativeExceptions.push({ kind, error });
};

const nativeModules = {
  UIManager: {
    getConstants: () => emptyViewManagerConfig,
    getConstantsForViewManager: () => null,
    getDefaultEventTypes: () => [],
    getViewManagerConfig: () => null,
    hasViewManagerConfig: () => false,
    lazilyLoadView: () => null,
    createView: noop,
    updateView: noop,
    removeRootView: noop,
    setChildren: noop,
    manageChildren: noop,
    dispatchViewManagerCommand: noop,
    findSubviewIn: noop,
    measure: noop,
    measureInWindow: noop,
    measureLayout: noop,
    measureLayoutRelativeToParent: noop,
    setJSResponder: noop,
    clearJSResponder: noop,
    configureNextLayoutAnimation: (_config, callback) => callback?.(),
    setLayoutAnimationEnabledExperimental: noop,
    sendAccessibilityEvent: noop,
    focus: noop,
    blur: noop,
  },
  ExceptionsManager: {
    reportFatalException: (message, stack, exceptionId) =>
      reportException('fatal', { message, stack, exceptionId }),
    reportSoftException: (message, stack, exceptionId) =>
      reportException('soft', { message, stack, exceptionId }),
    reportException: (error) => reportException(error?.isFatal ? 'fatal' : 'soft', error),
    dismissRedbox: noop,
  },
  SourceCode: { getConstants: () => ({ scriptURL: location.href }) },
  DeviceInfo: {
    getConstants: () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const scale = window.devicePixelRatio || 1;
      const metrics = { width, height, scale, fontScale: 1 };
      return {
        Dimensions: {
          window: metrics,
          screen: { ...metrics, width: screen.width, height: screen.height },
        },
      };
    },
  },
  NativeReactNativeFeatureFlagsCxx: new Proxy({}, {
    get: () => () => false,
  }),
  NativeMicrotasksCxx: {
    queueMicrotask: (callback) => browserQueueMicrotask(callback),
  },
  NativeIdleCallbacksCxx: {
    requestIdleCallback: (callback, options) =>
      browserRequestIdleCallback?.(callback, options) ??
      window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1),
    cancelIdleCallback: (id) =>
      browserCancelIdleCallback?.(id) ?? window.clearTimeout(id),
  },
};

globalThis.__turboModuleProxy ||= (name) => nativeModules[name] ?? null;
globalThis.__RNCallableModules ??= new Map();
globalThis.RN$registerCallableModule ||= (name, factory) =>
  globalThis.__RNCallableModules.set(name, factory);
