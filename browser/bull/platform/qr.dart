// Camera/display transport. Frames enter the original QrScannerWidget's
// _processQrData and UrQrReader; no decoding or wallet interpretation here.
import 'dart:js_interop';
import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

@JS('bullQrOutput')
external void _output(JSString frame, JSString token);
@JS('bullQrOutputClear')
external void _clearOutput(JSString token);
@JS('bullQrStart')
external void _startScan(JSFunction callback, JSFunction status);
@JS('bullQrStop')
external void _stopScan();
@JS('bullQrAttachVideo')
external void _attachVideo(web.HTMLVideoElement video);
@JS('bullQrCameraStart')
external JSPromise<JSString> _startCamera();

class BrowserQrOutput extends StatefulWidget {
  final String data;
  final Widget child;
  const BrowserQrOutput({super.key, required this.data, required this.child});
  @override
  State<BrowserQrOutput> createState() => _BrowserQrOutputState();
}

class _BrowserQrOutputState extends State<BrowserQrOutput> {
  static int _sequence = 0;
  final String token = 'bull-qr-${++_sequence}';
  @override
  Widget build(BuildContext context) {
    final visible =
        TickerMode.valuesOf(context).enabled &&
        (ModalRoute.of(context)?.isCurrent ?? true);
    final data = widget.data;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (visible && data.isNotEmpty) {
        _output(data.toJS, token.toJS);
      } else {
        _clearOutput(token.toJS);
      }
    });
    return widget.child;
  }

  @override
  void dispose() {
    _clearOutput(token.toJS);
    super.dispose();
  }
}

class BrowserQrReaderWidget extends StatefulWidget {
  final ValueChanged<String> onScanned;
  const BrowserQrReaderWidget({super.key, required this.onScanned});
  @override
  State<BrowserQrReaderWidget> createState() => _BrowserQrReaderState();
}

class _BrowserQrReaderState extends State<BrowserQrReaderWidget> {
  String _status = 'Scan a QR code from Specter DIY or your camera.';
  bool _camera = false;
  void _begin({bool useCamera = false}) {
    _stopScan();
    setState(() {
      _camera = useCamera;
      _status = useCamera
          ? 'Opening camera…'
          : 'Waiting for the QR displayed on Specter DIY…';
    });
    _startScan(
      ((JSString frame) {
        if (mounted) widget.onScanned(frame.toDart);
      }).toJS,
      ((JSString status) {
        if (mounted && !_camera)
          setState(() {
            _status = status.toDart;
          });
      }).toJS,
    );
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Colors.black,
    child: Column(
      children: [
        Expanded(
          child: _camera
              ? HtmlElementView.fromTagName(
                  tagName: 'video',
                  onElementCreated: (element) {
                    _attachVideo(element as web.HTMLVideoElement);
                  },
                )
              : const Center(
                  child: Icon(
                    Icons.qr_code_scanner,
                    size: 96,
                    color: Colors.white54,
                  ),
                ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            _status,
            style: const TextStyle(color: Colors.white),
            textAlign: TextAlign.center,
          ),
        ),
        FilledButton.icon(
          icon: const Icon(Icons.qr_code_scanner),
          label: const Text('Scan from Specter DIY'),
          onPressed: () => _begin(),
        ),
        TextButton(
          onPressed: () async {
            _begin(useCamera: true);
            WidgetsBinding.instance.addPostFrameCallback((_) async {
              try {
                final status = (await _startCamera().toDart).toDart;
                if (mounted)
                  setState(() {
                    _status = status;
                  });
              } catch (_) {
                if (mounted)
                  setState(() {
                    _status =
                        'Camera unavailable. You can scan from Specter DIY.';
                  });
              }
            });
          },
          child: const Text('Use camera'),
        ),
        const SizedBox(height: 110),
      ],
    ),
  );
  @override
  void dispose() {
    _stopScan();
    super.dispose();
  }
}
