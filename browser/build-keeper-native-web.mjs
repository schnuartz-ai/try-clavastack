import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
// React Native selects Keeper's bundled fonts by family name. Browsers need
// those same families registered explicitly; merely copying Metro assets
// leaves the real screens rendered with the browser's fallback font.
const fontSource = join(upstream, 'src', 'assets', 'fonts');
const fontTarget = join(root, 'builds', 'keeper-web', 'fonts');
await mkdir(fontTarget, { recursive: true });
const fontFiles = (await readdir(fontSource)).filter((name) => /^[A-Za-z0-9-]+\.ttf$/.test(name)).sort();
await Promise.all(fontFiles.map((name) => copyFile(join(fontSource, name), join(fontTarget, name))));
const fontFace = (name, family, weight = 400, style = 'normal') =>
  `@font-face{font-family:"${family}";src:url("./fonts/${name}.ttf") format("truetype");font-style:${style};font-weight:${weight};font-display:swap}`;
const fontRules = fontFiles.map((name) => fontFace(name.slice(0, -4), name.slice(0, -4)));
// Gluestack keeps the theme's "Inter" family plus its weight on the web.
// Derive its native fontConfig from upstream so Lora headings and italic/bold
// variants continue to follow Keeper's own typography when it is updated.
const fontConstants = await readFile(join(upstream, 'src', 'constants', 'Fonts.js'), 'utf8');
const fontNames = new Map([...fontConstants.matchAll(/(\w+):\s*'([^']+)'/g)].map((match) => [match[1], match[2]]));
const themeSource = await readFile(join(upstream, 'src', 'navigation', 'themes.js'), 'utf8');
const themeFontConfig = themeSource.split('fontConfig:')[1]?.split('fonts:')[0] || '';
const themeFontWeights = [...themeFontConfig.matchAll(/(\d+):\s*\{\s*normal:\s*Fonts\.(\w+),\s*italic:\s*Fonts\.(\w+)/g)];
if (!themeFontWeights.length) throw new Error('Keeper theme fontConfig could not be read.');
for (const [, weight, normal, italic] of themeFontWeights) {
  for (const [key, style] of [[normal, 'normal'], [italic, 'italic']]) {
    const name = fontNames.get(key);
    if (!name || !fontFiles.includes(`${name}.ttf`)) throw new Error(`Keeper theme references an unavailable font: ${key}`);
    fontRules.push(fontFace(name, 'Inter', weight, style));
  }
}
await writeFile(join(root, 'builds', 'keeper-web', 'fonts.css'), fontRules.join('\n') + '\n');
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
