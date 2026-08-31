import { createRoute, z, type RouteConfig } from "@hono/zod-openapi";

export const ErrorResponseSchema = z.object({
  message: z.string().openapi({ example: "Error message" }),
}).openapi("ErrorResponse");

export const IdParamSchema = z.object({
  id: z.string().uuid().openapi({
    param: { name: "id", in: "path" },
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
});

type HttpMethod = "post" | "get" | "put" | "patch" | "delete";

/**
 * The wrapper shape zod-openapi expects for a JSON request body:
 *   { content: { "application/json": { schema: <your zod schema> } } }
 */
type JsonBody<Schema extends z.ZodType> = {
  content: { "application/json": { schema: Schema } };
};

/**
 * These are the exact types that zod-openapi expects for params / query /
 * headers. We pull them straight from the library's own `RouteConfig` instead
 * of guessing, so if the library changes, we stay correct automatically.
 *
 * `NonNullable` removes the `| undefined` that the library adds, so we get the
 * "pure" schema type (a plain object schema, not "object or undefined").
 */
type ZodRouteRequestPart = NonNullable<RouteConfig["request"]>;
type ZodParamsSchema = NonNullable<ZodRouteRequestPart["params"]>;
type ZodQuerySchema = NonNullable<ZodRouteRequestPart["query"]>;
type ZodHeadersSchema = NonNullable<ZodRouteRequestPart["headers"]>;

/**
 * This is the `request` object we pass to `createRoute`. It has TWO rules:
 *
 *   1. `params`, `query`, and `headers` are optional — you include them only if
 *      you pass the matching schema.
 *
 *   2. `body` is special. It must be either:
 *        - present AND required (when a body schema was given), or
 *        - completely absent (when there is no body).
 *
 * WHY does `body` care about "required vs absent"?
 * -------------------------------------------------
 * Hono only lets you write `c.req.valid("json")` in a handler when the route
 * says "this request definitely has a JSON body". If we simply wrote
 * `body?: ...` (optional), Hono would treat the body as "maybe there, maybe
 * not" and refuse to type `c.req.valid("json")` at all.
 *
 * So we check: did the caller actually pass a body schema? The line below
 * answers that question:
 *
 *   [BodySchema] extends [z.ZodType] ? { body: ... } : {}
 *
 * - If a schema was passed  -> we add `{ body: ... }` (body is REQUIRED).
 * - If nothing was passed   -> we add `{}` (body is absent entirely).
 *
 * (The `[ ... ]` brackets are just a TypeScript trick to make the check work
 * correctly — they stop TypeScript from splitting the check into pieces. You
 * can read them as: "is BodySchema a real schema?")
 */
type RouteRequest<
  ParamsSchema extends ZodParamsSchema | undefined,
  QuerySchema extends ZodQuerySchema | undefined,
  HeadersSchema extends ZodHeadersSchema | undefined,
  BodySchema extends z.ZodType | undefined,
> = ([ParamsSchema] extends [ZodParamsSchema] ? { params: ParamsSchema } : {}) &
  ([QuerySchema] extends [ZodQuerySchema] ? { query: QuerySchema } : {}) &
  ([HeadersSchema] extends [ZodHeadersSchema] ? { headers: HeadersSchema } : {}) &
  ([BodySchema] extends [z.ZodType] ? { body: JsonBody<BodySchema> } : {});

class CreateRouteUtil {
  constructor(
    public tags: string[],
    public security?: Parameters<typeof createRoute>[0]["security"],
  ) { }

  /**
   * WHY GENERICS?
   * -------------
   * We want `c.req.valid("json")` inside a handler to return the RIGHT type —
   * `NoteCreate`, not just `unknown`. For that to happen, the exact schema we
   * passed in (like `NoteCreateSchema`) must survive the trip through this
   * function and reach `createRoute`.
   *
   * The old code lost that information in two places:
   *
   *   1. `requestSchema?: z.ZodType` — `z.ZodType` is the base class for ALL
   *      schemas. Typing it this way told TypeScript "there is some schema
   *      here", but not WHICH one.
   *   2. `const request: Record<string, unknown> = {}` — putting schemas into
   *      this object turned them all into `unknown`.
   *
   * Generics fix this. A generic is like a normal function parameter, but it
   * holds a TYPE instead of a value. When a caller writes:
   *
   *   noteRoute.createRouteUtil({ requestSchema: NoteCreateSchema, ... })
   *
   * TypeScript automatically infers `BodySchema = typeof NoteCreateSchema`.
   * Callers never write the generics themselves — TypeScript figures them out
   * from what is passed in.
   *
   * WHY `| undefined`?
   * ------------------
   * This part looks odd, but it matters. If the caller OMITS `requestSchema`,
   * we want `BodySchema` to become `undefined`, so that `RouteRequest` (above)
   * can see "no body was given" and leave `body` out. Without `undefined` in
   * the constraint, an omitted `requestSchema` would fall back to `z.ZodType`,
   * and every route would wrongly look like it has a body.
   */
  createRouteUtil<
    ParamsSchema extends ZodParamsSchema | undefined,
    QuerySchema extends ZodQuerySchema | undefined,
    HeadersSchema extends ZodHeadersSchema | undefined,
    BodySchema extends z.ZodType | undefined,
  >(option: {
    method: HttpMethod;
    path: string;
    responseSchema?: z.ZodType;
    requestSchema?: BodySchema;
    paramsSchema?: ParamsSchema;
    querySchema?: QuerySchema;
    headersSchema?: HeadersSchema;
    description?: string;
    status?: number;
  }) {
    const status = option.status ?? 200;

    return createRoute({
      method: option.method,
      path: option.path,
      description: option.description,
      tags: this.tags,
      security: this.security,
      /*
       * THE SPREAD + ASSERTION
       * ----------------------
       * `...(condition && { key: value })` means "add this key only if the
       * condition is true". Zod schemas are always truthy objects, so:
       *
       *   - schema present -> the key is added
       *   - schema absent  -> the key is left out
       *
       * One catch: TypeScript can only infer these keys as OPTIONAL ("maybe
       * there"). But `RouteRequest` (above) needs `body` to be REQUIRED when a
       * schema is given — otherwise `c.req.valid("json")` breaks.
       *
       * The `as RouteRequest<...>` at the end tells TypeScript: "trust me, this
       * object has exactly the shape I described in `RouteRequest`". That makes
       * the typing precise, so Hono knows when a JSON body is really there.
       */
      request: {
        ...(option.paramsSchema && { params: option.paramsSchema }),
        ...(option.querySchema && { query: option.querySchema }),
        ...(option.headersSchema && { headers: option.headersSchema }),
        ...(option.requestSchema && {
          body: {
            content: {
              "application/json": { schema: option.requestSchema },
            },
          },
        }),
      } as RouteRequest<
        ParamsSchema,
        QuerySchema,
        HeadersSchema,
        BodySchema
      >,
      responses: {
        [status]: {
          content: option.responseSchema
            ? {
              "application/json": {
                schema: option.responseSchema,
              },
            }
            : undefined,
          description: "Success",
        },
        400: {
          content: {
            "application/json": {
              schema: ErrorResponseSchema,
            },
          },
          description: "Bad Request",
        },
        404: {
          content: {
            "application/json": {
              schema: ErrorResponseSchema,
            },
          },
          description: "Not Found",
        },
        500: {
          content: {
            "application/json": {
              schema: ErrorResponseSchema,
            },
          },
          description: "Internal Server Error",
        },
      },
    });
  }
}

export { CreateRouteUtil };
