import { z } from "sqlite-zod-orm";
import { ApiError, apiJson } from "../../lib/api-security";

/** Convert endpoint errors into a small public response without exposing stacks. */
export function publicRouteError(error: unknown): Response {
  if (error instanceof ApiError) {
    return apiJson({ error: error.message }, error.status);
  }
  if (error instanceof z.ZodError) {
    return apiJson(
      {
        error: "Invalid request.",
        details: error.issues.map((issue) => issue.message),
      },
      400,
    );
  }
  if (error instanceof SyntaxError) {
    return apiJson({ error: "Invalid JSON." }, 400);
  }
  if (error instanceof Error && error.message === "Not found") {
    return apiJson({ error: "Not found." }, 404);
  }
  console.error(
    "LaunchSeeds API request failed:",
    error instanceof Error ? error.message : "Unexpected error",
  );
  return apiJson({ error: "Request temporarily unavailable." }, 503);
}
