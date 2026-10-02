const unavailable = async (operation: string): Promise<never> => {
  throw new Error(`${operation} is unavailable in the isolated browser simulator.`);
};

function recordDebug(event: Record<string, unknown>) {
  if (typeof window === 'undefined' || !(window as any).__KEEPER_SIMULATOR_DEBUG__) return;
  const events = ((window as any).__keeperBrowserDebug ||= []);
  events.push({ at: Date.now(), ...event });
  if (events.length > 100) events.splice(0, events.length - 100);
}

const Relay = {
  // Local setup does not register the disposable wallet or its derived identifier upstream.
  async createNewApp() { return { created: true, browserSimulator: true }; },
  async getTestcoins() { return unavailable('Testnet faucet requests'); },
  async fetchCollaborativeChannel() { return unavailable('Collaborative channel service'); },
  async createZendeskTicket() { return unavailable('Support tickets'); },
  async getZendeskUser() { return unavailable('Support service'); },
  async createZendeskUser() { return unavailable('Support service'); },
  async updateZendeskExternalId() { return unavailable('Support service'); },
  async updateFCMTokens() { return { updated: false }; },
  async updateSubscription() { return { updated: false }; },
  async getAppImage() { return { allVaultImages: [], appImage: undefined, labels: [] }; },
  async getVaultImage() { return undefined; },
  async updateAppImage(payload?: any) {
    recordDebug({ op: 'relay.updateAppImage', wallets: payload?.wallets?.length || 0, signers: payload?.signers?.length || 0, nodes: payload?.nodes?.length || 0 });
    return { updated: true, browserSimulator: true };
  },
  async updateVaultImage() { recordDebug({ op: 'relay.updateVaultImage' }); return { updated: true, browserSimulator: true }; },
  async deleteAppImageEntity() { return { deleted: false }; },
  async deleteVaultImage() { return { deleted: false }; },
  async backupAllSignersAndVaults() { return unavailable('Cloud backup'); },
  async deleteBackup() { return unavailable('Cloud backup'); },
  async modifyLabels() { return { updated: false }; },
  async migrateXfp() { return unavailable('Cloud migration'); },
  async updateCollaborativeChannel() { return unavailable('Collaborative channel service'); },
};

export default Relay;
