import React, { useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';
import KeeperQRCodeSource from '../../upstream/bitcoin-keeper/src/components/KeeperQRCode';

type Props = React.ComponentProps<typeof KeeperQRCodeSource>;

function emit(type: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export default function KeeperQRCodeWebAdapter(props: Props) {
  const focused = useIsFocused();

  useEffect(() => {
    if (!focused) {
      emit('keeper-qr-output-clear');
      return;
    }
    return () => emit('keeper-qr-output-clear');
  }, [focused]);

  // Keeper's UR encoder rotates its visible fragment every 500 ms. Emit every
  // rendered fragment so the parent can relay the complete optical sequence.
  useEffect(() => {
    if (focused && typeof props.qrData === 'string' && props.qrData) {
      emit('keeper-qr-output-frame', { frame: props.qrData });
    }
  }, [focused, props.qrData]);

  return <KeeperQRCodeSource {...props} />;
}
