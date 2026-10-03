// Bundle the pinned secp256k1 WASM backend used for public BIP32 derivation.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(process.argv[2]);
const library = resolve('node_modules/tiny-secp256k1/lib');
await mkdir(output, { recursive: true });
await build({
  stdin: { contents: "export { isPoint, pointCompress, pointAddScalar } from 'tiny-secp256k1';", resolveDir: process.cwd() },
  outfile: resolve(output, 'secp256k1.js'), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'browser-wasm-loader', setup(builder) {
    builder.onLoad({ filter: /wasm_loader\.browser\.js$/ }, () => ({
      contents: `import { generateInt32 } from ${JSON.stringify(resolve(library, 'rand.browser.js'))};
        import { throwError } from ${JSON.stringify(resolve(library, 'validate_error.js'))};
        const { instance } = await WebAssembly.instantiate(globalThis.specterVerifiedSecpWasm, {
          './rand.js': { generateInt32 }, './validate_error.js': { throwError }
        });
        export default instance.exports;`, loader: 'js', resolveDir: library,
    }));
  } }],
});
await copyFile(resolve(library, 'secp256k1.wasm'), resolve(output, 'secp256k1.wasm'));
await copyFile(resolve(library, '../LICENSE'), resolve(output, 'secp256k1.LICENSE.txt'));
console.log('Bundled pinned tiny-secp256k1 2.2.4 public point operations');
