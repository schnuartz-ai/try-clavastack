import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = join(root, 'upstream', 'bitcoin-keeper');
const require = createRequire(import.meta.url);
const metro = require(require.resolve('metro', { paths: [upstream] }));
const configPath = join(root, 'browser', 'metro-keeper.config.js');
const entry = join(root, 'keeper-web', 'native-entry.tsx');
const output = join(root, 'builds', 'keeper-web', 'keeper-app.js');

await mkdir(dirname(output), { recursive: true });
const config = await metro.loadConfig({ config: configPath });
const bundle = await metro.runBuild(config, {
  entry,
  out: output,
  assets: true,
  platform: 'web',
  dev: false,
  minify: true,
  sourceMap: false,
  maxWorkers: 4,
});

const assetRoot = join(root, 'builds', 'keeper-web', 'assets');
for (const asset of bundle.assets ?? []) {
  const relativeDirectory = relative(root, asset.fileSystemLocation);
  const directory = relativeDirectory.startsWith(`..${sep}`)
    ? join('external', createHash('sha256').update(asset.fileSystemLocation).digest('hex').slice(0, 16))
    : relativeDirectory;
  const targetDirectory = resolve(assetRoot, directory);
  if (!targetDirectory.startsWith(`${resolve(assetRoot)}${sep}`)) {
    throw new Error(`Keeper asset resolved outside the build directory: ${asset.fileSystemLocation}`);
  }
  await mkdir(targetDirectory, { recursive: true });
  for (let index = 0; index < asset.files.length; index += 1) {
    const scale = asset.scales[index];
    const suffix = scale === 1 ? '' : `@${scale}x`;
    const target = join(targetDirectory, `${asset.name}${suffix}.${asset.type}`);
    await copyFile(asset.files[index], target);
  }
}
await Promise.all([
  copyFile(join(upstream, 'src', 'assets', 'images', 'keeper-logo.svg'), join(root, 'builds', 'keeper-web', 'keeper-logo.svg')),
  copyFile(join(upstream, 'src', 'assets', 'images', 'KeeperIconLight.svg'), join(root, 'builds', 'keeper-web', 'keeper-icon.svg')),
]);
const notices = await readFile(join(root, 'bitcoin-keeper', 'THIRD-PARTY-NOTICES.txt'), 'utf8');
await writeFile(join(root, 'builds', 'keeper-web', 'keeper-app.js.LEGAL.txt'),
  `Bitcoin Keeper upstream: https://github.com/KeeperCommunity/bitcoin-keeper/tree/1adf4f66399a2bfac4572d9da94440323bff02f2\n\n${notices}`);
console.log(`Bundled Bitcoin Keeper's React Native app for web: ${output}`);
console.log(`Copied ${bundle.assets?.length ?? 0} Keeper asset groups to ${assetRoot}`);
