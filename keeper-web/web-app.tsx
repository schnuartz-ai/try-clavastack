import React from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from '@gluestack-ui/themed-native-base';
import { AppContextProvider } from 'src/context/AppContext';
import { LocalizationProvider } from 'src/context/Localization/LocContext';
import ThemeContextProvider from 'src/context/ThemeContext';
import { BrowserTorProvider } from './web-tor-context';
import Navigator from 'src/navigation/Navigator';
import { persistor, store } from 'src/store/store';

if (typeof window !== 'undefined' && (window as any).__KEEPER_SIMULATOR_DEBUG__) {
  // Expose the actual application store only to the local browser E2E harness.
  // The normal hosted simulator does not set this flag.
  (window as any).__keeperStore = store;
}

export default function KeeperWebApp() {
  const bootMarkers = (globalThis as any).__keeperBootMarkers ??= [];
  bootMarkers.push(`react-render-${JSON.stringify(persistor.getState())}`);
  return (
    <PersistGate persistor={persistor} loading={null}>
      <Provider store={store}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <ThemeContextProvider>
              <StatusBar barStyle="light-content" />
              <LocalizationProvider>
                <AppContextProvider>
                  <BrowserTorProvider>
                    <Navigator />
                  </BrowserTorProvider>
                </AppContextProvider>
              </LocalizationProvider>
            </ThemeContextProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </Provider>
    </PersistGate>
  );
}
