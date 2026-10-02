import { DeviceEventEmitter } from 'react-native';

type NativeRequestBody =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | FormData
  | { string?: string; base64?: string; blob?: unknown; formData?: Array<Record<string, any>>; uri?: string; type?: string; name?: string }
  | null
  | undefined;

type NativeResponseType = 'text' | 'base64' | 'blob';

let nextRequestId = 1;
const pending = new Map<number, AbortController>();
const emitter = DeviceEventEmitter;

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function requestBody(body: NativeRequestBody): BodyInit | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string' || body instanceof Blob || body instanceof FormData) return body;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body as BodyInit;
  if (typeof body !== 'object') return undefined;
  if (typeof body.string === 'string') return body.string;
  if (typeof body.base64 === 'string') return decodeBase64(body.base64);
  if (body.blob instanceof Blob) return body.blob;
  if (Array.isArray(body.formData)) {
    const form = new FormData();
    for (const part of body.formData) {
      const name = typeof part.fieldName === 'string' ? part.fieldName : 'file';
      if (typeof part.string === 'string') form.append(name, part.string);
      else if (typeof part.uri === 'string' && part.uri.startsWith('blob:')) {
        form.append(name, new File([], part.name || 'upload', { type: part.type || 'application/octet-stream' }), part.name || 'upload');
      }
    }
    return form;
  }
  throw new Error('This browser request body format is unavailable.');
}

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

const RCTNetworking = {
  addListener: emitter.addListener.bind(emitter),
  removeListeners(_count: number) {},

  sendRequest(
    method: string,
    _trackingName: string | undefined,
    url: string,
    headers: Record<string, string>,
    body: NativeRequestBody,
    responseType: NativeResponseType,
    _incrementalUpdates: boolean,
    timeout: number,
    callback: (requestId: number) => void,
    withCredentials: boolean,
  ) {
    const requestId = nextRequestId++;
    const controller = new AbortController();
    pending.set(requestId, controller);
    let timedOut = false;
    const timeoutId = timeout > 0 ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout) : undefined;
    callback(requestId);

    const browserFetch = (globalThis as any).__keeperNativeFetch || globalThis.fetch;
    Promise.resolve().then(() => browserFetch(url, {
      method,
      headers,
      body: requestBody(body),
      credentials: withCredentials ? 'include' : 'same-origin',
      signal: controller.signal,
    })).then(async (response: Response) => {
      emitter.emit('didReceiveNetworkResponse', requestId, response.status, responseHeaders(response), response.url || url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const result = responseType === 'base64'
        ? encodeBase64(bytes)
        : responseType === 'blob'
          ? encodeBase64(bytes)
          : new TextDecoder().decode(bytes);
      emitter.emit('didReceiveNetworkData', requestId, result);
      emitter.emit('didReceiveNetworkDataProgress', requestId, bytes.byteLength, bytes.byteLength);
      emitter.emit('didCompleteNetworkResponse', requestId, '', false);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      emitter.emit('didCompleteNetworkResponse', requestId, message, timedOut);
    }).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      pending.delete(requestId);
    });
  },

  abortRequest(requestId: number) {
    pending.get(requestId)?.abort();
  },

  clearCookies(callback: (cleared: boolean) => void) {
    callback(false);
  },
};

export default RCTNetworking;
