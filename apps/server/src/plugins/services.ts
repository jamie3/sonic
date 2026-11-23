/**
 * Fastify-native dependency injection: decorates the root instance with the
 * service layer so every route plugin reads `app.services`. Wrapped in
 * fastify-plugin so the decoration isn't encapsulated to this plugin's scope.
 */
import fp from "fastify-plugin";
import type { Services } from "@sonic/core/services";

declare module "fastify" {
  interface FastifyInstance {
    services: Services;
  }
}

export const servicesPlugin = fp<{ services: Services }>(
  async (app, { services }) => {
    app.decorate("services", services);
  },
  { name: "services" },
);
