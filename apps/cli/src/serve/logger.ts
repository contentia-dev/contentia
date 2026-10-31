export type ServerLogger = Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;

/** An error a client caused (bad token, wrong key): `status` in the 4xx range. */
const isClientError = (value: unknown): value is Error => {
  if (!(value instanceof Error)) return false;
  const status: unknown = (value as Error & { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
};

/** ContentiaErrors carry a stable `code` (e.g. `unauthenticated`); plain errors only a name. */
const errorLabel = (error: Error): string => {
  const code: unknown = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : error.name;
};

/**
 * Console logging for a long-running server. `contentiaApi` reports every
 * rejected credential through `error` with a stack trace; behind health
 * probes and internet scanners that buries real failures, so 4xx errors
 * become one-line warnings. Server-side errors keep their stack. Debug output
 * (one line per health probe) is dropped unless `debug` is set.
 */
export const createServerLogger = (sink: ServerLogger = console, debug = false): ServerLogger => ({
  error: (...args: unknown[]) => {
    if (args.some(isClientError)) {
      sink.warn(...args.map(a => isClientError(a) ? `${errorLabel(a)}: ${a.message}` : a));
    } else {
      sink.error(...args);
    }
  },
  warn: (...args: unknown[]) => sink.warn(...args),
  info: (...args: unknown[]) => sink.info(...args),
  debug: debug ? (...args: unknown[]) => sink.debug(...args) : () => {},
});
