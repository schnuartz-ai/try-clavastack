export const BROWSER_APP_VERSION = '2.5.13';

export const DeviceInfo = {
  // Upstream compares DeviceInfo.getVersion() with semver during login. Keep a
  // valid application release version here; the simulator label belongs in
  // getDeviceName(), not in the version field.
  getVersion: () => BROWSER_APP_VERSION, getUniqueId: async () => 'keeper-web-session',
  getDeviceName: async () => 'Bitcoin Keeper Web Simulator', getSystemName: () => 'Web',
  getSystemVersion: () => navigator.userAgent, isTablet: () => false,
  hasNotch: () => false, getBrand: () => 'Browser', getModel: () => 'Simulator',
  getBuildNumber: () => 'web', getBundleId: () => 'app.bitcoinkeeper.web',
};
export default DeviceInfo;
