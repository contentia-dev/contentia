/**
 * "Try it" on the HTTP API pages without a server. The playground sends its requests to the
 * reference's example server, which nothing serves; this wraps `window.fetch` so a request to that
 * origin is answered by a Contentia instance running in the reader's browser instead, with its
 * content in `sessionStorage` (see `api-sandbox-apis.ts`). The content stays in the tab and lasts
 * until the tab closes. Requests to any other origin go to the network as before.
 *
 * Contentia is imported on the first sandbox request, so a page that never sends one doesn't
 * download it.
 */
import { EXAMPLE_SERVER } from '../../reference/examples/example-server';
import type { SandboxApi } from './api-sandbox-apis';

const SANDBOX_ORIGIN = new URL(EXAMPLE_SERVER).origin;

/** The sandbox's keys in `sessionStorage` all start with `${NAMESPACE}:`. */
export const NAMESPACE = 'contentia-docs-sandbox';

let apis: Promise<Readonly<Record<string, SandboxApi>>> | undefined;

/** Set once the tab's sandbox has its seed content, so a reload doesn't put back what was deleted. */
const SEEDED = `${NAMESPACE}.seeded`;

function clearStore(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(`${NAMESPACE}:`)) sessionStorage.removeItem(key);
  }
}

function loadApis() {
  if (!apis) {
    apis = import('./api-sandbox-apis').then(async m => {
      const built = m.createSandboxApis();
      if (!sessionStorage.getItem(SEEDED)) {
        try {
          await m.seedSandbox(built);
        } catch (error) {
          // Half a seed would make the next attempt's requests conflict with the first half.
          clearStore();
          throw error;
        }
        sessionStorage.setItem(SEEDED, 'true');
      }
      return built;
    });
    // A failed import (a flaky connection) shouldn't break the sandbox for the rest of the visit.
    apis.catch(() => (apis = undefined));
  }
  return apis;
}

function notFound(path: string): Response {
  const body = { errors: [{ status: '404', code: 'not_found', detail: `No API is mounted at ${path}.` }] };
  return new Response(JSON.stringify(body), {
    status: 404,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const api = (await loadApis())[pathname.split('/')[1]!];
  return api ? api.fetch(request) : notFound(pathname);
}

const requestUrl = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : input, location.href);

let installed = false;

/** Put the sandbox back the way it started: everything the reader did is undone, the seed redone. */
export function resetSandbox(): void {
  clearStore();
  sessionStorage.removeItem(SEEDED);
  apis = undefined;
}

/** Route requests to the example server into the in-browser sandbox. Safe to call repeatedly. */
export function installSandbox(): void {
  if (installed) return;
  installed = true;
  const networkFetch = window.fetch.bind(window);
  window.fetch = (input, init) =>
    requestUrl(input).origin === SANDBOX_ORIGIN ? handle(new Request(input, init)) : networkFetch(input, init);
}
