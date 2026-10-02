import React, { createContext, useMemo } from 'react';

export const TorContext = createContext(null);

export function BrowserTorProvider({ children }) {
  const value = useMemo(
    () => ({
      torStatus: 'OFF',
      orbotTorStatus: 'OFF',
      inAppTor: 'OFF',
      setTorStatus: () => {},
      setInAppTor: () => {},
      openOrbotApp: async () => false,
      setOrbotTorStatus: () => {},
      checkTorConnection: async () => 'OFF',
      globalTorStatus: 'OFF',
    }),
    []
  );

  return <TorContext.Provider value={value}>{children}</TorContext.Provider>;
}
