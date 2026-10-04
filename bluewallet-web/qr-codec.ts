import * as bip39 from '../upstream/bluewallet/node_modules/bip39';
export function normalizeQr(result: {data?: string; binaryData?: number[]; chunks?: {type: string}[]}, seedImport: boolean) {
 const text = result.data || '';
 if (!seedImport) return text;
 if (/^\d{48}$|^\d{96}$/.test(text)) {
  const indexes = text.match(/\d{4}/g)!;
  if (indexes.some(index => Number(index) >= 2048)) throw new Error('SeedQR contains an invalid word index.');
  const mnemonic = indexes.map(index => bip39.wordlists.english[Number(index)]).join(' ');
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('SeedQR checksum is invalid.');
  return text; // The original BlueWallet setSecret() decodes Standard SeedQR.
 }
 if (result.chunks?.length === 1 && result.chunks[0].type === 'byte' && [16,32].includes(result.binaryData?.length || 0)) {
  const entropy = result.binaryData!.map(byte => byte.toString(16).padStart(2,'0')).join('');
  return bip39.entropyToMnemonic(entropy); // Browser-only CompactSeedQR adaptation.
 }
 return text;
}
