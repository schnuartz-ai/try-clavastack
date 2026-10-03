const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require(
  require.resolve('@react-native/metro-config', {
    paths: [path.resolve(__dirname, '..', 'upstream', 'bitcoin-keeper')],
  })
);

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream', 'bitcoin-keeper');
const config = getDefaultConfig(root);
const rootModules = path.join(root, 'node_modules');
const upstreamModules = path.join(upstream, 'node_modules');
const webAdapters = path.join(root, 'keeper-web');
const browserBuiltins = new Map([
  ['crypto', require.resolve('crypto-browserify', { paths: [root] })],
  ['stream', require.resolve('stream-browserify', { paths: [root] })],
  ['events', require.resolve('events/', { paths: [root] })],
  ['path', require.resolve('path-browserify', { paths: [root] })],
  ['process', require.resolve('process/browser', { paths: [root] })],
  ['buffer', require.resolve('buffer/', { paths: [root] })],
]);
const sharedReactModules = new Map([
  ['react', require.resolve('react', { paths: [root] })],
  ['react-dom', require.resolve('react-dom', { paths: [root] })],
  ['react-dom/client', require.resolve('react-dom/client', { paths: [root] })],
]);

function mappedFile(request) {
  const aliases = new Map([
    ['src/context/TorContext', path.join(webAdapters, 'web-tor-context.tsx')],
    ['src/storage', path.join(webAdapters, 'adapters', 'browser-storage.web.ts')],
    ['src/storage/secure-store', path.join(webAdapters, 'adapters', 'browser-secure-store.web.ts')],
    ['src/storage/realm/dbManager', path.join(webAdapters, 'adapters', 'browser-realm.web.ts')],
    ['src/storage/realm/realm', path.join(webAdapters, 'adapters', 'browser-realm.web.ts')],
    ['src/storage/realm/RealmProvider', path.join(webAdapters, 'adapters', 'browser-realm.web.ts')],
    ['src/components/KeeperQRCode', path.join(webAdapters, 'adapters', 'KeeperQRCode.web.tsx')],
    ['src/services/sentry', path.join(webAdapters, 'adapters', 'browser-sentry.web.tsx')],
    ['src/services/backend/Relay', path.join(webAdapters, 'adapters', 'browser-relay.web.ts')],
    ['src/services/electrum/predefinedNodes', path.join(webAdapters, 'adapters', 'browser-predefined-nodes.web.ts')],
  ]);
  if (aliases.has(request)) return aliases.get(request);
  if (request === 'src') return path.join(upstream, 'src');
  if (request.startsWith('src/')) return path.join(upstream, 'src', request.slice(4));
  return null;
}

const browserModules = new Map([
  ['electrum-client', path.join(webAdapters, 'adapters', 'browser-electrum-transport.web.ts')],
  ['@realm/react', path.join(webAdapters, 'adapters', 'browser-realm.web.ts')],
  ['realm', path.join(webAdapters, 'adapters', 'realm-module.web.ts')],
  ['react-native-mmkv', path.join(webAdapters, 'adapters', 'browser-mmkv.web.ts')],
  ['react-native-config', path.join(webAdapters, 'adapters', 'browser-config.web.ts')],
  ['react-native-reanimated', path.join(webAdapters, 'adapters', 'browser-reanimated.web.tsx')],
  ['react-native-share', path.join(webAdapters, 'adapters', 'browser-share.web.ts')],
  ['react-native-fast-image', path.join(webAdapters, 'adapters', 'browser-fast-image.web.tsx')],
  ['react-native-pdf', path.join(webAdapters, 'adapters', 'browser-pdf.web.tsx')],
  ['react-native-safe-area-context', path.join(webAdapters, 'adapters', 'browser-safe-area.web.tsx')],
  ['react-native-linear-gradient', path.join(webAdapters, 'adapters', 'browser-linear-gradient.web.tsx')],
  ['libportal-react-native', path.join(webAdapters, 'adapters', 'browser-portal.web.ts')],
  ['react-native-change-icon', path.join(webAdapters, 'adapters', 'browser-change-icon.web.ts')],
  ['react-native-contacts', path.join(webAdapters, 'adapters', 'browser-contacts.web.ts')],
  ['react-native-html-to-pdf', path.join(webAdapters, 'adapters', 'browser-html-to-pdf.web.ts')],
  ['react-native-send-intent', path.join(webAdapters, 'adapters', 'browser-send-intent.web.ts')],
  ['react-native-blob-util', path.join(webAdapters, 'adapters', 'browser-blob-util.web.ts')],
  ['react-native-keychain', path.join(webAdapters, 'adapters', 'browser-native-services.web.tsx')],
  ['react-native-biometrics', path.join(webAdapters, 'adapters', 'browser-biometrics.web.ts')],
  ['react-native-device-info', path.join(webAdapters, 'adapters', 'browser-device-info.web.ts')],
  ['react-native-iap', path.join(webAdapters, 'adapters', 'browser-native-services.web.tsx')],
  ['react-native-nfc-manager', path.join(webAdapters, 'adapters', 'browser-nfc.web.ts')],
  ['react-native-hce', path.join(webAdapters, 'adapters', 'browser-native-services.web.tsx')],
  ['react-native-vision-camera', path.join(webAdapters, 'adapters', 'vision-camera.web.tsx')],
  ['react-native-fs', path.join(webAdapters, 'adapters', 'browser-fs.web.ts')],
  ['react-native-image-picker', path.join(webAdapters, 'adapters', 'browser-image-picker.web.ts')],
  ['rn-qr-generator', path.join(webAdapters, 'adapters', 'browser-qr-image.web.ts')],
  ['@react-native-firebase/app', path.join(webAdapters, 'adapters', 'browser-native-services.web.tsx')],
  ['@react-native-firebase/messaging', path.join(webAdapters, 'adapters', 'browser-native-services.web.tsx')],
  ['@sentry/react-native', path.join(webAdapters, 'adapters', 'browser-sentry.web.tsx')],
]);

