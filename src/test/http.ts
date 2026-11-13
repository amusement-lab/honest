import app from '../modules/app.module.ts';

export { app };

/**
 * Sends a JSON request straight to the Hono app (no network, no server).
 * `app.request()` runs the full middleware chain: routing, zod validation,
 * handlers and `app.onError`.
 *
 * Pass `headers` to add or override request headers (for example auth tokens).
 */
export function jsonRequest(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Sends a request with an arbitrary (non-JSON) content type. */
export function rawRequest(method: string, path: string, contentType: string, body: string) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': contentType },
    body,
  });
}

/** Reads a JSON response body. Pass the expected type explicitly. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
