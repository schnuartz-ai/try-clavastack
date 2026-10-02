import { Buffer } from 'buffer';
import process from 'process';

const globals = globalThis as any;
const browserProcess = process as any;
const sharedProcess = globals.process ?? (globals.process = browserProcess);
Object.assign(sharedProcess, browserProcess, {
  browser: true,
  version: 'web',
  env: { ...(browserProcess.env ?? {}), ...(sharedProcess.env ?? {}) },
});
globals.Buffer ??= Buffer;
