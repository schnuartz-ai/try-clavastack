import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type ScannedCode = { type: string; value: string };
type Scanner = { onCodeScanned?: (codes: ScannedCode[], frame?: unknown) => void };

export function useCodeScanner(scanner: Scanner) { return scanner; }
export function useCameraPermission() { return { hasPermission: true, requestPermission: async () => true }; }
export function useCameraDevices() { return [{ id: 'browser-camera', position: 'back' }]; }

function submit(scanner: Scanner | undefined, value: string) {
  if (value) scanner?.onCodeScanned?.([{ type: 'qr', value }], { width: 0, height: 0 });
}

export function Camera({ style, isActive, codeScanner }: { style?: unknown; isActive: boolean; codeScanner?: Scanner }) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>();
  const canvas = useRef<HTMLCanvasElement>();
  const stream = useRef<MediaStream>();
  const scanner = useRef<Scanner>();
  const frameRequest = useRef(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('Camera is off until you start it.');
  const [directActive, setDirectActive] = useState(false);
  const [directMessage, setDirectMessage] = useState('');

  scanner.current = codeScanner;

  useEffect(() => {
    if (!root.current) return;
    const videoElement = document.createElement('video');
    videoElement.setAttribute('playsinline', '');
    videoElement.muted = true;
    videoElement.autoplay = true;
    Object.assign(videoElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', zIndex: '0', pointerEvents: 'none', display: 'none' });
    const canvasElement = document.createElement('canvas');
    canvasElement.style.display = 'none';
    root.current.append(videoElement, canvasElement);
    video.current = videoElement;
    canvas.current = canvasElement;
    return () => {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = undefined;
      videoElement.remove(); canvasElement.remove();
    };
  }, []);

  useEffect(() => {
    if (!isActive) setDirectActive(false);
  }, [isActive]);

  useEffect(() => {
    if (!directActive || !isActive) return;
    const onFrame = (event: Event) => {
      const frame = (event as CustomEvent<{ frame: string }>).detail?.frame;
      if (typeof frame !== 'string' || !frame.trim()) return;
      setDirectMessage('Receiving QR frames from Specter DIY…');
      submit(scanner.current, frame);
    };
    const onStatus = (event: Event) => {
      const message = (event as CustomEvent<{ message: string }>).detail?.message;
      if (message) setDirectMessage(message);
    };
    window.addEventListener('keeper-direct-qr-frame', onFrame);
    window.addEventListener('keeper-direct-qr-status', onStatus);
    window.dispatchEvent(new CustomEvent('keeper-direct-scan-state', { detail: { active: true } }));
    return () => {
      window.removeEventListener('keeper-direct-qr-frame', onFrame);
      window.removeEventListener('keeper-direct-qr-status', onStatus);
      window.dispatchEvent(new CustomEvent('keeper-direct-scan-state', { detail: { active: false } }));
    };
  }, [directActive, isActive]);

  useEffect(() => {
    if (!cameraActive || !isActive) return;
    let lastValue = '';
    let lastAt = 0;
    const decodeFrame = () => {
      frameRequest.current = requestAnimationFrame(decodeFrame);
      const videoElement = video.current;
      const canvasElement = canvas.current;
      const decoder = (window as any).jsQR;
      if (!videoElement || !canvasElement || !decoder || videoElement.readyState < 2) return;
      const context = canvasElement.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
      context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
      const result = decoder(context.getImageData(0, 0, canvasElement.width, canvasElement.height).data,
        canvasElement.width, canvasElement.height, { inversionAttempts: 'attemptBoth' });
      if (result?.data && (result.data !== lastValue || Date.now() - lastAt > 1800)) {
        lastValue = result.data; lastAt = Date.now(); submit(scanner.current, result.data);
      }
    };
    frameRequest.current = requestAnimationFrame(decodeFrame);
    return () => cancelAnimationFrame(frameRequest.current);
  }, [cameraActive, isActive]);

  useEffect(() => {
    const videoElement = video.current;
    if (!videoElement) return;
    videoElement.style.display = cameraActive ? 'block' : 'none';
    if (cameraActive && stream.current) videoElement.srcObject = stream.current;
  }, [cameraActive]);

  const startCamera = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      stream.current = media;
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      setCameraActive(true);
      setCameraMessage('Camera active. Point it at a Keeper QR code.');
    } catch {
      setCameraMessage('Camera permission was denied or no camera is available. Direct simulator scanning still works.');
    }
  };

  return (
    <View ref={root as any} style={[styles.container, style as any]}>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => void startCamera()}>
          <Text style={styles.buttonText}>{cameraActive ? 'Camera active' : 'Use camera'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={[styles.button, styles.directButton]} onPress={() => {
          setDirectActive((value) => !value);
          setDirectMessage(directActive ? '' : 'Waiting for Specter DIY QR frames…');
        }}>
          <Text style={styles.buttonText}>{directActive ? 'Stop scanning' : 'Scan from Specter DIY'}</Text>
        </Pressable>
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{directMessage || cameraMessage}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#171b1a', overflow: 'hidden' },
  controls: { zIndex: 1, gap: 8, alignItems: 'center', justifyContent: 'center', width: '100%' },
  button: { backgroundColor: '#26332b', borderColor: '#5b705f', borderWidth: 1, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 9 },
  directButton: { backgroundColor: '#1a4d3a', borderColor: '#6f997e' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  status: { zIndex: 1, color: '#d1d8d2', textAlign: 'center', padding: 8, fontSize: 11 },
});
