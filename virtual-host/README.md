# Specter Virtual Host (website integration copy)

The canonical source and release workflow live in
[`Schnuartz/specter-virtual-host`](https://github.com/Schnuartz/specter-virtual-host).
This copy remains in the website repository so CI can compile the bridge and
exercise the browser-to-firmware integration test without depending on a
downloaded executable.

The Specter Virtual Host connects the browser-based Specter DIY simulator to
Specter Desktop on the same computer. It listens only on the loopback
interface:

- `127.0.0.1:8788` serves the connected browser view and its WebSocket bridge.
- `127.0.0.1:8789` exposes Specter DIY's existing simulator protocol to
  Specter Desktop.

No seed, PSBT, or wallet data is sent to a ClavaStack server by the bridge.
Only use public test seeds in the browser simulator.

## Build

Cross-compile the local bridge for the supported desktop platforms:

```powershell
$version = '1.0.4'
go build -trimpath -ldflags "-s -w -X main.version=$version" -o ..\downloads\ClavaStack-Virtual-Host-Windows-x64.exe .
$env:GOOS='linux'; $env:GOARCH='amd64'; go build -trimpath -ldflags "-s -w -X main.version=$version" -o ..\downloads\ClavaStack-Virtual-Host-Linux-x64 .
$env:GOOS='darwin'; $env:GOARCH='amd64'; go build -trimpath -ldflags "-s -w -X main.version=$version" -o ..\downloads\ClavaStack-Virtual-Host-macOS-x64 .
$env:GOARCH='arm64'; go build -trimpath -ldflags "-s -w -X main.version=$version" -o ..\downloads\ClavaStack-Virtual-Host-macOS-arm64 .
Remove-Item Env:GOOS, Env:GOARCH
```

Linux and macOS users may need to mark the downloaded binary executable with
`chmod +x` before running it. Unsigned macOS builds can also require an
explicit Gatekeeper approval.

For local website development:

```powershell
.\downloads\ClavaStack-Virtual-Host-Windows-x64.exe --site http://127.0.0.1:8765
```

The `/connected` entry point always starts the normal Specter DIY build and
drops temporary A/B build parameters. HTML, JavaScript, and JSON responses are
not browser-cached, so an expired build job cannot be restored into a connected
session. The newest connected simulator tab becomes active; older tabs show an
inactive status and stop reconnecting, so they cannot take the Specter Desktop
connection back. Current browser pages identify their tab to the bridge, which
also prevents older already-open page versions from reconnecting after an
upgrade.
