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
  async open() { throw new Error('Native sharing is unavailable in the browser simulator.'); },
  async shareSingle() { throw new Error('Native social sharing is unavailable in the browser simulator.'); },
  async isPackageInstalled() { return { isInstalled: false, message: 'Native packages are unavailable in the browser.' }; },
};

export default BrowserShare;
