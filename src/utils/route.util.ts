import { createRoute, z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z.object({
  message: z.string().openapi({ example: "Error message" }),
}).openapi("ErrorResponse");

type HttpMethod = "post" | "get" | "put" | "patch" | "delete";

class CreateRouteUtil {
  constructor(
    public tags: string[],
    public security?: Parameters<typeof createRoute>[0]["security"],
  ) {}

  createRouteUtil(option: {
    method: HttpMethod;
    path: string;
    responseSchema?: z.ZodType;
    requestSchema?: z.ZodType;
    paramsSchema?: z.ZodType;
    querySchema?: z.ZodType;
    headersSchema?: z.ZodType;
    description?: string;
    status?: number;
  }) {
    const request: Record<string, unknown> = {};

    if (option.paramsSchema) {
      request.params = option.paramsSchema;
    }
    if (option.querySchema) {
      request.query = option.querySchema;
    }
    if (option.headersSchema) {
      request.headers = option.headersSchema;
    }
    if (option.requestSchema) {
      request.body = {
        content: {
          "application/json": {
            schema: option.requestSchema,
          },
        },
      };
    }

    const status = option.status ?? 200;

    return createRoute({
      method: option.method,
      path: option.path,
      description: option.description,
      tags: this.tags,
      security: this.security,
      ...(Object.keys(request).length > 0 ? { request } : {}),
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
