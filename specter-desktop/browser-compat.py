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


def install_public_derivation_adapter():
    """Use pinned libsecp256k1 WASM for public point operations only."""
    from js import specterPublicPointCompress, specterPublicPointAdd
    from embit.util import secp256k1 as secp

    def internal(sec):
        return sec[1:33][::-1] + sec[33:65][::-1]

    def serialized(pub):
        if len(pub) != 64:
            raise ValueError("Public key should be 64 bytes long")
        return b"\x04" + pub[:32][::-1] + pub[32:][::-1]

    def parse(sec, context=None):
        if len(sec) not in (33, 65):
            raise ValueError("Serialized public key should be 33 or 65 bytes long")
        try:
            return internal(bytes.fromhex(str(specterPublicPointCompress(bytes(sec).hex(), False))))
        except Exception as error:
            raise ValueError("Invalid public key") from error

    def serialize(pub, flag=secp.EC_COMPRESSED, context=None):
        if flag not in (secp.EC_COMPRESSED, secp.EC_UNCOMPRESSED):
            raise ValueError("Invalid public key serialization flag")
        return bytes.fromhex(str(specterPublicPointCompress(serialized(pub).hex(), flag == secp.EC_COMPRESSED)))

    def add(pub, tweak, context=None):
        if len(tweak) != 32:
            raise ValueError("Tweak should be 32 bytes long")
        try:
            result = specterPublicPointAdd(serialized(pub).hex(), bytes(tweak).hex())
            return internal(bytes.fromhex(str(result))) if result is not None else None
        except Exception as error:
            raise ValueError("Invalid public key tweak") from error

    def tweak_add(pub, tweak, context=None):
        result = add(pub, tweak, context)
        if result is None:
            raise ValueError("Public key tweak resulted in infinity")
        pub[:] = result

    secp.ec_pubkey_parse = parse
    secp.ec_pubkey_serialize = serialize
    secp.ec_pubkey_add = add
    secp.ec_pubkey_tweak_add = tweak_add


