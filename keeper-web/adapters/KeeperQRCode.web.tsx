import React, { useEffect, useId } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { View } from 'react-native';
import KeeperQRCodeSource from '../../upstream/bitcoin-keeper/src/components/KeeperQRCode';

type Props = React.ComponentProps<typeof KeeperQRCodeSource>;

function emit(type: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function isVisibleQr(nativeID: string) {
  const wrapper = document.getElementById(nativeID);
  const qr = wrapper?.querySelector('svg');
  if (!wrapper || !qr) return false;

  const bounds = qr.getBoundingClientRect();
  if (bounds.width < 100 || bounds.height < 100) return false;

  for (let node: Element | null = wrapper; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) {
      return false;
    }
  }

  const samples = [
    [bounds.left + bounds.width * 0.2, bounds.top + bounds.height * 0.2],
    [bounds.left + bounds.width * 0.8, bounds.top + bounds.height * 0.2],
    [bounds.left + bounds.width * 0.2, bounds.top + bounds.height * 0.8],
    [bounds.left + bounds.width * 0.8, bounds.top + bounds.height * 0.8],
  ];

  return samples.some(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (qr === hit || qr.contains(hit)));
  });
}

export default function KeeperQRCodeWebAdapter(props: Props) {
  const focused = useIsFocused();
  const nativeID = `keeper-qr-output-${useId().replaceAll(':', '')}`;

  useEffect(() => {
    if (!focused) {
      emit('keeper-qr-output-clear');
      return;
    }
    return () => emit('keeper-qr-output-clear');
  }, [focused]);

  // Keeper's UR encoder rotates its visible fragment every 500 ms. Emit every
  // rendered fragment so the parent can relay the complete optical sequence.
  // Some upstream modal routes keep their QR view visible without becoming the
  // focused navigation screen, so verify the rendered QR itself as a fallback.
  useEffect(() => {
    if (typeof props.qrData !== 'string' || !props.qrData) return;
    const frame = window.requestAnimationFrame(() => {
      if (focused || isVisibleQr(nativeID)) {
        emit('keeper-qr-output-frame', { frame: props.qrData });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focused, nativeID, props.qrData]);

  return (
    <View nativeID={nativeID} style={{ width: props.size + 20, height: props.size + 20, flexShrink: 0 }}>
      <KeeperQRCodeSource {...props} />
    </View>
  );
}
