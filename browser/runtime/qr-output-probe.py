"""Test-only display harness using Specter DIY's own LVGL QR widget."""
import sys
sys.path.insert(0, '/browser')
sys.path.append('')

# Keep the simulator's leaf-first imports used by its normal browser boot.
import hashlib
import microur.util.xoshiro256
import microur.util.random_sampler
import microur.util.fountain
import microur.util.ur
import microur.util.bytewords
import microur.encoder
import microur.decoder

import asyncio
from io import BytesIO
import display
import lvgl as lv
import gui.core
from gui.components.qrcode import QRCode

display.init(False)
gui.core.init(False)
qr = QRCode(lv.scr_act())
qr.set_size(420)
qr.align(lv.scr_act(), lv.ALIGN.CENTER, 0, 0)

async def run():
    if len(sys.argv) > 2 and sys.argv[2] == 'animated':
        from qrencoder import Base64QREncoder
        payload = b'Specter DIY animated QR frame test:' + bytes(range(256)) * 3
        with Base64QREncoder(BytesIO(payload), part_len=220, tempfile='/state/diy-qr-output.txt') as encoder:
            qr.set_text(encoder)
            print('DIY_QR_OUTPUT_READY')
            while True:
                gui.core.update(30)
                await asyncio.sleep_ms(30)
    else:
        qr.set_text('Specter DIY static QR frame test')
        print('DIY_QR_OUTPUT_READY')
        while True:
            gui.core.update(30)
            await asyncio.sleep_ms(30)

asyncio.run(run())
