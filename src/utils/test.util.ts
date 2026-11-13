import app from '../modules/app.module.ts';
import { db, isTest } from '../db/index.ts';
import { notes, userTable } from '../db/schema.ts';

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

/**
 * Empties every table so each test starts from a clean slate.
 *
 * The database is the throwaway file created by `test-setup.util.ts`. This throws
 * if called outside a test run, so a stray script cannot empty the dev database.
 */
export async function resetDatabase() {
  if (!isTest) throw new Error('resetDatabase() must only run inside tests');

  await db.delete(notes);
  await db.delete(userTable);
}
