# Browser-Simulator-Absturz: Diagnose vom 15.09.2026

## Ergebnis und Geltungsbereich

Die Ursache der konkreten fotografierten Session ist weiterhin nicht vollständig identifiziert. Zwei voneinander unabhängige Fehlermechanismen sind jetzt gezielt reproduziert:

1. Ein überlebender Start-Timer beendet nach einem Neustart den falschen Worker und produziert exakt die Meldung „82 seconds“.
2. Die aktuellen MockUI-Binärdateien können bei endlichen, mäßig tiefen Python-Aufrufketten einen nicht von Python abgefangenen Engine-Stackoverflow erzeugen. Die verfügbare Tiefe hängt stark von der WASM-Kompilierungsstufe ab.

Der normale MockUI-Klickpfad zum gemeldeten RangeError ist damit noch nicht gefunden. Kein Zusammenhang zwischen Device 1 und Device 2 ist bewiesen. Keine Produktionsdateien, Konfigurationen oder Prozesse wurden verändert. Lokal wurden ausschließlich neue Diagnoseprogramme, Probes und Ergebnisse angelegt; bestehende Benutzeränderungen wurden erhalten.

## Beweismittel und Produktionsstand

Screenshot `C:/Users/finnn/Downloads/photo_2026-09-15_10-55-46.jpg` visuell geprüft: Device 1 meldet 82 Sekunden, Device 2 den RangeError, Device 3 zeigt das Dashboard. Schwarze Displays belegen keine fehlende vorherige Interaktion.

HTTPS-Abgleich am 15.09.2026 ab 09:59 UTC; Ergebnisse einschließlich Response-Headern und SHA-256: `test-results/diagnosis/production.json`.

| Variante | Quellcommit laut Manifest und Top-Level-Checkout | Artefaktversion |
|---|---|---|
| DIY | 89431c644cc300c55b53220d262a31be02353969 | ecb01f53ab30c780 |
| Playground | 2b5c1acf95e4ba4b5faa04a07c64cf8164d65ce4 | 532870e7660a15f4 |
| Alternative | 5d3e5ba2f667d035bd2375b370fb6fc7c33da458 | bd283cb8f64017e2 |

Alle neun heruntergeladenen JS/WASM/DATA-Dateien stimmten beim Produktionsabgleich mit den Manifest-Hashes und den lokalen Binärdateien überein. Vor den Änderungen stimmten auch site.js, runtime-worker.js und simulators/index.html zwischen HTTPS, SSH-Serverdateien und lokal überein. `python browser/verify-build.py` besteht für alle drei Varianten. Das belegt den damaligen Produktionsstand, nicht rückwirkend den Browsercache der fotografierten Session.

Provenienzgrenzen:

- Im Ziel-Repository existiert kein AGENTS.md. Die übergebenen Anweisungen und das zusätzliche AGENTS.md im Playground-Quellcheckout wurden gelesen. `bd ready --json` scheitert, weil bd hier nicht installiert/im PATH ist; kein Ersatz-Issue-Tracker angelegt.
- Zahlreiche Änderungen waren bereits vor Beginn vorhanden. Kein Commit, Reset oder Submodule-Reparaturversuch wurde durchgeführt.
- Playground-Gitstatus scheitert am Submodule-Verweis auf `/home/finn/mockui-build-7ReUwQ/play/f469-disco`. Lokale MicroPython-main.c enthält den Emscripten-2-MiB-Patch nicht. Der tatsächlich gestartete Build meldet dagegen 2097152 Bytes Stacklimit.
- `/var/www/try-clavastack` ist kein Git-Repository.
- Der Server-Checkout der Alternative hat den richtigen Top-Level-Commit und lokale Patches, enthält aber weiterhin `lv_sdl_mouse_handler(&event); lv_indev_read(s_mouse);` in browser_pointer(). Seine Build-WASM hat SHA-256 `c51559ddceba701c463e81ebb8a5337709fa4e4d6a8dd5e6ef74911a3b72a6e8`; deployt ist `7efa9a6ad1554fd28c5348215b800cbac288c595691abfe67a10e846662ce31c`.
- Das Server-SDK meldet 3.1.74. build-info.json dokumentiert Artefakthashes und Top-Level-Commit, aber keine vollständigen Hashes der gepatchten Buildquellen/Submodule/Compileraufrufe. Eine lückenlose Rekonstruktion der Produktionsquellen ist damit nicht möglich. Die Tests benutzen deshalb die nachweislich identischen Produktionsbinärdateien.

