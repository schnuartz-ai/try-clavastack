import { Dimensions } from 'react-native';

// Inside the simulator, "screen" is the physical desktop monitor. Keeper's
// phone spacing must instead use the app viewport, excluding the outer status
// bar. Read dimensions at call time so newly rendered screens follow resizes.
export const windowHeight: number = Dimensions.get('window').height;
export const windowWidth: number = Dimensions.get('window').width;
export const getTransactionPadding = () => Dimensions.get('window').height * 0.047;
export const hp = (height: number) => (height / 812) * Dimensions.get('window').height;
export const wp = (width: number) => (width / 375) * Dimensions.get('window').width;
