(() => {
  const specter = document.querySelector('#specter-simulator');
  const keeper = document.querySelector('#keeper-runtime');
  const specterBadge = document.querySelector('#specter-badge');
  const specterStatus = document.querySelector('#specter-status');
  const qrStatus = document.querySelector('#specter-qr-status');
  const keeperStatus = document.querySelector('#keeper-status');
  const sendButton = document.querySelector('#send-keeper-qr');
  const keeperReset = document.querySelector('#keeper-reset');
  let scannerActive = false;
  let keeperScanning = false;
  let keeperFrames = [];
  let keeperGroup = '';
  let keeperSendIndex = 0;
  let keeperFrameAt = 0;
  let specterFrames = [];
  let specterGroup = '';
  let specterToken = '';
  let specterLastAt = 0;
  let sendTimer;
  let receiveTimer;
  let receiveIndex = 0;

  function qrGroup(frame) {
    const ur = frame.match(/^ur:([^/]+)/i);
    if (ur) return `ur:${ur[1].toLowerCase()}`;
    if (frame.startsWith('B$')) return 'bbqr';
    const p = frame.match(/^p\d+of\d+/i);
    return p ? 'p-of-n' : 'single';
  }

  function rememberSpecterFrame(frame, token = '') {
    if (typeof frame !== 'string' || !frame.trim()) return;
    const value = frame.trim();
    // Specter's QRCode widget starts at the literal display placeholder before
    // the firmware sets its real value. Do not feed that transient UI text to
    // Keeper's single-scan callback.
    if (value === 'Text') return;
    if (token && token !== specterToken) {
      specterFrames = [];
      specterGroup = '';
      specterLastAt = 0;
    }
    if (token) specterToken = token;
    const now = Date.now();
    const group = qrGroup(value);
    if (group === 'single') {
      // A single QR is a live display value, so a new value replaces the old
      // one immediately. Animated formats retain their frame sequence below.
      specterFrames = [value];
    } else {
      if (now - specterLastAt > 2400 || (specterGroup && group !== specterGroup)) specterFrames = [];
      if ((/^ur:[^/]+\/1(?:-|\/)/i.test(value) || /^p1of/i.test(value)) && specterFrames.length) specterFrames = [];
      if (specterFrames[specterFrames.length - 1] !== value) specterFrames.push(value);
      if (specterFrames.length > 200) specterFrames.splice(0, specterFrames.length - 200);
    }
    specterGroup = group;
    specterLastAt = now;
    if (keeperScanning) sendNextToKeeper();
  }

  function clearSpecterOutput(token = '') {
    if (token && specterToken && token !== specterToken) return;
    specterFrames = [];
    specterGroup = '';
    specterToken = '';
    specterLastAt = 0;
    if (keeperScanning) {
      keeper.contentWindow?.postMessage({ type: 'keeper-direct-qr-status', message: 'Specter DIY no longer displays a QR. Open its QR screen, then scan again.' }, location.origin);
    }
  }

  function rememberKeeperFrame(frame) {
    if (typeof frame !== 'string' || !frame.trim()) return;
    const value = frame.trim();
    const now = Date.now();
    const group = qrGroup(value);
    if (group === 'single') {
      keeperFrames = [value];
    } else {
      if (now - keeperFrameAt > 2400 || (keeperGroup && group !== keeperGroup)) keeperFrames = [];
      if ((/^ur:[^/]+\/1(?:-|\/)/i.test(value) || /^p1of/i.test(value)) && keeperFrames.length) keeperFrames = [];
      if (keeperFrames[keeperFrames.length - 1] !== value) keeperFrames.push(value);
      if (keeperFrames.length > 200) keeperFrames.splice(0, keeperFrames.length - 200);
    }
    keeperGroup = group;
    keeperFrameAt = now;
    updateSendButton();
  }

  function sendNextToKeeper() {
    if (!keeperScanning || !specterFrames.length) return;
    const frame = specterFrames[receiveIndex++ % specterFrames.length];
    keeper.contentWindow?.postMessage({ type: 'keeper-direct-qr-frame', frame }, location.origin);
  }

  function updateSendButton() {
    const hasCurrentQr = keeperFrames.length > 0;
    sendButton.disabled = !scannerActive || !hasCurrentQr;
    sendButton.title = !scannerActive
      ? 'Open a QR scanner on Specter DIY first.'
      : !hasCurrentQr ? 'Open a Keeper screen that is displaying a QR code first.'
      : 'Send Keeper QR frames to Specter DIY’s normal camera QR parser.';
    if (!scannerActive) qrStatus.textContent = 'Open the Specter QR scanner to receive frames from Keeper.';
    else if (hasCurrentQr) qrStatus.textContent = 'Specter scanner is active. Send the currently displayed Keeper QR.';
    else qrStatus.textContent = 'Specter scanner is active. Open a QR screen in Keeper.';
  }

  function sendKeeperQr() {
    if (!scannerActive) { qrStatus.textContent = 'Open the QR scanner on Specter DIY before sending.'; return; }
    if (!keeperFrames.length) {
      qrStatus.textContent = 'No QR is currently visible in Keeper. Open a Keeper QR screen and try again.';
      return;
    }
    clearInterval(sendTimer);
    keeperSendIndex = 0;
    let count = 0;
    const send = () => {
      if (!scannerActive) { clearInterval(sendTimer); sendTimer = undefined; return; }
      if (!keeperFrames.length) {
        clearInterval(sendTimer); sendTimer = undefined;
        qrStatus.textContent = 'Keeper stopped displaying a QR. Reopen its QR screen to continue.';
        return;
      }
      const frame = keeperFrames[keeperSendIndex++ % keeperFrames.length];
      specter.contentWindow?.postMessage({ type: 'simulator-inject-qr', frame }, location.origin);
      count++;
      qrStatus.textContent = keeperFrames.length > 1
        ? `Feeding Keeper’s animated QR sequence to Specter (${count} frames).`
        : `Feeding Keeper’s visible QR frame to Specter (${count}).`;
    };
    send();
    sendTimer = setInterval(send, 550);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (event.source === specter.contentWindow) {
      if (data.type === 'child-awaiting-peripherals') {
        specter.contentWindow?.postMessage({ type: 'peripherals-provide', files: [] }, location.origin);
      } else if (data.type === 'simulator-running') {
        specterBadge.textContent = 'Running'; specterBadge.classList.add('online');
        specterStatus.textContent = 'Real Specter DIY firmware is running in the browser simulator.';
      } else if (data.type === 'simulator-scanner-state') {
        scannerActive = Boolean(data.active);
        if (!scannerActive) { clearInterval(sendTimer); sendTimer = undefined; }
        updateSendButton();
      } else if (data.type === 'simulator-qr-output') {
        rememberSpecterFrame(data.frame, data.token || '');
      } else if (data.type === 'simulator-qr-output-clear') {
        clearSpecterOutput(data.token || '');
      } else if (data.type === 'simulator-qr-result') {
        qrStatus.textContent = data.ok ? 'QR frame reached Specter DIY’s real scanner input.' : data.message;
      } else if (data.type === 'peripherals-snapshot') {
        // The Specter simulator starts with an empty, isolated hardware-storage snapshot.
      }
    } else if (event.source === keeper.contentWindow) {
      if (data.type === 'keeper-runtime-ready') {
        keeperStatus.textContent = 'Keeper’s upstream React Native app is starting.';
        keeper.contentWindow?.postMessage({ type: 'keeper-runtime-ready-ack' }, location.origin);
      } else if (data.type === 'keeper-app-mounted') {
        keeperStatus.textContent = 'Bitcoin Keeper is running in this browser (TESTNET).';
      } else if (data.type === 'keeper-scan-state') {
        keeperScanning = Boolean(data.active);
        receiveIndex = 0;
        if (keeperScanning) {
          if (!specterFrames.length) {
            keeper.contentWindow?.postMessage({ type: 'keeper-direct-qr-status', message: 'No QR is currently visible on Specter DIY. Open its QR screen, then try again.' }, location.origin);
          } else {
            sendNextToKeeper();
            clearInterval(receiveTimer);
            receiveTimer = setInterval(sendNextToKeeper, 320);
          }
        } else {
          clearInterval(receiveTimer); receiveTimer = undefined;
        }
      } else if (data.type === 'keeper-qr-output-frame') {
        rememberKeeperFrame(data.frame);
      } else if (data.type === 'keeper-qr-output-clear') {
        keeperFrames = []; keeperGroup = ''; keeperFrameAt = 0; keeperSendIndex = 0; updateSendButton();
      }
    }
  });

  specter.addEventListener('load', () => {
    specter.contentWindow?.postMessage({ type: 'gallery-parent-ready' }, location.origin);
    specterBadge.textContent = 'Starting';
    specterStatus.textContent = 'Loading the Specter DIY firmware…';
  });
  keeper.addEventListener('load', () => {
    keeperStatus.textContent = 'Loading the Bitcoin Keeper app…';
  });
  sendButton.addEventListener('click', sendKeeperQr);
  document.querySelector('#specter-restart').addEventListener('click', () => {
    specter.contentWindow?.postMessage({ type: 'runtime-restart' }, location.origin);
    clearSpecterOutput();
    specterStatus.textContent = 'Restarting Specter DIY firmware…';
  });
  document.querySelector('#specter-reset').addEventListener('click', () => {
    specter.contentWindow?.postMessage({ type: 'simulator-factory-reset' }, location.origin);
    clearSpecterOutput();
    specterStatus.textContent = 'Specter DIY factory reset requested.';
  });
  keeperReset.addEventListener('click', () => {
    keeper.contentWindow?.postMessage({ type: 'keeper-reset' }, location.origin);
    keeperStatus.textContent = 'Resetting Keeper’s disposable browser-session data…';
  });
  setInterval(updateSendButton, 1000);
  window.setTimeout(() => specter.contentWindow?.postMessage({ type: 'gallery-parent-ready' }, location.origin), 50);
})();