## Device 1: belegter Timerfehler

Stellen vor der Reparatur: `browser/site.js` start(), globale Startzeit/Timer, restart() und failure(). Die reparierte Fassung verwendet stattdessen eine lokale Startzeit pro Worker-Generation.

start() überschreibt startupTimer und startupStartedAt. restart() beendet den Worker, löscht aber den bisherigen Start-Timer nicht. Der alte Callback liest später die neue globale Startzeit und failure() beendet den aktuell referenzierten Worker. Selbst eine running-Nachricht des zweiten Workers löscht nur dessen Timer; der erste ist inzwischen nicht mehr über startupTimer erreichbar.

Gezielter Test: `node browser/diagnose-restart.mjs`.

Unverändertes site.js, Playwright-Browseruhr, Worker-Testdouble ohne WASM; Neustart/Snapshot-Antwort gezielt gesteuert:

| Fall | Ergebnis bei t=90 s |
|---|---|
| Ein Start, keine Bereitschaft | 90 seconds |
| Zweiter Start bei t=8 s, keine Bereitschaft | 82 seconds, zweiter Worker beendet |
| Zweiter Start bei t=8 s, running bei t=10 s | ebenfalls 82 seconds, bereits bereiter zweiter Worker beendet |

Ergebnisdatei: `test-results/diagnosis/restart-timer.json`.

Die 8 Sekunden beziehen sich auf den neuen Start; bei real nicht antwortendem Worker kann die Snapshot-Wartezeit von 3 Sekunden einen früheren Restart-Klick entsprechend verschieben. Es ist nicht belegt, dass der Nutzer neu gestartet hatte. Eine ältere site.js-Version bleibt ebenfalls offen. Der jetzige Desktop-Timeout beträgt 90000 ms, mobil 180000 ms.

Zusätzlicher Diagnosefehler: `wasm-ready` beendet den Start-Timer nicht; erst `running` tut dies. Die Meldung „WebAssembly runtime did not report ready“ kann daher auch nach empfangenem wasm-ready erscheinen. Sie ist kein zuverlässiger Phasennachweis. Timeout beweist weder Speichermangel noch CPU-Starvation.

`worker.onerror` ruft aktuell direkt failure() auf. Kein automatischer Worker-Neustart vorhanden. Neustarts kommen von den Restart-/Factory-Schaltflächen bzw. der Gallery-Nachricht runtime-restart. Scanner-/Snapshot-Timer sind keine automatischen Worker-Neustarts.

Umgesetzt im Fork: Start-Timer werden vor jedem Neustart/Start gelöscht; Timer und Worker-Nachrichten sind an eine konkrete Laufgeneration gebunden; überlappende Restart-Anforderungen werden serialisiert; alte Callbacks können neue Worker nicht mehr beenden. Worker-Fehler reichen Stack, Dateiname und Position an die Oberfläche weiter. Die Änderung ist lokal getestet und noch nicht deployt. Keine Timeout-Verlängerung war erforderlich.

## Device 2: belegter Stackoverflow und offene UI-Ursache

Lokale Probes ersetzen nur das Python-Einstiegsprogramm im flüchtigen Worker-Dateisystem. JS/WASM/DATA-Artefakte bleiben unverändert. Kein gespeicherter Benutzerzustand wird geladen/verändert.

`diagnose-recursion.py` ruft eine Python-Funktion rekursiv innerhalb eines äußeren try/except auf. Beide MockUI-Varianten melden:

- MicroPython 1.25.0, `HAS_SETRECURSIONLIMIT False`.
- `stack: 688 out of 2097152` am Anfang.
- Chromium 153.0.8010.12: `RangeError: Maximum call stack size exceeded`.
- Firefox 155.0: `InternalError: too much recursion`.
- Playwright-WebKit 26.6: `RangeError: Maximum call stack size exceeded.`
- Kein PYTHON_CAUGHT. Python-try/except schützt somit im konkreten Versuch nicht gegen den Engine-Fehler; der Unterschied der beiden Firmware-Hauptloops erklärt ihn nicht.

WebKit bietet in diesem Windows-Test kein transferControlToOffscreen. Nur die displayfreie Python-Probe lief dort mit headlessDisplay; dies ist kein Safari-/iPhone-Gallery-Test.

