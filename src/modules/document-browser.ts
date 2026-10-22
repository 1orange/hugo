import type { DocumentListItem } from "@/lib/documents/view";

export const DOCUMENT_SORT_KEYS = [
  "issueDate",
  "price",
  "partner",
  "filename",
  "status",
] as const;

export type DocumentSortKey = (typeof DOCUMENT_SORT_KEYS)[number];
export type DocumentSortDirection = "asc" | "desc";

export const DEFAULT_DOCUMENT_SORT: {
  key: DocumentSortKey;
  direction: DocumentSortDirection;
} = { key: "issueDate", direction: "desc" };

export type DocumentBrowserOptions = {
  search?: string;
  sortKey?: DocumentSortKey;
  direction?: DocumentSortDirection;
  homeCurrency?: string;
};

export type DocumentBrowserProjection = {
  documents: DocumentListItem[];
  search: string;
  sortKey: DocumentSortKey;
  direction: DocumentSortDirection;
  totalCount: number;
};

export type DocumentBrowserNavigationState = {
  folderFilter: string | null;
  sortKey: DocumentSortKey;
  sortDirection: DocumentSortDirection;
};

const collator = new Intl.Collator("sk-SK", {
  sensitivity: "base",
  numeric: true,
  usage: "sort",
});

/** Normalize the text a person types, without changing the displayed value. */
export function normalizeDocumentSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sk-SK")
    .replace(/\s+/g, " ")
    .trim();
}

export function documentSearchText(document: DocumentListItem): string {
  const fields = document.fieldEditor.fields;
  return normalizeDocumentSearch(
    [
      document.label,
      document.name,
      fields.documentNumber,
      fields.variableSymbol,
      fields.supplierName,
      fields.ico,
      fields.dic,
      fields.icDph,
      fields.customerName,
      fields.customerIco,
      fields.customerDic,
      fields.customerIcDph,
    ]
      .filter((value) => value.trim().length > 0)
      .join(" "),
  );
}

export function documentMatchesSearch(
  document: DocumentListItem,
  query: string | null | undefined,
): boolean {
  const normalizedQuery = normalizeDocumentSearch(query);
  return normalizedQuery.length === 0 || documentSearchText(document).includes(normalizedQuery);
}

/** Stable identity for URL-driven browser changes; unrelated RSC refreshes keep it unchanged. */
export function documentBrowserNavigationKey(
  state: DocumentBrowserNavigationState,
): string {
  return `${state.folderFilter ?? ""}\u0000${state.sortKey}\u0000${state.sortDirection}`;
}

export function filterDocuments(
  documents: readonly DocumentListItem[],
  query: string | null | undefined,
): DocumentListItem[] {
  const normalizedQuery = normalizeDocumentSearch(query);
  if (!normalizedQuery) {
    return [...documents];
  }
  return documents.filter((document) => documentSearchText(document).includes(normalizedQuery));
}

/** VAT outputs use only their filename and never enter the document projection. */
export function filterReadOnlyFiles<T extends { name: string }>(
  files: readonly T[],
  query: string | null | undefined,
): T[] {
  const normalizedQuery = normalizeDocumentSearch(query);
  return files
    .filter((file) => normalizeDocumentSearch(file.name).includes(normalizedQuery))
    .sort((left, right) => collator.compare(left.name, right.name));
}

function valueOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function dateValue(document: DocumentListItem): number | null {
  const at = document.fieldEditor.fields.issueDateAt;
  if (at) {
    const timestamp = Date.parse(at);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }
  const raw = valueOrNull(document.fieldEditor.fields.issueDateRaw);
  if (!raw) {
    return null;
  }
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (!match) {
    return null;
  }
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function partnerValue(document: DocumentListItem): string | null {
  return valueOrNull(document.fieldEditor.fields.supplierName) ??
    valueOrNull(document.fieldEditor.fields.customerName) ??
    (document.label !== document.name ? valueOrNull(document.label) : null);
}

function filenameValue(document: DocumentListItem): string | null {
  return valueOrNull(document.name);
}

function priceValue(document: DocumentListItem): number | null {
  return typeof document.fieldEditor.fields.amountCents === "number"
    ? document.fieldEditor.fields.amountCents
    : null;
}

function currencyValue(document: DocumentListItem): string | null {
  return valueOrNull(document.fieldEditor.fields.currency);
}

function statusRank(document: DocumentListItem): number {
  if (document.decision === "not_relevant") {
    return 4;
  }
  if (document.decision === "confirmed") {
    return 3;
  }
  if (
    document.fieldEditor.arithmeticWarning ||
    document.fieldEditor.rolesFlagged ||
    (document.fieldEditor.vatWarnings?.length ?? 0) > 0
  ) {
    return 0;
  }
  if (document.derivedStatus.kind === "manual-entry" || document.derivedStatus.kind === "manual-only") {
    return 0;
  }
  if (document.derivedStatus.kind === "pending-extraction") {
    return 2;
  }
  return 1;
}

function compareNullable<T>(
  left: T | null,
  right: T | null,
  compare: (left: T, right: T) => number,
  direction: DocumentSortDirection,
): number {
  if (left === null && right === null) {
    return 0;
  }
  // Missing values are deliberately always last, including in descending order.
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  const result = compare(left, right);
  return direction === "asc" ? result : -result;
}

function compareStableTieBreakers(left: DocumentListItem, right: DocumentListItem): number {
  const date = compareNullable(dateValue(left), dateValue(right), (a, b) => b - a, "asc");
  if (date !== 0) {
    return date;
  }
  const partner = collator.compare(partnerValue(left) ?? "", partnerValue(right) ?? "");
  if (partner !== 0) {
    return partner;
  }
  const filename = collator.compare(filenameValue(left) ?? "", filenameValue(right) ?? "");
  return filename || collator.compare(left.id, right.id);
}

export function compareDocuments(
  left: DocumentListItem,
  right: DocumentListItem,
  key: DocumentSortKey = DEFAULT_DOCUMENT_SORT.key,
  direction: DocumentSortDirection = DEFAULT_DOCUMENT_SORT.direction,
  homeCurrency = "EUR",
): number {
  let result = 0;
  if (key === "issueDate") {
    result = compareNullable(dateValue(left), dateValue(right), (a, b) => a - b, direction);
  } else if (key === "price") {
    const leftPrice = priceValue(left);
    const rightPrice = priceValue(right);
    if (leftPrice === null || rightPrice === null) {
      result = compareNullable(leftPrice, rightPrice, (a, b) => a - b, direction);
    } else {
      const leftCurrency = currencyValue(left);
      const rightCurrency = currencyValue(right);
      if (leftCurrency === null || rightCurrency === null) {
        result = compareNullable(
          leftCurrency,
          rightCurrency,
          collator.compare.bind(collator),
          direction,
        );
      } else if (leftCurrency !== rightCurrency) {
        const leftHome = leftCurrency === homeCurrency;
        const rightHome = rightCurrency === homeCurrency;
        result = leftHome === rightHome
          ? collator.compare(leftCurrency, rightCurrency)
          : leftHome
            ? -1
            : 1;
      } else {
        result = compareNullable(leftPrice, rightPrice, (a, b) => a - b, direction);
      }
    }
  } else if (key === "partner") {
    result = compareNullable(partnerValue(left), partnerValue(right), collator.compare.bind(collator), direction);
  } else if (key === "filename") {
    result = compareNullable(filenameValue(left), filenameValue(right), collator.compare.bind(collator), direction);
  } else {
    result = direction === "asc"
      ? statusRank(left) - statusRank(right)
      : statusRank(right) - statusRank(left);
  }
  return result || compareStableTieBreakers(left, right);
}

export function sortDocuments(
  documents: readonly DocumentListItem[],
  key: DocumentSortKey = DEFAULT_DOCUMENT_SORT.key,
  direction: DocumentSortDirection = DEFAULT_DOCUMENT_SORT.direction,
  homeCurrency = "EUR",
): DocumentListItem[] {
  return [...documents].sort((left, right) => compareDocuments(left, right, key, direction, homeCurrency));
}

export function projectDocuments(
  documents: readonly DocumentListItem[],
  options: DocumentBrowserOptions = {},
): DocumentBrowserProjection {
  const search = normalizeDocumentSearch(options.search);
  const sortKey = options.sortKey ?? DEFAULT_DOCUMENT_SORT.key;
  const direction = options.direction ?? DEFAULT_DOCUMENT_SORT.direction;
  const filtered = filterDocuments(documents, search);
  return {
    documents: sortDocuments(filtered, sortKey, direction, options.homeCurrency),
    search,
    sortKey,
    direction,
    totalCount: documents.length,
  };
}

export function parseDocumentSortParams(params: {
  sort?: string | null;
  direction?: string | null;
  dir?: string | null;
}): { key: DocumentSortKey; direction: DocumentSortDirection } {
  const aliases: Record<string, DocumentSortKey> = {
    date: "issueDate",
    issue: "issueDate",
    issueDate: "issueDate",
    price: "price",
    amount: "price",
    partner: "partner",
    name: "partner",
    filename: "filename",
    file: "filename",
    status: "status",
    state: "status",
  };
  const key = aliases[params.sort ?? ""] ?? DEFAULT_DOCUMENT_SORT.key;
  const direction = params.direction === "asc" || params.dir === "asc"
    ? "asc"
    : params.direction === "desc" || params.dir === "desc"
      ? "desc"
      : DEFAULT_DOCUMENT_SORT.direction;
  return { key, direction };
}

export function documentSortQuery(
  key: DocumentSortKey,
  direction: DocumentSortDirection,
): string {
  return `sort=${encodeURIComponent(key)}&direction=${encodeURIComponent(direction)}`;
}
