const workbench = document.querySelector('#specter-workbench');
const frameStatus = document.querySelector('#frame-status');

function compactCablePanel() {
  const embeddedPage = workbench.contentDocument;
  const panel = embeddedPage?.querySelector('.cable-panel');
  const memoryGroup = embeddedPage?.querySelector('.memory-group');
  if (!panel || !memoryGroup || panel.querySelector('.cable-route')) return;

  const oldHeading = panel.querySelector('h2, h3');
  const toggle = panel.querySelector('.cable-toggle');
  const toggleLabel = toggle?.querySelector('span');
  const status = panel.querySelector('#cable-status');
  if (!oldHeading || !toggle || !toggleLabel || !status) return;

  const heading = embeddedPage.createElement('h3');
  heading.id = 'cable-heading';
  heading.textContent = 'Cable Connection';
  const route = embeddedPage.createElement('div');
  route.className = 'cable-route';
  route.setAttribute('role', 'group');
  route.setAttribute('aria-label', 'Specter DIY file connection to Specter Desktop');
  const labels = ['Specter DIY', 'File', 'Specter Desktop'];
  labels.forEach((text, index) => {
    const endpoint = embeddedPage.createElement('span');
    endpoint.className = index === 1 ? 'cable-file' : 'cable-endpoint';
    endpoint.textContent = text;
    route.append(endpoint);
    if (index < labels.length - 1) {
      const arrow = embeddedPage.createElement('span');
      arrow.className = 'cable-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      route.append(arrow);
    }
  });
  toggleLabel.textContent = 'On/Off';
  route.append(toggle);
  status.classList.add('visually-hidden');
  panel.replaceChildren(heading, route, status);
  memoryGroup.append(panel);

  const style = embeddedPage.createElement('style');
  style.id = 'sparrow-compact-cable-style';
  style.textContent = `
    .memory-tray{max-width:500px;gap:8px}
    .memory-group .cable-panel{display:block;margin:14px 0 0;padding:11px 0 0;border:0;border-top:1px solid #34475a;border-radius:0;background:transparent}
    .memory-group .cable-panel h3{margin:0 0 9px;font-size:12px}
    .cable-route{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
    .cable-endpoint,.cable-file{padding:6px 8px;border:1px solid #35506a;border-radius:7px;background:#142334;font-size:10px;white-space:nowrap}
    .cable-file{color:var(--muted);font-weight:700}
    .cable-arrow::before{content:"→";color:#78bce9;font-size:12px}
    .memory-group .cable-toggle{margin-left:auto;padding:5px 8px;font-size:10px}
    .memory-group .cable-toggle input{width:15px;height:15px}
    .visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:560px){.memory-tray{max-width:100%;gap:4px}.memory-group .cable-toggle{margin-left:0}}
  `;
  embeddedPage.head.append(style);
}

function onWorkbenchLoad() {
  frameStatus.textContent = 'Specter workbench page loaded. Wait for the Desktop and DIY status indicators inside it to show that their runtimes are ready.';
  try {
    compactCablePanel();
  } catch {
    frameStatus.textContent = 'Specter workbench page loaded. Open it in a full tab if the browser blocks its embedded controls.';
  }
}

workbench.addEventListener('load', onWorkbenchLoad);
if (workbench.contentDocument?.readyState === 'complete') onWorkbenchLoad();

workbench.addEventListener('error', () => {
  frameStatus.textContent = 'The Specter workbench could not be loaded. Open it in a full tab to inspect its browser requirements.';
});