### Endliche Aufrufkette und Kompilierungsstufe

`diagnose-depth.py` protokolliert jede Tiefe und micropython.mem_info(). Die Kette endet bei einer einstellbaren Tiefe, ist also nicht notwendig unendlich:

| Test, jeweils beide Varianten | Ergebnis |
|---|---|
| Standard-Chromium, Ziel 50 | letzter Tiefenmarker 28; etwa 8112 Bytes gemessener Stack; Engine-RangeError |
| Identischer Test, nur Chromium `--js-flags=--no-liftoff` | erreicht 50, RETURN 50, PROBE_DONE |
| Optimierende Engine, Ziel 150 | letzter Tiefenmarker 117; Engine-RangeError |

Belege: `depth50-default.json`, `depth50-optimized.json`, `depth-chromium.json`, `depth-chromium-optimized.json` in `test-results/diagnosis/`.

Der Flag-Vergleich ist ein diagnostischer Eingriff, kein Browser-Workaround zur Auslieferung. Die Zahlen gelten für diese Probe und Engine; sie sind keine allgemeine Rekursionsgrenze für die Firmware. Eine normale endliche Import-/Konstruktor-/Callback-Kette könnte je nach Engine/Tiering scheitern. Dass ein konkreter MockUI-Pfad die Grenze erreicht, ist noch unbewiesen.

### Warum der vorhandene Stackcheck nicht genügt

Im gelesenen MicroPython-1.25-Quellstand ruft fun_bc_call() mp_cstack_check() auf (`py/objfun.c:256`). Die ältere API mp_stack_check() existiert ebenfalls. Beide prüfen den Abstand lokaler C-Variablen zum gespeicherten Stackanfang (`py/cstack.c`, `py/stackctrl.c`). Unter WASM misst dies den C-Stack im linearen Speicher. Die Engine verwaltet zusätzlich ihren JS/WASM-Aufrufstack; dessen Verbrauch lässt sich daraus nicht ausreichend ableiten. Die Probe scheitert weit unter dem gemeldeten 2-MiB-Limit.

Damit ist „gar keine Begrenzung“ ungenau: Ein C-Stacklimit ist vorhanden. Der versuchte sys.setrecursionlimit(256)-Aufruf ist jedoch wirkungslos, und der C-Stackcheck verhindert diesen Engine-Overflow nicht. 8-MiB-STACK_SIZE, 64-KiB-Asyncify-Speicher und 16-MiB-GC-Heap bezeichnen andere Ressourcen.

Die gespeicherten Error-Stacks zeigen wiederholte Folgen aus invoke_iiiii, Asyncify-import/export-Wrappers und WASM-Funktionen 5517 / 5081 / 4871 / 7939. Im aktuellen Glue (`micropython.js:10812` beim Playground) fängt invoke_iiiii JS-Exceptions ab, stellt den linearen Stack wieder her und wirft nichtnumerische Exceptions mit `if (e !== e+0) throw e` erneut. Ein RangeError wird dadurch nicht in eine Python-Ausnahme umgewandelt.

Es wurden die von der Engine gelieferten Stacks ohne eigene Speicherungskürzung gesichert; Chromium verwendet in den neueren Probes stackTraceLimit=2000. Die Produktions-WASM enthält keine name-Sektion. C-Symbole/Quellzeilen sind daher nicht vollständig auflösbar; Firefox/WebKit können ihre eigenen Stacklimits haben. Die früheste Rekursionsprobe nutzte noch 100 Frames; die nachfolgenden Tiefenprobes enthalten längere Chromium-Stacks.

Im Fork ist nun für beide MockUI-Builds `MICROPY_STACKLESS=1` plus `MICROPY_STACKLESS_STRICT=1` vorgesehen. Das nutzt MicroPythons vorhandene heapbasierte Codezustände für rekursive Bytecode-Aufrufe und verhindert den Rückfall in C-Rekursion, wenn kein Codezustand angelegt werden kann. Das ist eine gezielte Aufruftiefenmaßnahme, kein Heap-/Timeout- oder `try/except`-Workaround. Ein Neubau konnte in dieser Windows/WSL-Umgebung nicht abgeschlossen werden, weil das vorhandene emsdk nach dem Laden kein `emcc` bereitstellt; die Änderung muss daher noch mit frisch erzeugten Artefakten und den Rekursionsproben verifiziert werden.

