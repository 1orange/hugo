import { FOLDER_MIME, type DriveFileRecord } from "@/modules/drive-tree";

const PARENT_ID = "e2e-parent";
const COMPANY_ID = "e2e-company-beta";
const COMPANY_CZ_ID = "e2e-company-gamma";
const MONTH_ID = "e2e-month-2026-01";
const MONTH_CZ_ID = "e2e-month-cz-2026-01";
const SLOT_02_ID = "e2e-slot-02";
const SLOT_04_ID = "e2e-slot-04";
const SLOT_06_ID = "e2e-slot-06";
const SLOT_CZ_04_ID = "e2e-slot-cz-04";

export function e2eDriveFixture(): DriveFileRecord[] {
  return [
    {
      id: PARENT_ID,
      name: "Clients",
      parents: [],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: COMPANY_ID,
      name: "Beta s.r.o.",
      parents: [PARENT_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: COMPANY_CZ_ID,
      name: "Gamma s.r.o.",
      parents: [PARENT_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: MONTH_ID,
      name: "2026_01",
      parents: [COMPANY_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: MONTH_CZ_ID,
      name: "2026_01",
      parents: [COMPANY_CZ_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: SLOT_02_ID,
      name: "02 Prijaté faktúry",
      parents: [MONTH_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: SLOT_04_ID,
      name: "04 Bločky_hotovosť",
      parents: [MONTH_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: SLOT_CZ_04_ID,
      name: "04 Bločky_hotovosť",
      parents: [MONTH_CZ_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: SLOT_06_ID,
      name: "06 Iné doklady",
      parents: [MONTH_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: "e2e-doc-supplier",
      name: "supplier-invoice.pdf",
      parents: [SLOT_02_ID],
      createdTime: "2026-01-10T00:00:00.000Z",
      mimeType: "application/pdf",
    },
    {
      id: "e2e-doc-receipt",
      name: "cash-receipt.pdf",
      parents: [SLOT_04_ID],
      createdTime: "2026-01-11T00:00:00.000Z",
      mimeType: "application/pdf",
    },
    {
      id: "e2e-doc-blank-receipt",
      name: "blank-receipt.pdf",
      parents: [SLOT_04_ID],
      createdTime: "2026-01-11T14:00:00.000Z",
      mimeType: "application/pdf",
    },
    {
      id: "e2e-doc-cz-receipt",
      name: "cz-cash-receipt.pdf",
      parents: [SLOT_CZ_04_ID],
      createdTime: "2026-01-11T00:00:00.000Z",
      mimeType: "application/pdf",
    },
    {
      id: "e2e-doc-photo-jpeg",
      name: "receipt-photo.jpg",
      parents: [SLOT_06_ID],
      createdTime: "2026-01-11T12:00:00.000Z",
      mimeType: "image/jpeg",
    },
    {
      id: "e2e-doc-photo-heic",
      name: "IMG_3475.HEIC",
      parents: [SLOT_06_ID],
      createdTime: "2026-01-11T13:00:00.000Z",
      mimeType: "image/heic",
    },
    {
      id: "e2e-doc-vat",
      name: "vat-output.pdf",
      parents: [MONTH_ID],
      createdTime: "2026-01-20T00:00:00.000Z",
      mimeType: "application/pdf",
    },
  ];
}

export const E2E_DRIVE_PARENT_FOLDER_ID = PARENT_ID;
