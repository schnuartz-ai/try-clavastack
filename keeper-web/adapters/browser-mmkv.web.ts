import { webSessionStore } from './browser-storage.web';

export function createMMKV() { return webSessionStore; }
export default { createMMKV };
