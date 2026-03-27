# asyncio EINTR Patch

Die Datei `f469-disco/libs/common/asyncio/core.py` auf dem VPS wurde gepatcht um EINTR (OSError 4) zu behandeln.

## Geänderte Stelle (Zeile ~117)

```python
# Original:
def wait_io_event(self, dt):
    for s, ev in self.poller.ipoll(dt):

# Gepatcht:
def wait_io_event(self, dt):
    try:
        items = list(self.poller.ipoll(dt))
    except OSError:
        return
    for s, ev in items:
```

Grund: SDL Event-Loop sendet Signale die `select.poll()` unterbrechen → EINTR wird abgefangen.
