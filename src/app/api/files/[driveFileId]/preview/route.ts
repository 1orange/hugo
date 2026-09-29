import { NextResponse } from "next/server";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { heicToJpeg } from "@/adapters/image/heic-to-jpeg";
import { getFileByDriveId } from "@/adapters/store/files";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import {
  driveFileViewUrl,
  isHeicMimeType,
  previewKindForMimeType,
} from "@/modules/file-preview";

type RouteContext = {
  params: Promise<{ driveFileId: string }>;
};


export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.email || !isEmailAllowed(session.user.email, loadAllowlistFromEnv())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { driveFileId } = await context.params;
  const file = await getFileByDriveId(driveFileId);
  if (!file || file.deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Clients upload these files, so the mime type Drive reports is untrusted input.
  // Only the kinds we render are streamed from this origin; anything else could be
  // active content (svg, html) running against her session.
  const kind = previewKindForMimeType(file.mimeType);
  if (kind !== "pdf" && kind !== "image") {
    return NextResponse.json(
      {
        kind,
        driveFileId,
        name: file.name,
        driveUrl: driveFileViewUrl(driveFileId),
      },
      { status: 422 },
    );
  }

  try {
    const downloaded = await createDriveClient().download(driveFileId);

    // No browser but Safari renders HEIC, and the photos in the real corpus are
    // HEIC, so decode here rather than shipping a decoder to the client.
    const { body, contentType } = isHeicMimeType(file.mimeType)
      ? {
          body: await heicToJpeg(downloaded),
          contentType: "image/jpeg",
        }
      : { body: new Uint8Array(downloaded), contentType: file.mimeType };

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Preview unavailable" }, { status: 502 });
  }
}
