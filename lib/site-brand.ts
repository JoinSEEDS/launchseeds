export const SITE_NAME = "LaunchSeeds";
/** The origin a same-origin request must come from: the public base URL when set. */
export function expectedRequestOrigin(request: Request, publicBase?: string) {
  return publicBase ? new URL(publicBase).origin : new URL(request.url).origin;
}