def install_electrum_adapter():
    """Keep upstream Spectrum; adapt its socket and thread seams for WASM."""
    import json
    import time
    from js import XMLHttpRequest
    from cryptoadvance.spectrum.spectrum_error import RPCError

    class BrowserElectrumSocket:
        def __init__(self, host, port, use_ssl=True, **_kwargs):
            self.host, self.port, self.ssl = host, int(port), bool(use_ssl)
            self.status = "disconnected"
            self.uses_tor = False
            self._next_retry = 0
            self._script_statuses = {}
            self._read_cache = {}
            try:
                self.call("server.version", ["ClavaStack Spectrum", "1.4"])
            except Exception:
                # Opening saved wallets offline must not prevent Desktop boot.
                self.status = "disconnected"

        def call(self, method, params=None):
            if method == "blockchain.scripthash.subscribe" and params and params[0] in self._script_statuses:
                return self._script_statuses.pop(params[0])
            key = (method, json.dumps(params or []))
            if key in self._read_cache:
                return self._read_cache[key]
            return self._request({"method": method, "params": params or []})

        def prime_scripts(self, scripts):
            self._script_statuses.clear()
            self._read_cache.clear()
            states = {script.scripthash: script.state for script in scripts if script.index is not None}
            hashes = list(states)
            transactions, heights, changed_scripts = set(), set(), []
            for start in range(0, len(hashes), 100):
                batch = hashes[start:start + 100]
                records = self._request({"method": "blockchain.scripthash.subscribe", "scripthashes": batch, "include_history": True})
                for value, record in zip(batch, records):
                    self._script_statuses[value] = record["status"]
                    self._read_cache[("blockchain.scripthash.get_history", json.dumps([value]))] = record["history"]
                    if states[value] != record["status"]:
                        changed_scripts.append([value])
                        for tx in record["history"]:
                            transactions.add(tx["tx_hash"])
                            if tx["height"] > 0:
                                heights.add(tx["height"])
            for method, values in (("blockchain.scripthash.listunspent", changed_scripts),
                                   ("blockchain.scripthash.get_balance", changed_scripts),
                                   ("blockchain.transaction.get", [[value, False] for value in transactions]),
                                   ("blockchain.block.header", [[value] for value in heights])):
                for start in range(0, len(values), 100):
                    batch = values[start:start + 100]
                    results = self._request({"method": method, "parameter_batch": batch})
                    for params, result in zip(batch, results):
                        self._read_cache[(method, json.dumps(params))] = result

        def _request(self, payload):
            request = XMLHttpRequest.new()
            request.open("POST", "/api/ab/electrum", False)
            request.setRequestHeader("Content-Type", "application/json")
            try:
                request.send(json.dumps({"host": self.host, "port": self.port,
                                         "ssl": self.ssl, **payload}))
                response = json.loads(str(request.responseText))
                if int(request.status) != 200:
                    raise RuntimeError(response.get("error", "Electrum relay could not be reached"))
                self.status = "ok"
                if response.get("error"):
                    error = response["error"]
                    raise RPCError(error.get("message", str(error)), error.get("code", -1))
                self.status = "ok"
                return response["result"]
            except RPCError:
                raise
            except Exception:
                self.status = "disconnected"
                raise

        def ping(self):
            started = time.monotonic()
            self.call("server.ping")
            return time.monotonic() - started

        def ensure_connected(self, force=False):
            if self.status == "ok":
                return True
            if not force and time.monotonic() < self._next_retry:
                return False
            self._next_retry = time.monotonic() + 15
            try:
                self.call("server.version", ["ClavaStack Spectrum", "1.4"])
                return True
            except Exception:
                return False

        def shutdown(self):
            self.status = "disconnected"

    # Spectrum uses threads only to schedule wallet synchronisation. Requests
    # already run serially in a dedicated Worker, so execute those jobs there.
    class BrowserFlaskThread:
        def __init__(self, target, args=(), kwargs=None, **_options):
            self.target, self.args, self.kwargs = target, args, kwargs or {}

        def start(self):
            self.target(*self.args, **self.kwargs)

    import cryptoadvance.spectrum.elsock as elsock
    import cryptoadvance.spectrum.util as spectrum_util
    elsock.ElectrumSocket = BrowserElectrumSocket
    spectrum_util.FlaskThread = BrowserFlaskThread
    from cryptoadvance.specter.managers import wallet_manager
    wallet_manager.FlaskThread = BrowserFlaskThread
    from cryptoadvance.spectrum.spectrum import Spectrum
    # Both supported relay servers are Bitcoin mainnet, including offline boot.
    Spectrum.chain = "main"
    from cryptoadvance.spectrum.db import Script
    import inspect
    import textwrap
    from cryptoadvance.specter.wallet.txlist import WalletAwareTxItem
    # Upstream stores these immutable transaction properties in its CSV but
    # checks a different category key, and treats cached zero/False as absent.
    # Copies used by the history page otherwise rebuild every transaction PSBT.
    for name in ("category", "flow_amount", "utxo_amount", "ismine"):
        prop = getattr(WalletAwareTxItem, name)
        property_source = textwrap.dedent(inspect.getsource(prop.fget))
        if name == "category":
            if property_source.count('self.get("_category")') != 1 or property_source.count('self["_category"]') != 1:
                raise RuntimeError("Specter transaction category cache seam changed")
            property_source = property_source.replace('self.get("_category")', 'self.get("category")')
            property_source = property_source.replace('self["_category"]', 'self["category"]')
        else:
            seam = f'if self.get("{name}"):'
            if property_source.count(seam) != 1:
                raise RuntimeError("Specter transaction property cache seam changed")
            property_source = property_source.replace(seam, f'if self.get("{name}") is not None:', 1)
        namespace = {}
        exec(compile(property_source, "<browser-transaction-cache>", "exec"), prop.fget.__globals__, namespace)
        setattr(WalletAwareTxItem, name, namespace[name])
    original_info = Spectrum.getblockchaininfo
    original_rpc = Spectrum.jsonrpc
    original_sync = Spectrum._sync
    # Upstream rounds elapsed seconds down; a batched empty wallet can finish
    # its first hundred scripts in <1 second. Keep its progress division valid.
    sync_source = textwrap.dedent(inspect.getsource(original_sync))
    denominator = "int(\n                    (datetime.now() - ts).total_seconds()\n                )"
    if sync_source.count(denominator) != 1:
        raise RuntimeError("Spectrum sync progress seam changed")
    sync_source = sync_source.replace(denominator, "max(1, (datetime.now() - ts).total_seconds())", 1)
    sync_namespace = {}
    exec(compile(sync_source, "<browser-spectrum-sync>", "exec"), original_sync.__globals__, sync_namespace)
    original_sync = sync_namespace["_sync"]
    original_subscribe = Spectrum._subcribe_scripts
    original_script_sync = Spectrum.sync_script
    script_source = textwrap.dedent(inspect.getsource(original_script_sync))
    header_seam = '''blockheader = self.sock.call("blockchain.block.header", [tx.get("height")])
        blockheader = parse_blockheader(blockheader)'''
    if script_source.count(header_seam) != 1 or script_source.count('[tx["tx_hash"], tx_in_db]') != 1:
        raise RuntimeError("Spectrum transaction sync seam changed")
    script_source = script_source.replace(header_seam, '''blockheader = parse_blockheader(self.sock.call("blockchain.block.header", [tx["height"]])) if tx["height"] > 0 else {}''', 1)
    # Only raw bytes are used for new transactions; existing rows need height
    # updates. Electrs does not support Bitcoin Core's verbose response mode.
    script_source = script_source.replace('[tx["tx_hash"], tx_in_db]', '[tx["tx_hash"], False]', 1)
    script_namespace = {}
    exec(compile(script_source, "<browser-spectrum-script-sync>", "exec"), original_script_sync.__globals__, script_namespace)
    Spectrum.sync_script = script_namespace["sync_script"]

    def sync_scripts(self):
        if self.sock.status != "ok":
            return original_sync(self)
        self.sock.prime_scripts(Script.query.all())
        try:
            return original_sync(self)
        finally:
            self.sock._script_statuses.clear()
            self.sock._read_cache.clear()
            self._browser_wallet_checked = time.monotonic()

    def subscribe_scripts(self, descriptor_id):
        self.sock.prime_scripts(Script.query.filter_by(descriptor_id=descriptor_id).all())
        try:
            return original_subscribe(self, descriptor_id)
        finally:
            self.sock._script_statuses.clear()
            self.sock._read_cache.clear()

    def refreshed_info(self):
        now = time.monotonic()
        if self.sock.ensure_connected() and now - getattr(self, "_browser_tip_checked", 0) > 15:
            header = self.sock.call("blockchain.headers.subscribe")
            self.process_notification({"method": "blockchain.headers.subscribe", "params": [header]})
            self._browser_tip_checked = now
        return original_info(self)

    def refreshed_rpc(self, obj, wallet_name=None, catch_exceptions=True):
        # Browser Workers cannot run Spectrum's socket notification threads.
        # Poll before balance/history reads to keep its original database fresh.
        if wallet_name and obj.get("method") in {"getbalances", "getwalletinfo", "listtransactions", "listunspent"} and self.sock.ensure_connected():
            now = time.monotonic()
            if now - getattr(self, "_browser_wallet_checked", 0) > 30:
                self.sync(asyncc=False)
                self._browser_wallet_checked = now
        return original_rpc(self, obj, wallet_name, catch_exceptions)

    Spectrum.getblockchaininfo = refreshed_info
    Spectrum.jsonrpc = refreshed_rpc
    Spectrum._sync = sync_scripts
    Spectrum._subcribe_scripts = subscribe_scripts


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
            if template.replace("\\", "/").endswith("wallet/settings/wallet_settings.jinja"):
                qr_button = '''<button onclick="showPageOverlay('{{ device.alias }}_export_qr_code')" type="button" class="button mt-3 mb-8">Show {{ device.name }} QR Code</button>'''
                sd_export = '''
                                {% if device.device_type == 'specter' %}
                                <a download="{{ wallet.name | ascii20 }}.txt" href="data:text/plain;charset=utf-8,{{ device.export_wallet(wallet) | urlencode }}" class="button mt-3 mb-8">Save {{ device.name }} file</a>
                                {% endif %}'''
                if source.count(qr_button) != 1:
                    raise RuntimeError("Specter Desktop DIY wallet export seam changed")
                # Use the same native device export for QR and removable media.
                source = source.replace(qr_button, qr_button + sd_export, 1)

            def refreshed():
                return uptodate()

            return source, filename, refreshed

    app.jinja_loader = BrowserTemplateLoader()


