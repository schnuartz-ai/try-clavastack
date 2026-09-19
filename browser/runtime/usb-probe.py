"""CI probe for the browser Virtual Host and Specter USB_VCP shim."""
import sys
sys.path.insert(0, '/browser')
sys.path.append('')
import pyb


usb = pyb.USB_VCP()
pyb.usb_mode("VCP")
print("USB_PROBE_READY")
data = usb.read()
if data is None:
    raise RuntimeError("Virtual Host probe input was not queued before startup")
usb.write(b"ACK\r\n" + data + b"\r\n")
print("USB_PROBE_DONE")
