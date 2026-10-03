import { registerBrowserFile } from './browser-fs.web';
export const types = { allFiles: '*/*', plainText: 'text/plain', images: 'image/*', pdf: 'application/pdf' };
export const errorCodes = { OPERATION_CANCELED: 'OPERATION_CANCELED' };
export function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return Boolean(error && typeof error === 'object' && 'code' in error);
}
export async function pick(options?: unknown) {
  const client = (globalThis as any).__keeperCompanionFiles;
  if (!client) throw new Error('The browser file dialog is still starting.');
  const files: File[] = await client.pick(options);
  return Promise.all(files.map(registerBrowserFile));
}
export default { pick, types, errorCodes, isErrorWithCode };
