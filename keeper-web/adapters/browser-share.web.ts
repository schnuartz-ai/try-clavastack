import { readBrowserBytes, decodeFile } from './browser-fs.web';

export const Social = {
  Facebook: 'facebook', FacebookStories: 'facebookstories', Pagesmanager: 'pagesmanager',
  Twitter: 'twitter', Whatsapp: 'whatsapp', Whatsappbusiness: 'whatsappbusiness',
  Instagram: 'instagram', InstagramStories: 'instagramstories', Googleplus: 'googleplus',
  Pinterest: 'pinterest', Linkedin: 'linkedin', Sms: 'sms', Telegram: 'telegram',
  Messenger: 'messenger', Snapchat: 'snapchat', Viber: 'viber', Discord: 'discord',
};
export const ShareAsset = { Image: 'image', Video: 'video', Audio: 'audio' };

const BrowserShare = {
  Social,
  getConstants: () => ({}),
  async open(options: { url?: string; urls?: string[]; filename?: string; type?: string; message?: string; title?: string; saveToFiles?: boolean } = {}) {
    const url = options.url || options.urls?.[0];
    if (url?.startsWith('file://') || url?.startsWith('data:') || (!url && options.message)) {
      const client = (globalThis as any).__keeperCompanionFiles;
      if (!client) throw new Error('The browser file dialog is still starting.');
      // Keeper shares signed PSBTs as base64 text. Preserve that payload;
      // choosing a file destination only replaces the native share sheet.
      const name = options.filename || (url?.startsWith('file://') ? url.split('/').at(-1)
        : options.message?.startsWith('cHNidP') ? 'keeper-transaction.psbt' : 'keeper-export.txt');
      const data = url?.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      const bytes = data ? decodeFile(data[2] ? data[3] : decodeURIComponent(data[3]), data[2] ? 'base64' : 'utf8')
        : url ? readBrowserBytes(url) : decodeFile(options.message!, 'utf8');
      await client.save({ name, bytes, type: options.type || data?.[1] || 'text/plain' });
      return { success: true };
    }
    if (navigator.share) { await navigator.share({ title: options.title, text: options.message, url }); return { success: true }; }
    throw new Error('Browser sharing is unavailable. File export can use the virtual SD card or a download.');
  },
  async shareSingle() { throw new Error('Native social sharing is unavailable in the browser simulator.'); },
  async isPackageInstalled() { return { isInstalled: false, message: 'Native packages are unavailable in the browser.' }; },
};

export default BrowserShare;
