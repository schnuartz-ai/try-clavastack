const unavailable = async () => {
  throw new Error('Network access is disabled in the Keeper browser simulator.');
};

const RestClient = { get: unavailable, post: unavailable, put: unavailable, delete: unavailable };
export default RestClient;
export enum TorStatus { NOT_ENABLED = 'NOT_ENABLED' }