module.exports = mergeConfig(config, {
  projectRoot: root,
  watchFolders: [upstream, webAdapters],
  transformer: {
    ...config.transformer,
    assetPlugins: [
      ...config.transformer.assetPlugins,
      path.join(__dirname, 'metro-keeper-asset-plugin.cjs'),
    ],
    babelTransformerPath: path.join(__dirname, 'metro-keeper-transformer.cjs'),
  },
  resolver: {
    ...config.resolver,
    platforms: [...new Set([...config.resolver.platforms, 'web'])],
    resolverMainFields: ['browser', 'react-native', 'main'],
    assetExts: config.resolver.assetExts.filter((extension) => extension !== 'svg'),
    sourceExts: [...new Set([...config.resolver.sourceExts, 'svg'])],
    nodeModulesPaths: [rootModules, upstreamModules],
    extraNodeModules: {
      ...config.resolver.extraNodeModules,
      'react-native': path.dirname(
        require.resolve('react-native-web/package.json', { paths: [root] })
      ),
    },
    resolveRequest(context, moduleName, platform) {
      const origin = context.originModulePath?.replaceAll('\\', '/');
      const normalizedRequest = moduleName.replaceAll('\\', '/');
      if (
        platform === 'web' &&
        normalizedRequest === './predefinedNodes' &&
        origin?.includes('/upstream/bitcoin-keeper/src/services/electrum/')
      ) {
        return context.resolveRequest(context, path.join(webAdapters, 'adapters', 'browser-predefined-nodes.web.ts'), platform);
      }
      // React Native's generic RCTNetworking.js imports itself on web (there is
      // no .web implementation). The resulting undefined emitter crashes real
      // XHR users such as Keeper's QR screen. Route only that upstream boundary
      // to a browser fetch adapter; Keeper continues to use its own XHR parser.
      if (
        platform === 'web' &&
        normalizedRequest === './RCTNetworking' &&
        origin?.endsWith('/react-native/Libraries/Network/XMLHttpRequest.js')
      ) {
        return context.resolveRequest(
          context,
          path.join(webAdapters, 'adapters', 'browser-networking.web.ts'),
          platform,
        );
      }
      if (
        platform === 'web' &&
        origin?.includes('/upstream/bitcoin-keeper/src/storage/realm/') &&
        ['dbManager', 'realm'].includes(normalizedRequest.split('/').at(-1)?.replace(/\.(?:ts|tsx|js|jsx)$/, ''))
      ) {
        return context.resolveRequest(
          context,
          path.join(webAdapters, 'adapters', 'browser-realm.web.ts'),
          platform,
        );
      }
      if (
        platform === 'web' &&
        normalizedRequest.endsWith('/findNodeHandle') &&
        origin?.includes('/react-native-gesture-handler/')
      ) {
        return context.resolveRequest(
          context,
          path.join(webAdapters, 'adapters', 'browser-gesture-find-node.web.ts'),
          platform,
        );
      }
      if (
        platform === 'web' &&
        ['react-native', 'react-native-web'].includes(moduleName) &&
        origin?.endsWith('/react-redux/lib/utils/reactBatchedUpdates.native.js')
      ) {
        return context.resolveRequest(
          context,
          path.join(webAdapters, 'adapters', 'browser-react-redux-batch.web.ts'),
          platform,
        );
      }
      if (
        platform === 'web' &&
        moduleName === './Platform' &&
        origin?.endsWith(
          '/react-native/Libraries/Utilities/Platform.js',
        )
      ) {
        return context.resolveRequest(
          context,
          require.resolve('react-native-web/src/exports/Platform', { paths: [root] }),
          platform,
        );
      }
      const target = mappedFile(moduleName);
      if (target) return context.resolveRequest(context, target, platform);
      if (browserModules.has(moduleName)) {
        return context.resolveRequest(context, browserModules.get(moduleName), platform);
      }
      if (sharedReactModules.has(moduleName)) {
        return context.resolveRequest(context, sharedReactModules.get(moduleName), platform);
      }
      if (browserBuiltins.has(moduleName)) {
        return context.resolveRequest(context, browserBuiltins.get(moduleName), platform);
      }
      if (moduleName === 'react-native' && platform === 'web') {
        return context.resolveRequest(context, 'react-native-web', platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
