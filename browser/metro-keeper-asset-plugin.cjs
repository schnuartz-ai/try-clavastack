const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');

module.exports = function placeKeeperWebAsset(asset) {
  const relativeDirectory = path.relative(root, asset.fileSystemLocation);
  const directory = relativeDirectory.startsWith('..')
    ? path.join(
        'external',
        createHash('sha256').update(asset.fileSystemLocation).digest('hex').slice(0, 16),
      )
    : relativeDirectory;
  const publicDirectory = path.posix.join(
    '/builds/keeper-web/assets',
    directory.split(path.sep).join('/'),
  );
  return { ...asset, httpServerLocation: publicDirectory };
};
