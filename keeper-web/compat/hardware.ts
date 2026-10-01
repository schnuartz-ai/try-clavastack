// Native hardware capabilities stay outside the browser wallet logic. The
// selected Keeper flow creates only a public descriptor-backed signer.
export const isSignerAMF = () => false;
