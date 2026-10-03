// Temporary native file handles only. The virtual SD card lives exclusively in
// companion-media.js and is accessed through its list/write protocol.
const temporaryFiles = new Map<string, Uint8Array>();
let nextHandle = 0;
function path(value: string) { return value.replace(/^file:\/\//, ''); }
export async function registerBrowserFile(file: File) {
  const uri = `/keeper-upload/${++nextHandle}/${file.name}`;
  temporaryFiles.set(uri, new Uint8Array(await file.arrayBuffer()));
  return { uri, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
}
export function decodeFile(value: string, encoding = 'utf8') {
  if (encoding === 'base64') return Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (encoding === 'ascii') return Uint8Array.from(value, char => char.charCodeAt(0));
  return new TextEncoder().encode(value);
}
export function encodeFile(bytes: Uint8Array, encoding?: string | null) {
  if (encoding === 'base64') {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  }
  return new TextDecoder().decode(bytes);
}
export function readBrowserBytes(filePath: string) {
  const bytes = temporaryFiles.get(path(filePath));
  if (!bytes) throw new Error('This file is not available in the browser session.');
  return bytes.slice();
}
const RNFS = {
  TemporaryDirectoryPath: '/keeper-temp/', CachesDirectoryPath: '/keeper-cache', DocumentDirectoryPath: '/keeper-documents',
  async readFile(filePath: string, encoding?: string | null) { return encodeFile(readBrowserBytes(filePath), encoding); },
  async writeFile(filePath: string, value: string, encoding = 'utf8') { temporaryFiles.set(path(filePath), decodeFile(value, encoding)); },
  async exists(filePath: string) { return temporaryFiles.has(path(filePath)); },
  async unlink(filePath: string) { temporaryFiles.delete(path(filePath)); },
  async copyFile(from: string, to: string) { temporaryFiles.set(path(to), readBrowserBytes(from)); },
};
export default RNFS;
