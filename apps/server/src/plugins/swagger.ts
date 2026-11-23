/**
 * OpenAPI spec generated from the routes' zod schemas, with Swagger UI at
 * /api/docs (spec JSON at /api/docs/json). Must be registered before routes.
 */
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export const swaggerPlugin = fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        info: {
          title: "Sonic API",
          description: "Vinyl cataloging API. Authenticate via POST /api/auth/login, then send `Authorization: Bearer <token>`.",
          version: "0.1.0",
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          },
        },
        tags: [
          { name: "auth", description: "Login / session" },
          { name: "captures", description: "Photo intake and the review queue" },
          { name: "catalog", description: "The owner's library and tags" },
          { name: "images", description: "Stored capture photos" },
          { name: "trash", description: "Soft delete, restore, and permanent deletion" },
          { name: "system", description: "Health" },
        ],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: "/api/docs" });
  },
  { name: "swagger" },
);