Ein anderer NLR/setjmp-Modus bleibt ein gesondertes A/B-Buildexperiment. Ein pauschales Python-Limit 256 ist durch die Messungen ausdrücklich nicht abgesichert.

## Asyncify, GC, Events und Layout

Der deployte Glue implementiert emscripten_scan_registers() mit Asyncify.handleSleep(), safeSetTimeout(...,0), Scan des ausgelagerten Registerbereichs und wakeUp() (`micropython.js:8867`). GC ist also ein zusätzlicher echter asynchroner Pfad. Der Timeout verhindert dort bewusst unmittelbares rekursives Wiederaufnehmen. emscripten_scan_stack() scannt ergänzend den linearen Stack. Außerdem enthält der Glue fd_sync mit handleSleep; beim verwendeten MEMFS ohne syncfs wird wakeUp synchron aufgerufen, also ist nicht jeder handleSleep-Aufruf zwingend ein tatsächlicher Suspend.

`display.update()` ruft LVGL und anschließend emscripten_sleep(1). Automatische GC bei Allokationen ist neben explizitem gc.collect() relevant. Die Emscripten-Dokumentation bestätigt die Reentrancy-Einschränkungen und beschreibt setjmp/longjmp separat:
https://emscripten.org/docs/porting/asyncify.html#reentrancy
https://emscripten.org/docs/porting/setjmp-longjmp.html
Die versionsspezifischen Aussagen oben stammen aus dem deployten 3.1.74-Glue, nicht aus der heutigen Dokumentationsversion.

Neue Kontrollen:

- Bestehende Pointer/GC-Regression: beide aktuellen Varianten bestehen jeweils zwölf Klicks mit gc.collect() im LVGL-Callback. `test-results/diagnosis/pointer-gc.json`.
- GC aus aktiver Python-Aufrufkette bei zusätzlichen Tiefen 0, 5, 10, 15 und 20, jeweils mit display.update() dazwischen: beide Varianten bestehen. `gc-depth-chromium.json`.
- Das beweist keinen allgemeinen Ausschluss aller Asyncify-Probleme. Der hier reproduzierte reine Rekursions-RangeError benötigt weder einen Pointer noch einen expliziten GC-/sleep-Aufruf.

Quellprüfung der MockUI-Kandidaten:

- `SpecterGui.navigate_to -> _do_transition -> AppScreen` und RebuildableObj-Factories bilden verschachtelte Konstruktor-/Layoutpfade. Animations- und Refresh-Sperren sind vorhanden; kein konkreter unendlicher Zyklus bewiesen.
- Wallet-/Seed-Labels behandeln SIZE_CHANGED mit optimize_font_size(), das Text und Schrift wieder verändert. Das ist ein sinnvoller Kandidat für erneute Layoutinvalidierung, aber noch keine nachgewiesene Stackrekursion.
- Die gelesene LVGL-Implementierung lv_obj_update_layout() besitzt update_layout_mutex gegen direkte Wiederbetretung. layout_update_core() traversiert Kinder rekursiv; die äußere Layoutwiederholung ist eine while-Schleife. Endloses Relayout und rekursiver Engine-Overflow müssen unterschieden werden.
- Keyboard-Cancel setzt Text vor dem Unbind zurück; Delete-/Defocus-Ereignisse und VALUE_CHANGED könnten andere Handler erreichen. Kein entsprechender Crash reproduziert.
- Der JS-Worker traversiert das Dateisystem rekursiv in walk(); seine regulären handle()-Aufrufe liegen allerdings in try/catch und melden operation-error. Eine sehr tiefe importierte Verzeichnisstruktur wäre gesondert zu testen, passt aber nicht unmittelbar zum ungefangenen Worker-Fehler.

## Handshake und normale Gallery-Kontrollen

`node browser/diagnose-handshake.mjs`: reales Parent-/Child-JS, Worker-Testdouble. Jeweils 1,5 Sekunden gezielte Verzögerung:

- Aktuell, Parent später: drei Worker starten.
- Aktuell, Kinder später: drei Worker starten.
- Nur parent-ready-Sendung im ausgelieferten Testresponse entfernt, Parent später: null Worker starten, alle warten auf Peripherien.

