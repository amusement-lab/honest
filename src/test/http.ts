import app from '../modules/app.module.ts';

export { app };

/**
 * Sends a JSON request straight to the Hono app (no network, no server).
 * `app.request()` runs the full middleware chain: routing, zod validation,
 * handlers and `app.onError`.
 */
export function jsonRequest(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

/** Reads a JSON response body with a loose type, for concise assertions. */
export async function readJson<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
