import { Console } from 'node:console';

// Node 22 mixes raw stdout with binary test reports (nodejs/node#65934).
// Keep every console method visible on stderr, including module/exit logs.
// Loaded only by test commands; normal CLI processes keep their original console.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
