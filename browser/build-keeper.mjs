import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = join(root, 'upstream', 'bitcoin-keeper', 'src');
const output = join(root, 'builds', 'keeper-web');

const adapters = new Map([
  ['store/store', 'keeper-web/compat/store.ts'],
  ['utils/service-utilities/config', 'keeper-web/compat/config.ts'],
  ['constants/Bitcoin', 'keeper-web/compat/bitcoin.ts'],
  ['hardware', 'keeper-web/compat/hardware.ts'],
  ['utils/utilities', 'keeper-web/compat/utilities.ts'],
  ['services/rest/RestClient', 'keeper-web/compat/rest.ts'],
  ['services/electrum/client', 'keeper-web/compat/electrum.ts'],
  ['utils/service-utilities/encryption', 'keeper-web/compat/encryption.ts'],
]);

const keeperSource = {
  name: 'keeper-source-paths',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^src\// }, ({ path }) => {
      const relative = path.slice('src/'.length);
      const adapter = adapters.get(relative);
      const target = join(root, adapter || join('upstream', 'bitcoin-keeper', 'src', relative));
      return resolveSourceFile(target);
    });
    const browserBuiltins = new Map([
      ['crypto', 'crypto-browserify/index.js'],
      ['stream', 'stream-browserify/index.js'],
      ['events', 'events/events.js'],
      ['path', 'path-browserify/index.js'],
      ['process', 'process/browser.js'],
    ]);
    buildContext.onResolve({ filter: /^(crypto|stream|events|path|process)$/ }, ({ path }) => ({
      path: join(root, 'node_modules', browserBuiltins.get(path)),
    }));
  },
};

async function resolveSourceFile(path) {
  const candidates = [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}.jsx`,
    join(path, 'index.ts'), join(path, 'index.tsx'), join(path, 'index.js')];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return { path: candidate };
    } catch { /* Keep searching the source extensions used by the app. */ }
  }
  throw new Error(`Could not resolve Keeper source module: ${path}`);
}

await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['keeper-web/app.ts'],
  outfile: join(output, 'app.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  sourcemap: false,
  legalComments: 'linked',
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [keeperSource],
  logLevel: 'info',
});

await Promise.all([
  copyFile(join(upstream, 'assets', 'images', 'keeper-logo.svg'), join(output, 'keeper-logo.svg')),
  copyFile(join(upstream, 'assets', 'images', 'KeeperIconLight.svg'), join(output, 'keeper-icon.svg')),
]);
console.log(`Built Keeper source simulator into ${output}`);
