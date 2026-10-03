const path = require('node:path');

const upstreamRoot = path.resolve(__dirname, '..', 'upstream', 'bitcoin-keeper');
const upstreamTransformer = require(require.resolve('react-native-svg-transformer', {
  paths: [upstreamRoot],
}));
const signerPickerPath = path.join(
  upstreamRoot,
  'src',
  'screens',
  'Vault',
  'AddSigningDevice.tsx',
);

// The pinned Keeper upstream assumes every signer has all three xpub families.
// Hardware signers such as Specter DIY normally expose only the script type they
// support, so this selector crashes while reading an absent family. Keep the
// upstream checkout immutable and apply this guarded compatibility fix only to
// its browser bundle.
const unsafeXpubReads = [
  'const amfXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.AMF][0];',
  'const ssXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.P2WPKH][0];',
  'const msXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.P2WSH][0];',
].join('\n  ');

const safeXpubReads = [
  'const amfXpub: signerXpubs[XpubTypes][0] = idx(signer, (_) => _.signerXpubs[XpubTypes.AMF][0]);',
  'const ssXpub: signerXpubs[XpubTypes][0] = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WPKH][0]);',
  'const msXpub: signerXpubs[XpubTypes][0] = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WSH][0]);',
].join('\n  ');

module.exports = {
  ...upstreamTransformer,
  async transform(args) {
    const filename = path.resolve(args.filename);
    // NativeBase's text plugin destructures `style`, then drops it in its web
    // branch. Preserve the original Keeper typography without editing vendor
    // files or replacing the upstream Text component.
    if (filename.endsWith(path.join('@gluestack-ui', 'themed-native-base', 'build', 'plugins', 'TextChildStyle.js'))) {
      const original = 'Object.assign({}, componentProps, { ref: ref })';
      if (args.src.split(original).length !== 2) {
        throw new Error('Keeper TextStyleResolver web patch no longer matches; review the upstream plugin.');
      }
      args = { ...args, src: args.src.replace(original, 'Object.assign({}, componentProps, { style: react_native_1.StyleSheet.flatten(style), ref: ref })') };
    }
    if (filename === signerPickerPath) {
      const normalizedSource = args.src.replace(/\r\n/g, '\n');
      const matches = normalizedSource.split(unsafeXpubReads).length - 1;
      if (matches !== 1) {
        throw new Error(
          `Expected the pinned Keeper signer xpub reads exactly once, found ${matches}; review the web compatibility patch.`,
        );
      }
      args = { ...args, src: normalizedSource.replace(unsafeXpubReads, safeXpubReads) };
    }
    return upstreamTransformer.transform(args);
  },
};
