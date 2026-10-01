import cryptoJS from 'crypto-js';

export const hash256 = (value: string) => cryptoJS.SHA256(value).toString(cryptoJS.enc.Hex);
export const hash512 = (value: string) => cryptoJS.SHA512(value).toString(cryptoJS.enc.Hex);
export const encrypt = (key: string, value: string) => cryptoJS.AES.encrypt(value, key).toString();
export const decrypt = (key: string, value: string) => cryptoJS.AES.decrypt(value, key).toString(cryptoJS.enc.Utf8);