def initialize(secret_key):
    install_import_adapters()
    install_process_and_network_guards()
    install_kdf_adapter()
    install_public_derivation_adapter()
    install_electrum_adapter()

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
        EXTENSION_LIST = ["cryptoadvance.specterext.spectrum.service"]
        SQLALCHEMY_TRACK_MODIFICATIONS = False
        SERVICES_LOAD_FROM_CWD = False
        ENABLE_OWN_REQUEST_LOGGING = False
        ENABLE_WERKZEUG_REQUEST_LOGGING = False
        RASPIBLITZ_SPECTER_RPC_LOGIN_BITCOIN_CONF_LOCATION = "/disabled/bitcoin.conf"

    globals()["BrowserConfig"] = BrowserConfig  # ExtensionManager resolves the configured class by module.
    app = server.create_app(BrowserConfig)
    patch_qr_scanner_template(app)
    specter = Specter(
        data_folder=BrowserConfig.SPECTER_DATA_FOLDER,
        checker_threads=False,
        initialize=False,
    )
    with app.app_context():
        server.init_app(app, specter=specter)
        # Spectrum starts in the extension callback, after Specter's initial
        # wallet check. With background checkers disabled, run that check once
        # now so persisted wallets are loaded against the restored node.
        specter.check(check_all=True)
    app.config["ELECTRUM_DEFAULT_OPTION"] = "electrum.blockstream.info"
    options = app.config["ELECTRUM_OPTIONS"]
    app.config["ELECTRUM_OPTIONS"] = {key: options[key] for key in ("electrum.blockstream.info", "electrum.emzy.de")}
    @app.before_request
    def reconnect_spectrum():
        from flask import request
        from cryptoadvance.spectrum.util import get_blockhash
        if request.path.startswith('/static/'):
            return
        node = specter.node
        backend = getattr(node, 'spectrum', None)
        if backend is None or backend.is_connected():
            return
        navigation = request.method == 'GET' and 'text/html' in request.headers.get('Accept', '')
        if not backend.sock.ensure_connected(force=navigation):
            return
        try:
            backend.roothash = get_blockhash(backend.sock.call('blockchain.block.header', [0]))
            header = backend.sock.call('blockchain.headers.subscribe')
            backend.process_notification({'method': 'blockchain.headers.subscribe', 'params': [header]})
            backend.sync(asyncc=False)
            specter.check(check_all=True)
        except Exception:
            backend.sock.status = 'disconnected'
    os.makedirs(BrowserConfig.SPECTER_DATA_FOLDER, exist_ok=True)
    return app


def reset_data():
    shutil.rmtree("/specter-browser-state", ignore_errors=True)
    os.makedirs("/specter-browser-state", exist_ok=True)
