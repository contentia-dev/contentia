/**
 * What one generated cURL example sends. The method, path and headers come from the OpenAPI spec;
 * these are the values, chosen to match the operation's Node.js example.
 */
export interface HttpExample {
  /** Path parameters, unencoded: the generator percent-encodes them (`/` becomes `%2F`). */
  readonly path?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  /** The JSON:API request document. */
  readonly body?: unknown;
}
