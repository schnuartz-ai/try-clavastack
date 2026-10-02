"""Browser-only adapters around Specter Desktop's existing environment seams."""

import hashlib
import os
import shutil
import socket
import subprocess
import sys
import types


def _module(name, **attributes):
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


def _disabled(name):
    def reject(*_args, **_kwargs):
        raise RuntimeError(f"{name} is unavailable in the browser simulator")

    return reject


def install_import_adapters():
    """Provide empty browser devices and remove desktop-only service imports."""
    if "distutils.core" not in sys.modules:
        distutils = _module("distutils")
        core = _module("distutils.core", setup=lambda *_args, **_kwargs: None)
        distutils.core = core

    psutil = _module("psutil")
    psutil.process_iter = lambda *_args, **_kwargs: []
    psutil.pid_exists = lambda _pid: False
    psutil.cpu_count = lambda *_args, **_kwargs: 1

    stem = _module("stem", SocketError=type("SocketError", (Exception,), {}))
    connection = _module(
        "stem.connection", AuthenticationFailure=type("AuthenticationFailure", (Exception,), {})
    )
    control = _module("stem.control", Controller=type("Controller", (), {}))
    stem.connection = connection
    stem.control = control

    serial = _module("serial", Serial=_disabled("USB serial"))
    serial.__path__ = []
    serial_tools = _module("serial.tools")
    serial_tools.__path__ = []
    serial.tools = serial_tools
    serial_ports = _module("serial.tools.list_ports", comports=lambda *_a, **_k: [])
    serial_tools.list_ports = serial_ports

    class BrowserSimulatorSocket:
        """Synchronous adapter for Specter DIY's simulator USB serial protocol."""

        def __init__(self, *_args, **_kwargs):
            self.connected = False
            self.response = b""
            self.offset = 0

        def connect(self, address):
            from js import specterBrowserCableIsConnected

            if tuple(address) != ("127.0.0.1", 8789) or not bool(specterBrowserCableIsConnected()):
                raise ConnectionRefusedError("Specter DIY simulator USB cable is not connected")
            self.connected = True

        def setblocking(self, _enabled):
            return None

        def send(self, command):
            if not self.connected:
                raise ConnectionError("Specter DIY simulator USB cable is not connected")
            import base64
            from js import specterBrowserCableQuerySync

            encoded = base64.b64encode(bytes(command)).decode("ascii")
            result = str(specterBrowserCableQuerySync(encoded, 300000))
            self.response = base64.b64decode(result)
            self.offset = 0
            return len(command)

        def recv(self, size):
            if not self.connected:
                raise ConnectionError("Specter DIY simulator USB cable is not connected")
            chunk = self.response[self.offset : self.offset + size]
            self.offset += len(chunk)
            return chunk

        def close(self):
            self.connected = False
            self.response = b""
            self.offset = 0

    socket.socket = BrowserSimulatorSocket

    _module(
        "hid",
        enumerate=lambda *_args, **_kwargs: [],
        device=_disabled("USB HID"),
        HIDException=type("HIDException", (Exception,), {}),
    )
    class BrowserUSBContext:
        """Report no physical USB devices while leaving DIY's virtual cable intact."""

        def __init__(self, *_args, **_kwargs):
            pass

        def open(self):
            return self

        def close(self):
            pass

        def getDeviceIterator(self, *_args, **_kwargs):
            return iter(())

    for name in (
        "USBError",
        "USBErrorNoDevice",
        "USBErrorNotSupported",
        "USBErrorPipe",
    ):
        setattr(sys.modules.setdefault("usb1", types.ModuleType("usb1")), name, type(name, (Exception,), {}))
    sys.modules["usb1"].USBContext = BrowserUSBContext
    _module("pgpy")
    _module("cbor2", dumps=_disabled("Jade USB CBOR transport"), loads=_disabled("Jade USB CBOR transport"))

    apscheduler = _module("apscheduler")
    apscheduler.__path__ = []
    schedulers = _module("apscheduler.schedulers")
    schedulers.__path__ = []
    apscheduler.schedulers = schedulers
    background = _module("apscheduler.schedulers.background", BackgroundScheduler=type("BackgroundScheduler", (), {}))
    schedulers.background = background

    class BrowserScheduler:
        def init_app(self, _app):
            return None

        def start(self, *_args, **_kwargs):
            return None

        def add_job(self, *_args, **_kwargs):
            return None

    _module("flask_apscheduler", APScheduler=BrowserScheduler)


