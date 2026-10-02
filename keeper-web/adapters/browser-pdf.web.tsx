import React from 'react';

export default function BrowserPdf({ source, style, ...props }: any) {
  const uri = typeof source === 'string' ? source : source?.uri;
  if (!uri) return null;

  return React.createElement('iframe', {
    ...props,
    title: 'Bitcoin Keeper PDF preview',
    src: uri,
    style: { border: 0, width: '100%', height: '100%', ...style },
  });
}
