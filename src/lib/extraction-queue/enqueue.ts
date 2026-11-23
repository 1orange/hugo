import {
  priorityFor,
  type ExtractionJobQueue,
} from "@/adapters/job-queue/port";
import { getCompanyById } from "@/adapters/store/companies";
import {
  beginExtractionAttempt,
  ensureDocumentsForMonth,
  getDocument,
} from "@/adapters/store/documents";
import { listCashReceiptCandidates } from "@/lib/cash-discovery/discover-cash-payments";
import { announce } from "@/lib/events/bus";
import { listModelExtractionCandidates } from "@/lib/model-extraction/discover-model-extraction";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import { needsExtraction, needsPipelineReread } from "@/modules/extraction-pipeline";
import type { ReadingTier } from "@/modules/reading-planner";

/**
 * Queues the month's documents that still need reading; returns how many this
 * call queued. Any replica may call it any number of times — page renders,
 * sweeps, the poll: a file already queued, being read or waiting for a service
 * is not queued again (ADR 0021).
 */
export async function enqueueMonthExtraction(
  queue: ExtractionJobQueue,
  companyId: number,
  monthKey: string,
  now: () => string = () => new Date().toISOString(),
  tier: ReadingTier = "recent",
): Promise<number> {
  if (await assertMonthEditable(companyId, monthKey)) {
    return 0;
  }
  await ensureDocumentsForMonth(companyId, monthKey, now());
  const candidates = [
    ...(await listCashReceiptCandidates(companyId, monthKey)).map((file) => ({ ...file, kind: "receipt" as const })),
    ...(await listModelExtractionCandidates(companyId, monthKey)).map((file) => ({
      ...file,
      kind: "document" as const,
    })),
  ];

  let added = 0;
  let companyName: string | null = null;
  for (const file of candidates) {
    const document = await getDocument(file.driveFileId);
    const reread = !needsExtraction(document) && file.kind === "document" && needsPipelineReread(document);
    if (!needsExtraction(document) && !reread) {
      continue;
    }
    companyName ??= (await getCompanyById(companyId))?.name ?? `#${companyId}`;
    const queued = await queue.add(
      {
        kind: file.kind,
        companyId,
        companyName,
        monthKey,
        driveFileId: file.driveFileId,
        fileName: file.name,
        folderSlot: file.folderSlot,
        mimeType: file.mimeType,
        enqueuedAt: now(),
        tier,
        ...(reread ? { reread: true } : {}),
      },
      { priority: priorityFor(file.kind, tier) },
    );
    if (queued) {
      if (!reread) {
        await beginExtractionAttempt(file.driveFileId);
      }
      added += 1;
    }
  }
  if (added > 0) {
    announce({ type: "queue-changed" });
  }
  return added;
}
