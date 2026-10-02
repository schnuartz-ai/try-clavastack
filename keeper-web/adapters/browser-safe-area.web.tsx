import React, { createContext, useContext } from 'react';
import { View } from 'react-native';

type Insets = { top: number; right: number; bottom: number; left: number };
const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const frame = { x: 0, y: 0, width: 0, height: 0 };

export const SafeAreaInsetsContext = createContext<Insets | null>(insets);
export const SafeAreaFrameContext = createContext<typeof frame | null>(frame);
export const initialWindowMetrics = { frame, insets };

export function SafeAreaProvider({ children }: React.PropsWithChildren) {
  return React.createElement(
    SafeAreaInsetsContext.Provider,
    { value: insets },
    React.createElement(SafeAreaFrameContext.Provider, { value: frame }, children),
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
