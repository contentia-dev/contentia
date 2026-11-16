/**
 * The server the HTTP API reference talks to: its cURL examples and its "Try it" requests. Nothing
 * serves it (`example.com` is reserved by RFC 2606), so the reference pages answer requests to it
 * in the browser; see `.vitepress/theme/api-sandbox.ts`. Each API is mounted under its own name,
 * `${EXAMPLE_SERVER}/documents` and so on.
 */
export const EXAMPLE_SERVER = 'https://cms.example.com';
