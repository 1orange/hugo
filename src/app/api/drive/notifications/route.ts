import { acceptDriveNotification } from "@/lib/drive-watch/drive-watch";

export const dynamic = "force-dynamic";

/**
 * Google Drive push notifications (ADR 0020). Google signs in with nothing but
 * the channel's token, so the middleware lets this path through and the token
 * is checked here. Any replica can take it: the sweep it asks for is queued.
 */
export async function POST(request: Request): Promise<Response> {
  const outcome = await acceptDriveNotification({
    channelId: request.headers.get("x-goog-channel-id"),
    token: request.headers.get("x-goog-channel-token"),
    resourceState: request.headers.get("x-goog-resource-state"),
  });
  return new Response(null, { status: outcome === "rejected" ? 403 : 204 });
}
