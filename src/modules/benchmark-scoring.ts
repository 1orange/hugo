import type { BenchmarkLabel } from "./benchmark-label";
import type {
  ExtractedPayload,
  ModelExtractedPayload,
} from "./document-payload";
import { isEkasaPayload, isModelExtractedPayload } from "./document-payload";
import {
  checkArithmeticWarnings,
  mergeDocumentFields,
  type FieldCheckState,
} from "./document-fields";

export type BenchmarkFieldKey =
  | "documentNumber"
  | "variableSymbol"
  | "issueDate"
  | "taxableSupplyDate"
  | "dueDate"
  | "currency"
  | "amountCents"
  | "counterpartyIco"
  | "counterpartyIcDph"
  | "counterpartyName"
  | "vatRecapBase"
  | "vatRecapVat"
  | "vatRecapTotal";

export type BenchmarkFieldOutcome =
  | "exact"
  | "wrong_plausible"
  /** Wrong, but the checks flagged it: she sees the warning, so not "plausible". */
  | "wrong_flagged"
  | "empty"
  | "empty_flagged"
  | "skipped";

export type BenchmarkFieldScore = {
  field: BenchmarkFieldKey;
  outcome: BenchmarkFieldOutcome;
  expected: string | null;
  actual: string | null;
};

export type BenchmarkDocumentScore = {
  driveFileId: string;
  fields: BenchmarkFieldScore[];
};

export type BenchmarkAdoptionBar = {
  amountWrongWhileArithmeticPassed: number;
  scoredFields: number;
  exactOrEmptyFlagged: number;
  wrongPlausible: number;
  exactOrEmptyFlaggedRate: number;
  wrongPlausibleRate: number;
  passesAmountRule: boolean;
  passesAccuracyRule: boolean;
  passesWrongPlausibleRule: boolean;
  passes: boolean;
};

export type BenchmarkAggregateScore = {
  documents: BenchmarkDocumentScore[];
  adoptionBar: BenchmarkAdoptionBar;
};

