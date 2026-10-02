export async function openApp() { throw new Error('Opening another installed application is unavailable in the browser simulator.'); }
export async function launchApp() { throw new Error('Opening another installed application is unavailable in the browser simulator.'); }
export async function sendAppIntent() { throw new Error('Android intents are unavailable in the browser simulator.'); }
export default { openApp, launchApp, sendAppIntent };
