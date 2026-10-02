const unsupported = async () => { throw new Error('Native blob filesystem is unavailable in the browser simulator.'); };
const fs = { dirs: { DocumentDir: '', CacheDir: '', DownloadDir: '' }, writeFile: unsupported, readFile: unsupported, unlink: unsupported, exists: async () => false };
const adapter = { fs, fetch: unsupported, config: () => ({ fetch: unsupported }), session: unsupported, wrap: (value: any) => value, polyfill: { Blob: globalThis.Blob } };
export default adapter;
