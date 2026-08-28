import { NextResponse } from "next/server";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { getFileByDriveId } from "@/adapters/store/files";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { driveFileViewUrl, previewKindForMimeType } from "@/modules/file-preview";

type RouteContext = {
  params: Promise<{ driveFileId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.email || !isEmailAllowed(session.user.email, loadAllowlistFromEnv())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { driveFileId } = await context.params;
  const file = getFileByDriveId(driveFileId);
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
    const bytes = await createDriveClient().download(driveFileId);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Preview unavailable" }, { status: 502 });
  }
}
