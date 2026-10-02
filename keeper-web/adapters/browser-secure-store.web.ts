const PIN_KEY = 'keeper:pin-credentials';

function read() {
  try { return JSON.parse(sessionStorage.getItem(PIN_KEY) || 'null'); }
  catch { return null; }
}

export async function store(hash: string, enc_key: string, identifier = '') {
  const existing = read();
  if (existing?.hash === hash) return 'Passcode already exists';
  const next = { hash, enc_key, identifier };
  try { sessionStorage.setItem(PIN_KEY, JSON.stringify(next)); }
  catch { return false; }
  return true;
}

export async function fetch(hash: string) {
  const credentials = read();
  if (credentials?.hash === hash) return credentials.enc_key;
  throw new Error('Incorrect Passcode');
}

export async function hasPin() { return Boolean(read()?.hash); }
export async function remove() { sessionStorage.removeItem(PIN_KEY); return true; }
export async function storeBiometricPubKey() { return false; }
export async function verifyBiometricAuth() { return { success: false }; }
export async function fetchSpecific(hash: string) { return fetch(hash); }
