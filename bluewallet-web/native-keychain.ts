import storage from './storage';
export default storage;
export const getGenericPassword = storage.getGenericPassword;
export const setGenericPassword = storage.setGenericPassword;
export const resetGenericPassword = storage.resetGenericPassword;
export const ACCESSIBLE = {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'session-only'};
export const SECURITY_LEVEL = {ANY: 'session-only'};