Das ist ein kontrollierter Vergleich mit entfernter Handshake-Komponente, keine Rekonstruktion einer bestimmten früheren Revision. Er belegt den verlorenen Nachrichtenmechanismus und die Wirkung des aktuellen Handshakes. Ohne Handshake-Fortschritt werden im normalen Bootstrap noch keine Worker-/Start-Timer angelegt (`await awaitPeripherals()` vor start()). Dieser Mechanismus allein erklärt die 82-Sekunden-Meldung nicht.

`node browser/diagnose-gallery.mjs`: drei parallele reale Worker, je 12 Canvas-Klicks pro MockUI in drei Durchgängen; Starts, Buildversionen, Worker-Logs und Fehler aufgezeichnet. Chromium normal, Chromium mit CDP-CPU-Faktor 6 und Netzwerkparametern 100 ms / 625000 B/s, Firefox normal: alle drei Geräte laufen, keine erfassten Worker-/Abort-/operation-error-/Pageerror-Ereignisse. running-Zeitpunkte ab Seitenaufruf etwa 2,6–4,2 s; 14,8–17,5 s; 5,8–6,4 s.

Die CDP-Drosselung wurde am Seitentarget eingestellt; sie ist kein Nachweis gleichmäßiger Drosselung aller Worker und keine RAM-/Mobilhardware-Emulation. Keine systematische OOM-Untersuchung, kein betroffener Rechner, kein echter Safari. Die Klickkoordinaten sind eine begrenzte Smoke-Sequenz und keine vollständige Navigation durch alle Screens. Frühere DIY-Timeouts wurden in diesen drei Läufen nicht reproduziert.

## Reproduzieren (PowerShell, Repository-Root)

```powershell
node browser/diagnose-production.mjs
node browser/diagnose-restart.mjs
node browser/diagnose-handshake.mjs
node browser/diagnose-gallery.mjs

$env:DIAG_PROBE='browser/probes/diagnose-depth.py'
$env:DIAG_CLICKS='0'
$env:DIAG_ENGINE='chromium'
$env:DIAG_MAX_DEPTH='50'
Remove-Item Env:DIAG_JS_FLAGS -ErrorAction SilentlyContinue
$env:PROBE_RESULT='diagnosis/depth50-default.json'
node browser/diagnose-runtime.mjs
$env:DIAG_JS_FLAGS='--no-liftoff'
$env:PROBE_RESULT='diagnosis/depth50-optimized.json'
node browser/diagnose-runtime.mjs
```

Für den reinen Rekursionsfehler DIAG_PROBE auf `browser/probes/diagnose-recursion.py` setzen; DIAG_ENGINE kann chromium, firefox oder webkit sein. Für den GC-Test `browser/probes/diagnose-gc-depth.py` verwenden. DIAG_JS_FLAGS vorher entfernen, wenn wieder mit Standard-Chromium getestet wird. Produktionsprüfung lädt nur öffentliche Dateien herunter; alle Laufzeittests bedienen einen lokalen temporären HTTP-Server.

## Minimal erforderliche Informationen vom betroffenen Rechner

Für Zuordnung des Screenshots: Browsername und vollständige Version, Betriebssystem/Version und Gerätemodell; soweit bekannt die genaue Klick-/Navigations-/Restart-Abfolge und ob der Tab zuvor im Hintergrund war. Für Ressourcenhypothesen zusätzlich RAM-Ausstattung.

Für eine erneute Aufnahme: Console mit Preserve log ab Seitenaufruf, vollständiger Worker-Errorstack, Start-/Restart-Zeitpunkte pro Gerät und letzte Startphase (Worker erzeugt, Dependencies, wasm-ready, Python-Marker, running). Network-Nachweise der geladenen site.js/runtime-worker.js und der JS/WASM/DATA-URLs inklusive ?v, Cache-Herkunft sowie zugehöriger Manifestversion; idealerweise Response-Hashes. Der GitHub-Link unter dem Gerät genügt nicht. Keine Walletgeheimnisse oder vollständigen privaten Speicherexporte erforderlich.

Die entscheidenden Trennversuche sind: gleicher realer UI-Ablauf auf exakt denselben Artefakten kalt/optimiert und in der betroffenen Engine; Stack vor automatischem Worker-Abbruch sichern; Restart-Zeitachse gegen alten Timer abgleichen; bei Asyncify-Verdacht Callbacks und GC-Unwindzustände gezielt instrumentieren. Bis dahin bleibt die konkrete Ursache des Device-2-UI-Crashs offen.
