"""CI probe for the browser Virtual Host and Specter USB_VCP shim."""
import sys
import time
sys.path.insert(0, '/browser')
sys.path.append('')
import pyb


usb = pyb.USB_VCP()
pyb.usb_mode("VCP")
print("USB_PROBE_READY")
data = usb.read()
while data is None:
    time.sleep_ms(10)
    data = usb.read()
usb.write(b"ACK\r\n" + data + b"\r\n")
print("USB_PROBE_DONE")
