import { z } from "zod";
import { bearerAuth, errors } from "./common.js";

export const getImageSchema = {
  tags: ["images"],
  summary: "Get a stored photo",
  description: "JPEG bytes. Authenticates via Bearer header or the image cookie set at login.",
  security: bearerAuth,
  produces: ["image/jpeg"],
  params: z.object({ "*": z.string().describe("Storage key, e.g. captures/<id>/front.jpg") }),
  response: { ...errors(401, 404) },
};