def install_process_and_network_guards():
    """Block process, TCP and Python HTTP access to host or external services."""
    import requests

    os.system = _disabled("Operating-system commands")
    os.popen = _disabled("Operating-system commands")
    subprocess.Popen = _disabled("Child processes")
    subprocess.run = _disabled("Child processes")
    socket.create_connection = _disabled("TCP sockets")
    requests.sessions.Session.request = _disabled("Bitcoin Core/Electrum network RPC")


def install_kdf_adapter():
    """Replace Python 3.12's removed hashlib helper with bundled OpenSSL-backed KDF."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    def browser_pbkdf2_hmac(name, password, salt, iterations, dklen=None):
        algorithms = {
            "sha1": hashes.SHA1,
            "sha256": hashes.SHA256,
            "sha384": hashes.SHA384,
            "sha512": hashes.SHA512,
        }
        algorithm = algorithms[name.lower()]()
        length = dklen or hashlib.new(name).digest_size
        return PBKDF2HMAC(
            algorithm=algorithm, length=length, salt=salt, iterations=iterations
        ).derive(password)

    hashlib.pbkdf2_hmac = browser_pbkdf2_hmac


def patch_qr_scanner_template(app):
    """Expose upstream's own QR/UR parser callback as a camera or frame source."""
    import jinja2

    original = app.jinja_loader
    template_name = "includes/qr-scanner.html"
    trigger = '<slot id="trigger" name="button"><button class="button">Open scanner</button></slot>'
    popup = '''    <video muted playsinline id="qr-video" class="video"></video>
    <div id="qr-progress"></div>'''
    callback_open = "this.scanner = new QrScanner(this.video, result => {"
    callback_close = "    });\n    // Attach the created element to the shadow dom"
    replacement_trigger = '''<div class="scanner-choices" role="group" aria-label="QR frame source">
    <button id="camera-choice" class="button" type="button">Use camera</button>
    <button id="diy-choice" class="button" type="button">Scan from Specter DIY</button>
  </div>'''
    replacement_popup = '''    <video muted playsinline id="qr-video" class="video"></video>
    <div class="scanner-choices scanner-choices-popup" role="group" aria-label="QR frame source">
      <button id="camera-choice-popup" class="button" type="button">Use camera</button>
      <button id="diy-choice-popup" class="button" type="button">Scan from Specter DIY</button>
    </div>
    <div id="qr-progress"></div>'''
    replacement_open = "this.receiveFrame = result => {"
    replacement_close = "    };\n    this.scanner = new QrScanner(this.video, result => this.receiveFrame(result));\n    // Attach the created element to the shadow dom"

    class BrowserTemplateLoader(jinja2.BaseLoader):
        def get_source(self, environment, template):
            source, filename, uptodate = original.get_source(environment, template)
            if template.replace("\\", "/").endswith(template_name):
                expected = (
                    (trigger, replacement_trigger),
                    (popup, replacement_popup),
                    (callback_open, replacement_open),
                    (callback_close, replacement_close),
                )
                for before, after in expected:
                    if source.count(before) != 1:
                        raise RuntimeError(
                            f"Specter Desktop QR compatibility patch expected one {before[:48]!r} in {template}"
                        )
                    source = source.replace(before, after, 1)
                old_click = '''    // on click event
    this.addEventListener('click', e => {
      let isopen = this.hasAttribute('open');
      if(isopen){
        this.removeAttribute('open');
        this.triggerResult(null);
      }else{
        this.setAttribute('open','');
      }
    });'''
                new_click = '''    const chooseSource = (source) => {
      this.dataset.scanSource = source;
      if (source === 'camera') {
        this.video.hidden = false;
        this.popup.dataset.source = 'camera';
        this.cameraChoice.setAttribute('aria-pressed', 'true');
        this.diyChoice.setAttribute('aria-pressed', 'false');
        this.scanner.start().catch(error => this.triggerError(String(error)));
      } else {
        this.scanner.stop();
        this.video.hidden = true;
        this.popup.dataset.source = 'diy';
        this.cameraChoice.setAttribute('aria-pressed', 'false');
        this.diyChoice.setAttribute('aria-pressed', 'true');
        this.progress.textContent = 'Waiting for a QR frame from Specter DIY…';
      }
    };
    this.cameraChoice = clone.getElementById('camera-choice');
    this.diyChoice = clone.getElementById('diy-choice');
    this.cameraChoicePopup = clone.getElementById('camera-choice-popup');
    this.diyChoicePopup = clone.getElementById('diy-choice-popup');
    const choose = (event, source) => {
      event.stopPropagation();
      this.dataset.scanSource = source;
      if (!this.hasAttribute('open')) this.setAttribute('open', '');
      chooseSource(source);
      if (source === 'diy') {
        this.dispatchEvent(new CustomEvent('specter-diy-scan', { bubbles: true, composed: true }));
      }
    };
    for (const button of [this.cameraChoice, this.cameraChoicePopup]) {
      button.addEventListener('click', event => choose(event, 'camera'));
    }
    for (const button of [this.diyChoice, this.diyChoicePopup]) {
      button.addEventListener('click', event => choose(event, 'diy'));
    }
    this.addEventListener('click', e => {
      if (e.composedPath().some(node => [this.cameraChoice, this.diyChoice,
        this.cameraChoicePopup, this.diyChoicePopup].includes(node))) return;
      if (this.hasAttribute('open')) {
        this.removeAttribute('open');
        this.triggerResult(null);
      }
    });'''
                if source.count(old_click) != 1:
                    raise RuntimeError("Specter Desktop QR compatibility patch could not locate its scanner controls")
                source = source.replace(old_click, new_click, 1)
                old_attribute = '''          this.popup.style.display = 'flex';
          this.scanner.start();'''
                new_attribute = '''          this.popup.style.display = 'flex';
          const source = this.dataset.scanSource || 'camera';
          this.video.hidden = source !== 'camera';
          this.popup.dataset.source = source;
          if (source === 'camera') this.scanner.start().catch(e => this.triggerError(String(e)));
          else this.scanner.stop();'''
                if source.count(old_attribute) != 1:
                    raise RuntimeError("Specter Desktop QR compatibility patch could not locate camera start seam")
                source = source.replace(old_attribute, new_attribute, 1)
            if template.replace("\\", "/").endswith("includes/hwi/hwi.jinja"):
                old_hwi_url = "let hwiURL = '/hwi/api/';"
                new_hwi_url = "let hwiURL = '/specter-desktop/hwi/api/';"
                if source.count(old_hwi_url) != 1:
                    raise RuntimeError("Specter Desktop HWI template no longer exposes its expected API URL")
                source = source.replace(old_hwi_url, new_hwi_url, 1)

            def refreshed():
                return uptodate()

            return source, filename, refreshed

    app.jinja_loader = BrowserTemplateLoader()


