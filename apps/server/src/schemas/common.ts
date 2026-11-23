/**
 * Shared pieces for route schemas. Route schemas are the HTTP contract: Fastify
 * validates requests and serializes responses with them (zod type provider),
 * handlers get typed `req.body/params/query`, and the OpenAPI doc is generated
 * from them.
 */
import type {
  ContextConfigDefault,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteGenericInterface,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

/** Every error body: `{ error }`, plus `issues` for validation failures. */
export const ErrorResponse = z
  .object({
    error: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .describe("Error");

/** Response entries for the given error status codes. */
export function errors<const C extends number>(...codes: C[]): Record<C, typeof ErrorResponse> {
  return Object.fromEntries(codes.map((c) => [c, ErrorResponse])) as Record<C, typeof ErrorResponse>;
}

export const IdParams = z.object({ id: z.string().uuid() });

/** OpenAPI security requirement for JWT-protected routes. */
export const bearerAuth = [{ bearerAuth: [] }];

/** Request/reply types for a handler bound to route schema `S`. */
export type ZodRequest<S extends FastifySchema> = FastifyRequest<
  RouteGenericInterface,
  RawServerDefault,
  RawRequestDefaultExpression,
  S,
  ZodTypeProvider
>;
export type ZodReply<S extends FastifySchema> = FastifyReply<
  RouteGenericInterface,
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  ContextConfigDefault,
  S,
  ZodTypeProvider
>;
