const workbench = document.querySelector('#specter-workbench');
const frameStatus = document.querySelector('#frame-status');

function compactCablePanel() {
  const embeddedPage = workbench.contentDocument;
  const panel = embeddedPage?.querySelector('.cable-panel');
  const mediaGrid = embeddedPage?.querySelector('.media-grid');
  if (!panel || !mediaGrid) return;
  const alreadyCurrent = panel.parentElement === mediaGrid &&
    panel.classList.contains('media-group') && panel.querySelector('.cable-route') &&
    !panel.querySelector('.cable-file');
  if (alreadyCurrent) return;

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
  route.setAttribute('aria-label', 'Bidirectional cable from Specter DIY to Specter Desktop');
  ['Specter DIY', 'Specter Desktop'].forEach((text, index) => {
    const endpoint = embeddedPage.createElement('span');
    endpoint.className = 'cable-endpoint';
    endpoint.textContent = text;
    route.append(endpoint);
    if (index === 0) {
      const link = embeddedPage.createElement('span');
      link.className = 'cable-link';
      link.setAttribute('aria-hidden', 'true');
      route.append(link);
    }
  });
  toggleLabel.textContent = 'On/Off';
  route.append(toggle);
  status.classList.add('visually-hidden');
  panel.replaceChildren(heading, route, status);
  panel.classList.add('media-group', 'cable-group');
  mediaGrid.append(panel);

  const style = embeddedPage.createElement('style');
  style.id = 'sparrow-compact-cable-style';
  style.textContent = `
    .media-grid{grid-template-columns:minmax(280px,.92fr) minmax(360px,1.25fr) minmax(270px,.9fr)}
    .memory-tray{max-width:500px;gap:8px}
    .cable-group{display:flex;flex-direction:column;justify-content:center;gap:14px;margin-top:0;padding:14px}
    .cable-group h3{margin:0;font-size:12px}
    .cable-route{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .cable-endpoint{padding:7px 8px;border:1px solid #35506a;border-radius:7px;background:#142334;font-size:10px;white-space:nowrap}
    .cable-link{position:relative;display:flex;align-items:center;justify-content:center;flex:1;min-width:28px;height:20px;color:#78bce9}
    .cable-link::before{content:"";width:100%;height:1px;background:#78bce9}
    .cable-link::after{content:"↔";position:absolute;padding:0 3px;background:#142130;font-size:17px;line-height:1}
    .cable-group .cable-toggle{margin-left:auto;padding:5px 8px;font-size:10px}
    .cable-group .cable-toggle input{width:15px;height:15px}
    .visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:1100px){.media-grid{grid-template-columns:1fr}}
    @media(max-width:560px){.memory-tray{max-width:100%;gap:4px}.cable-group{padding:10px}.cable-group .cable-toggle{margin-left:0}}
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
