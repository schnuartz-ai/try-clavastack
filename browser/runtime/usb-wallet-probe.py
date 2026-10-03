"""Disposable public-seed fixture for the real DIY USBHost and XpubApp."""
import sys
sys.path.insert(0, '/browser')
sys.path.append('')
import hashlib
import microur.util.xoshiro256
import microur.util.random_sampler
import microur.util.fountain
import microur.util.ur
import microur.util.bytewords
import microur.encoder
import microur.decoder
import asyncio
import display
import platform
from hosts.usb import USBHost
from keystore.ram import RAMKeyStore
from apps.xpubs.xpubs import XpubApp

display.init(False)
keystore = RAMKeyStore()
keystore.show_loader = lambda *args, **kwargs: None
keystore.set_mnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
                      'ClavaStack public browser audit')
app = XpubApp('/state/xpub-probe')
app.init(keystore, 'main', keystore.show_loader, None)

class Manager:
    async def process_host_request(self, stream):
        return await app.process_host_command(stream, None)

host = USBHost('/state/usb-wallet-probe')
host.init()
host.manager = Manager()
platform.enable_usb()
print('USB_WALLET_PROBE_READY')

async def run():
    while True:
        display.update(30)
        await host.update()

asyncio.run(run())
