import RNFS from './browser-fs.web';
import Share from './browser-share.web';
import { pick, isErrorWithCode, errorCodes } from './browser-document-picker.web';

// Only the OS file transport changes. Keeper's import screens continue to
// parse/validate the same bytes through the upstream callback interface.
export async function importFile(onFileRead: (data: string) => void, onError: (error: unknown) => void, encoding?: string | null) {
  let uri: string | undefined;
  try {
    const [file] = await pick(); uri = file.uri;
    onFileRead(await RNFS.readFile(uri, encoding));
  } catch (error) {
    if (!isErrorWithCode(error) || error.code !== errorCodes.OPERATION_CANCELED) onError(error);
  } finally { if (uri) await RNFS.unlink(uri); }
}
export async function exportFile(data: string, name: string, onError: (error: unknown) => void, encoding = 'utf8', saveToFiles = true) {
  if (!data) return;
  const filePath = `${RNFS.TemporaryDirectoryPath}${name}`;
  try {
    await RNFS.writeFile(filePath, data, encoding);
    await Share.open({ url: `file://${filePath}`, filename: name, saveToFiles });
  } catch (error) {
    if (!isErrorWithCode(error) || error.code !== errorCodes.OPERATION_CANCELED) onError(error);
  } finally { await RNFS.unlink(filePath); }
}
