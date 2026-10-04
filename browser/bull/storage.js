// A navigated Drift worker can briefly retain its OPFS sync access handle.
// Cleanup completes before a new session starts and only touches retired Bull IDs.
export async function cleanupRetiredSessions(retiredSessions) {
  for (const retired of retiredSessions) {
    if (!/^[a-f0-9-]{36}$/.test(retired)) throw new Error('Invalid retired Bull session');
    const names = ['bullbitcoin_sqlite', 'payjoin'].map(name => `bull-bitcoin-${retired}-${name}`);
    for (const name of names) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        const timer = setTimeout(() => reject(new Error('Bull database reset is blocked by an open connection.')), 10000);
        request.onsuccess = () => { clearTimeout(timer); resolve(); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
      });
      if (!navigator.storage?.getDirectory) continue;
      const deadline = Date.now() + 10000;
      while (true) {
        try {
          const root = await navigator.storage.getDirectory();
          const drift = await root.getDirectoryHandle('drift_db');
          await drift.removeEntry(name, {recursive:true});
          break;
        } catch (error) {
          if (error.name === 'NotFoundError') break;
          if (error.name !== 'NoModificationAllowedError' || Date.now() >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  }
}
