// Minimal data helpers used by the shared Keeper wallet operations. Their
// inputs and results follow the upstream interfaces exactly.
export const getAccountFromSigner = (signer: any): number | null => {
  if (signer?.derivationPath) {
    const account = parseInt(signer.derivationPath.replace(/[h']/g, '').split('/')[3], 10);
    return Number.isNaN(account) ? null : account;
  }
  return null;
};

export const getKeyUID = (signer: any): string => {
  if (!signer) return '';
  const path = signer.derivationPath || '';
  const pathParts = path.replace(/[h']/g, '').split('/');
  const account = getAccountFromSigner(signer) ?? '';
  const network = pathParts[2] === '0' ? 'M' : pathParts[2] === '1' ? 'T' : '';
  return `${signer.masterFingerprint || signer.xfp || ''}${account}${network}`;
};

export const extractBBQRIndex = (data: string) => {
  if (!data.startsWith('B$')) throw new Error("Invalid string format. Must start with 'B$'.");
  const total = parseInt(data.substring(4, 6), 10);
  const index = parseInt(data.substring(6, 8), 10);
  if (!Number.isFinite(total) || !Number.isFinite(index)) throw new Error('Invalid BBQR frame index.');
  return { total, index };
};

export const isHexadecimal = (value: string) => /^[0-9a-fA-F]+$/.test(value);