def initialize(secret_key):
    install_import_adapters()
    install_process_and_network_guards()
    install_kdf_adapter()

    from cryptoadvance.specter import server
    from cryptoadvance.specter.config import BaseConfig
    from cryptoadvance.specter.specter import Specter

    class BrowserConfig(BaseConfig):
        DEBUG = False
        TESTING = False
        SECRET_KEY = secret_key
        HOST = "specter-browser.invalid"
        PORT = 0
        CONNECT_TOR = False
        SPECTER_DATA_FOLDER = "/specter-browser-state"
        SPECTER_API_ACTIVE = False
        SKIP_HWI_INITIALISATION_AT_STARTUP = True
        APP_URL_PREFIX = ""
        SPECTER_URL_PREFIX = "/spc"
        SESSION_COOKIE_PATH = "/specter-desktop"
        SESSION_COOKIE_HTTPONLY = False
        SESSION_COOKIE_SAMESITE = "Lax"
        SESSION_PROTECTION = None
        INTERNAL_BITCOIND_VERSION = ""
        EXTENSION_LIST = []
        SERVICES_LOAD_FROM_CWD = False
        ENABLE_OWN_REQUEST_LOGGING = False
        ENABLE_WERKZEUG_REQUEST_LOGGING = False
        RASPIBLITZ_SPECTER_RPC_LOGIN_BITCOIN_CONF_LOCATION = "/disabled/bitcoin.conf"

    app = server.create_app(BrowserConfig)
    patch_qr_scanner_template(app)
    specter = Specter(
        data_folder=BrowserConfig.SPECTER_DATA_FOLDER,
        checker_threads=False,
        initialize=False,
    )
    with app.app_context():
        server.init_app(app, specter=specter)
    os.makedirs(BrowserConfig.SPECTER_DATA_FOLDER, exist_ok=True)
    return app


def reset_data():
    shutil.rmtree("/specter-browser-state", ignore_errors=True)
    os.makedirs("/specter-browser-state", exist_ok=True)
