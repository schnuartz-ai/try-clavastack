const latestRelease = 'https://github.com/cryptoadvance/specter-virtual-host/releases/latest';
const releaseApi = 'https://api.github.com/repos/cryptoadvance/specter-virtual-host/releases/latest';
const assetNames = {
  windows: [/^Specter-Virtual-Host\.exe$/i, /^Specter-Virtual-Host-Windows-x64\.exe$/i],
  'linux-x64': [/^specter-virtual-host_[\w.+~\-]+_amd64\.deb$/i, /^Specter-Virtual-Host-Linux-x64$/i],
  'macos-arm64': [/^Specter-Virtual-Host-macOS-arm64$/i, /^Specter-Virtual-Host-macOS-universal\.zip$/i],
  'macos-x64': [/^Specter-Virtual-Host-macOS-x64$/i, /^Specter-Virtual-Host-macOS-universal\.zip$/i],
};

const panel = document.querySelector('#virtual-host');
const downloads = [...document.querySelectorAll('[data-virtual-host-platform]')];
let pendingRelease;

async function refreshDownloads() {
  if (pendingRelease) return pendingRelease;
  // Never leave a previously resolved, versioned Linux filename after an API failure.
  for (const link of downloads) link.href = latestRelease;
  pendingRelease = (async () => {
    try {
      const response = await fetch(releaseApi, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return;
      const release = await response.json();
      if (release.draft || release.prerelease || !Array.isArray(release.assets)) return;
      for (const link of downloads) {
        const patterns = assetNames[link.dataset.virtualHostPlatform] || [];
        const asset = patterns.map(pattern => release.assets.find(item =>
          typeof item.name === 'string' && pattern.test(item.name))).find(Boolean);
        if (asset) link.href = `${latestRelease}/download/${encodeURIComponent(asset.name)}`;
      }
    } catch {
      // The latest release page remains usable without JavaScript or GitHub API access.
    }
  })();
  try {
    await pendingRelease;
  } finally {
    pendingRelease = undefined;
  }
}

panel?.addEventListener('toggle', () => {
  if (panel.open) void refreshDownloads();
});
for (const link of downloads) {
  link.addEventListener('click', async event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Resolve again at click time, including when a tab has stayed open across a release.
    await refreshDownloads();
    window.location.assign(link.href);
  });
}
