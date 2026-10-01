const unavailable = async () => {
  throw new Error('Electrum/TCP is unavailable in the Keeper browser simulator.');
};

const ElectrumClient = new Proxy({}, { get: () => unavailable });
export default ElectrumClient;
