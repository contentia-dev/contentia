import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import type { CliInvocation } from './resolve-cli.js';

/** Mirrors `ServeEvent` in laikacli's `serve --json` output. */
type ServeEvent =
  | { readonly event: 'listening', readonly url: string, readonly backend: string }
  | { readonly event: 'error', readonly message: string };

export interface ServeOptions {
  readonly cli: CliInvocation;
  readonly backend: string;
  readonly backendOptions: Record<string, unknown>;
  readonly cwd: string;
  /** Receives every stderr line and non-event stdout line. */
  readonly log: (line: string) => void;
  /** Give up waiting for the `listening` event after this long. */
  readonly timeoutMs?: number;
}

export interface RunningServer {
  readonly url: string;
  /** Per-process bearer token; the server rejects requests without it. */
  readonly authToken: string;
  /** Fires when the process exits after it started listening (a crash or `stop()`). */
  onExit(listener: (code: number | null) => void): void;
  stop(): void;
}

const parseEvent = (line: string): ServeEvent | undefined => {
  if (!line.startsWith('{')) return undefined;
  try {
    const value = JSON.parse(line) as Partial<ServeEvent>;
    return value.event === 'listening' || value.event === 'error' ? value as ServeEvent : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Start `laika local serve --json --port 0` and resolve once it reports the
 * URL it bound to. The auth token and backend options travel through the
 * environment rather than argv, so credentials never show up in the process
 * list.
 */
export const startServe = (options: ServeOptions): Promise<RunningServer> => {
  const authToken = randomBytes(24).toString('base64url');
  const child = spawn(
    options.cli.command,
    [
      ...options.cli.args,
      'local',
      'serve',
      '--json',
      '--port',
      '0',
      '--backend',
      options.backend,
    ],
    {
      cwd: options.cwd,
      shell: options.cli.shell,
      env: {
        ...process.env,
        LAIKA_AUTH_TOKEN: authToken,
        LAIKA_BACKEND_OPTIONS: JSON.stringify(options.backendOptions),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const exitListeners: Array<(code: number | null) => void> = [];
  const lines = (stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
      }
    });
  };
  lines(child.stderr!, options.log);

  return new Promise<RunningServer>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error(`laikacli did not report a listening URL within ${options.timeoutMs ?? 30_000}ms`)),
      options.timeoutMs ?? 30_000,
    );

    lines(child.stdout!, line => {
      const event = parseEvent(line);
      if (!event) return options.log(line);
      if (event.event === 'error') return fail(new Error(event.message));
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        url: event.url,
        authToken,
        onExit: listener => void exitListeners.push(listener),
        stop: () => void child.kill(),
      });
    });

    child.on('error', error => fail(new Error(`Could not start ${options.cli.command}: ${error.message}`)));
    child.on('exit', code => {
      if (!settled) return fail(new Error(`laikacli exited with code ${code} before it started listening`));
      for (const listener of exitListeners) listener(code);
    });
  });
};