const AMOUNT_FIELDS = new Set<BenchmarkFieldKey>(["amountCents", "vatRecapBase", "vatRecapVat", "vatRecapTotal"]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeIco(value: string | null | undefined): string {
  return (value ?? "").replace(/\s/g, "");
}

// Her Omega partner names drop the legal form the invoice prints:
// `O2 Slovakia` for `O2 Slovakia, s.r.o.`.
const LEGAL_FORM = /[\s,]*(spol\.\s*s\s*r\.\s*o\.|s\.\s*r\.\s*o\.|a\.\s*s\.|k\.\s*s\.|v\.\s*o\.\s*s\.)$/i;

function normalizeCompanyName(value: string | null | undefined): string {
  return normalizeText(value).replace(LEGAL_FORM, "").toLowerCase();
}

function isEmptyActual(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

function isWrongPlausible(outcome: BenchmarkFieldOutcome): boolean {
  return outcome === "wrong_plausible";
}

function shouldScoreReceiptDates(label: BenchmarkLabel): boolean {
  return label.docTypeHint !== "receipt";
}

function shouldScoreVatAmounts(label: BenchmarkLabel): boolean {
  return label.kvDphSection?.toUpperCase() !== "B1";
}

function counterpartyFromLabel(label: BenchmarkLabel): {
  name: string | null;
  ico: string | null;
  icDph: string | null;
} {
  if (label.side === "issued") {
    return {
      name: label.customer.name,
      ico: label.customer.ico,
      icDph: label.customer.icDph,
    };
  }
  return {
    name: label.supplier.name,
    ico: label.supplier.ico,
    icDph: label.supplier.icDph,
  };
}

function readModelPayload(payload: ExtractedPayload): ModelExtractedPayload | null {
  if (isModelExtractedPayload(payload)) {
    return payload;
  }
  return null;
}

function pickModelParty(
  model: ModelExtractedPayload | null,
  label: BenchmarkLabel,
  companyIco?: string | null,
): ModelExtractedPayload["parties"][number] | null {
  if (!model || model.parties.length === 0) {
    return null;
  }
  const ownIco = normalizeIco(companyIco);
  const targetIco =
    label.side === "issued" ? normalizeIco(label.customer.ico) : normalizeIco(label.supplier.ico);
  if (targetIco.length > 0) {
    const matched = model.parties.find((party) => normalizeIco(party.ico) === targetIco);
    if (matched) {
      return matched;
    }
  }
  // As production does (ADR 0018): the counterparty is whoever is not her client.
  const notTheCompany = ownIco
    ? model.parties.find((party) => normalizeIco(party.ico) !== ownIco)
    : undefined;
  return notTheCompany ?? model.parties[0] ?? null;
}

function readEkasaDates(payload: ExtractedPayload): { issueDate: string | null } {
  if (!isEkasaPayload(payload)) {
    return { issueDate: null };
  }
  if (!payload.receiptAt) {
    return { issueDate: null };
  }
  return { issueDate: payload.receiptAt.slice(0, 10) };
}

function scoreScalar(
  field: BenchmarkFieldKey,
  expected: string | null,
  actual: string | null,
  checkState: FieldCheckState | undefined,
): BenchmarkFieldScore {
  if (expected === null || expected.trim().length === 0) {
    return { field, outcome: "skipped", expected, actual };
  }
  if (isEmptyActual(actual)) {
    if (checkState === "flagged") {
      return { field, outcome: "empty_flagged", expected, actual };
    }
    return { field, outcome: "empty", expected, actual };
  }
  // Identifiers carry no meaning in their spacing; the register prints
  // `SK 2020449189` where the invoice says `SK2020449189`.
  const compact = field === "counterpartyIco" || field === "counterpartyIcDph";
  const normalize = (value: string | null): string =>
    compact
      ? normalizeIco(value).toUpperCase()
      : field === "counterpartyName"
        ? normalizeCompanyName(value)
        : normalizeText(value);
  const normalizedExpected = normalize(expected);
  const normalizedActual = normalize(actual);
  if (normalizedExpected === normalizedActual) {
    return { field, outcome: "exact", expected, actual };
  }
  if (checkState === "flagged") {
    return { field, outcome: "wrong_flagged", expected, actual };
  }
  return { field, outcome: "wrong_plausible", expected, actual };
}

function amountCentsLiteral(cents: number | null): string | null {
  if (cents === null) {
    return null;
  }
  return String(cents);
}

function arithmeticPassed(payload: ExtractedPayload): boolean {
  const merged = mergeDocumentFields(payload, {});
  return checkArithmeticWarnings(merged.fields).length === 0;
}

export function scoreBenchmarkDocument(input: {
  label: BenchmarkLabel;
  payload: ExtractedPayload;
  fieldCheckStates?: Partial<Record<BenchmarkFieldKey, FieldCheckState>>;
  /** The client's own IČO, so the counterparty is picked as production picks it. */
  companyIco?: string | null;
}): BenchmarkDocumentScore {
  const { label, payload, fieldCheckStates } = input;
  const model = readModelPayload(payload);
  const ekasaDates = readEkasaDates(payload);
  const party = counterpartyFromLabel(label);
  const modelParty = pickModelParty(model, label, input.companyIco);
  const scoreReceiptDates = shouldScoreReceiptDates(label);
  const scoreVatAmounts = shouldScoreVatAmounts(label);

  const fields: BenchmarkFieldScore[] = [];

  const documentNumber = model?.documentNumber ?? null;
  fields.push(
    scoreScalar(
      "documentNumber",
      label.documentNumber,
      documentNumber,
      fieldCheckStates?.documentNumber,
    ),
  );

  fields.push(
    scoreScalar(
      "variableSymbol",
      label.variableSymbol,
      model?.variableSymbol ?? null,
      fieldCheckStates?.variableSymbol,
    ),
  );

  if (scoreReceiptDates) {
    fields.push(
      scoreScalar(
        "issueDate",
        label.issueDate,
        model?.issueDate ?? ekasaDates.issueDate,
        fieldCheckStates?.issueDate,
      ),
    );
    fields.push(
      scoreScalar(
        "taxableSupplyDate",
        label.taxableSupplyDate,
        model?.taxableSupplyDate ?? null,
        fieldCheckStates?.taxableSupplyDate,
      ),
    );
    fields.push(
      scoreScalar(
        "dueDate",
        label.dueDate,
        model?.dueDate ?? null,
        fieldCheckStates?.dueDate,
      ),
    );
  } else {
    for (const field of ["issueDate", "taxableSupplyDate", "dueDate"] as const) {
      fields.push({
        field,
        outcome: "skipped",
        expected: label[field],
        actual: model?.[field] ?? null,
      });
    }
  }

  fields.push(
    scoreScalar("currency", label.currency, model?.currency ?? null, fieldCheckStates?.currency),
  );

  fields.push(
    scoreScalar(
      "amountCents",
      // A B1 total includes VAT she self-assessed; the invoice never prints it.
      shouldScoreVatAmounts(label) ? amountCentsLiteral(label.amountCents) : null,
      amountCentsLiteral(model?.amountCents ?? (isEkasaPayload(payload) ? payload.amountCents : null)),
      fieldCheckStates?.amountCents,
    ),
  );

  fields.push(
    scoreScalar(
      "counterpartyName",
      party.name,
      modelParty?.name ?? (isEkasaPayload(payload) ? payload.supplierName : null),
      fieldCheckStates?.counterpartyName,
    ),
  );
  fields.push(
    scoreScalar(
      "counterpartyIco",
      party.ico,
      modelParty?.ico ?? (isEkasaPayload(payload) ? payload.ico : null),
      fieldCheckStates?.counterpartyIco,
    ),
  );
  fields.push(
    scoreScalar(
      "counterpartyIcDph",
      party.icDph,
      modelParty?.icDph ?? (isEkasaPayload(payload) ? payload.icDph : null),
      fieldCheckStates?.counterpartyIcDph,
    ),
  );

  const labelBase = label.vatRecap.reduce((sum, row) => sum + row.baseCents, 0);
  const labelVat = label.vatRecap.reduce((sum, row) => sum + row.vatCents, 0);
  const labelTotal = labelBase + labelVat;
  const actualRecap = model?.vatRecap ?? (isEkasaPayload(payload) ? payload.vatRecap : []);
  // No rows is an empty recap, not a recap that sums to zero.
  const hasRecap = actualRecap.length > 0;
  const actualBase = hasRecap ? actualRecap.reduce((sum, row) => sum + row.baseCents, 0) : null;
  const actualVat = hasRecap ? actualRecap.reduce((sum, row) => sum + row.vatCents, 0) : null;
  const actualTotal = actualBase !== null && actualVat !== null ? actualBase + actualVat : null;

  if (scoreVatAmounts) {
    fields.push(
      scoreScalar(
        "vatRecapBase",
        amountCentsLiteral(labelBase),
        amountCentsLiteral(actualBase),
        fieldCheckStates?.vatRecapBase,
      ),
    );
    fields.push(
      scoreScalar(
        "vatRecapVat",
        amountCentsLiteral(labelVat),
        amountCentsLiteral(actualVat),
        fieldCheckStates?.vatRecapVat,
      ),
    );
    fields.push(
      scoreScalar(
        "vatRecapTotal",
        amountCentsLiteral(labelTotal),
        amountCentsLiteral(actualTotal),
        fieldCheckStates?.vatRecapTotal,
      ),
    );
  } else {
    fields.push(
      scoreScalar(
        "vatRecapBase",
        amountCentsLiteral(labelBase),
        amountCentsLiteral(actualBase),
        fieldCheckStates?.vatRecapBase,
      ),
    );
    for (const field of ["vatRecapVat", "vatRecapTotal"] as const) {
      fields.push({
        field,
        outcome: "skipped",
        expected: field === "vatRecapVat" ? amountCentsLiteral(labelVat) : amountCentsLiteral(labelTotal),
        actual: field === "vatRecapVat" ? amountCentsLiteral(actualVat) : amountCentsLiteral(actualTotal),
      });
    }
  }

  return { driveFileId: label.driveFileId, fields };
}

export function aggregateBenchmarkScores(input: {
  documents: BenchmarkDocumentScore[];
  payloadsByDriveFileId: Record<string, ExtractedPayload>;
}): BenchmarkAggregateScore {
  let amountWrongWhileArithmeticPassed = 0;
  let scoredFields = 0;
  let exactOrEmptyFlagged = 0;
  let wrongPlausible = 0;

  for (const document of input.documents) {
    const payload = input.payloadsByDriveFileId[document.driveFileId] ?? {};
    const arithmeticOk = arithmeticPassed(payload);
    for (const field of document.fields) {
      if (field.outcome === "skipped") {
        continue;
      }
      scoredFields += 1;
      if (field.outcome === "exact" || field.outcome === "empty_flagged") {
        exactOrEmptyFlagged += 1;
      }
      if (isWrongPlausible(field.outcome)) {
        wrongPlausible += 1;
        if (AMOUNT_FIELDS.has(field.field) && arithmeticOk) {
          amountWrongWhileArithmeticPassed += 1;
        }
      }
    }
  }

  const exactOrEmptyFlaggedRate =
    scoredFields === 0 ? 0 : exactOrEmptyFlagged / scoredFields;
  const wrongPlausibleRate = scoredFields === 0 ? 0 : wrongPlausible / scoredFields;

  const passesAmountRule = amountWrongWhileArithmeticPassed === 0;
  const passesAccuracyRule = exactOrEmptyFlaggedRate >= 0.9;
  const passesWrongPlausibleRule = wrongPlausibleRate <= 0.05;

  return {
    documents: input.documents,
    adoptionBar: {
      amountWrongWhileArithmeticPassed,
      scoredFields,
      exactOrEmptyFlagged,
      wrongPlausible,
      exactOrEmptyFlaggedRate,
      wrongPlausibleRate,
      passesAmountRule,
      passesAccuracyRule,
      passesWrongPlausibleRule,
      passes: passesAmountRule && passesAccuracyRule && passesWrongPlausibleRule,
    },
  };
}
