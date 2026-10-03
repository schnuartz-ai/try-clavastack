import React, { createContext, useContext } from 'react';
import { View, useWindowDimensions } from 'react-native';

type Insets = { top: number; right: number; bottom: number; left: number };
const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const frame = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

export const SafeAreaInsetsContext = createContext<Insets | null>(insets);
export const SafeAreaFrameContext = createContext<typeof frame | null>(frame);
export const initialWindowMetrics = { frame, insets };

export function SafeAreaProvider({ children }: React.PropsWithChildren) {
  const { width, height } = useWindowDimensions();
  // The enclosing phone already reserves space for its status bar. No extra
  // top inset is required, but consumers still need the real content frame.
  return React.createElement(
    SafeAreaInsetsContext.Provider,
    { value: insets },
    React.createElement(SafeAreaFrameContext.Provider, { value: { x: 0, y: 0, width, height } }, children),
  );
}

export function SafeAreaView({ children, ...props }: any) {
  return React.createElement(View, props, children);
}

export function useSafeAreaInsets() {
  return useContext(SafeAreaInsetsContext) ?? insets;
}

export function useSafeAreaFrame() {
  return useContext(SafeAreaFrameContext) ?? frame;
}
