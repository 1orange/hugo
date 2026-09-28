import {
  getTypedEkasaUid,
  parseExtractedPayload,
} from "./document-payload";

/**
 * A scan can hold several receipts, and each is its own document (one
 * document per receipt). The file's own document keeps the file's ID; each
 * further receipt is `<file>#<UID>`, stable across re-reads because the UID is.
 */
export function receiptDocumentId(driveFileId: string, uid: string): string {
  return `${driveFileId}#${uid.trim().toUpperCase()}`;
}

/** The eKasa UID a document stands for, if any: read, typed, or its key. */
export function receiptUidOfDocument(document: {
  receiptUid: string | null;
  extractedPayloadJson: string;
}): string | null {
  const fromPayload = getTypedEkasaUid(parseExtractedPayload(document.extractedPayloadJson));
  const uid = fromPayload ?? document.receiptUid;
  return uid ? uid.trim().toUpperCase() : null;
}
