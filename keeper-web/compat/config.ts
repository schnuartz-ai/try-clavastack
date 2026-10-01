export enum APP_STAGE {
  DEVELOPMENT = 'DEVELOPMENT',
  PRODUCTION = 'PRODUCTION',
}

// Keep Keeper's existing gap limit while fixing this simulator to testnet.
export default {
  GAP_LIMIT: 20,
  ENVIRONMENT: APP_STAGE.DEVELOPMENT,
  isDevMode: () => true,
};
