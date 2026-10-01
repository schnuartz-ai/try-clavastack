import { Buffer } from 'buffer';
import process from 'process';

const globals = globalThis as any;
globals.Buffer ||= Buffer;
globals.process ||= process;
