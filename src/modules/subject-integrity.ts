import { isValidIcoChecksum } from "./ico-checksum";
import type { CompanyProfileFields } from "./company-profile";
import { coreCompanyName } from "./register-search";
import {
  clientPartyIndex,
  clientSideOfFolder,
  type ClientIdentity,
  type PartyIdentity,
} from "./party-roles";

/**
 * Whether a party is one subject: its name, IČO, DIČ and IČ DPH belong
 * together (ADR 0018, amended 2026-11-11). Pure, so the server view and the
 * fields panel judge the same values the same way.
 */

export type IntegrityField = "name" | "ico" | "dic" | "icDph";
/**
 * unavailable: a check was asked and did not answer (VIES); it names only that check, and the others stand.
 */
export type IntegritySeverity = "notice" | "mismatch" | "unavailable";

/**
 * verified: the client's party agrees with her company profile.
 * valid: formally correct as far as it can be checked offline, not confirmed by a register.
 * notice: nothing wrong, but worth a look (a VAT group's IČ DPH).
 * mismatch: a value is wrong or disagrees with the profile.
 * unverifiable: nothing on the party can be checked (no identifiers, or a foreign VAT ID only).
 * unavailable: a register or VIES was asked and did not answer; offline checks still applied.
 */
export type IntegrityVerdict = "verified" | "valid" | "notice" | "mismatch" | "unverifiable" | "unavailable";

export type IntegrityCode =
  | "ico-format"
  | "ico-checksum"
  | "dic-format"
  | "icdph-format"
  | "icdph-mod11"
  | "icdph-checksum"
  | "vat-group"
  | "profile-name"
  | "profile-ico"
  | "profile-dic"
  | "profile-icdph"
  | "profile-country"
  | "register-name"
  | "register-former-name"
  | "register-dic"
  | "register-dissolved"
  | "register-not-found"
  | "vies-invalid"
  | "vies-lapsed"
  | "vies-holder"
  | "vat-group-unconfirmed"
  | "vies-unavailable";

export type IntegrityFinding = {
  field: IntegrityField;
  code: IntegrityCode;
  severity: IntegritySeverity;
  /** The value as printed, or as she typed it. */
  printed: string;
  /** The authoritative value, where one exists: the profile's, or the SK + DIČ of a VAT group. */
  expected?: string;
};

/**
 * What the register says about the party's IČO (ADR 0022: kept in the subject
 * directory, not fetched per document).
 */
export type RegisterAnswer = {
  legalName: string;
  formerNames: string[];
  dic: string | null;
  status: "active" | "dissolved";
};

/** The register was asked and holds no entity under this IČO. */
export type NotFound = { notFound: true };

/**
 * What VIES says about the party's VAT ID (ADR 0018 amendment, PRD 0004). The
 * holder is null where the member state does not name it.
 */
export type ViesAnswer = {
  valid: boolean;
  holderName: string | null;
  /** Valid when last checked, and no longer: the subject lost a number it had (its VAT registration lapsed). */
  lapsed?: boolean;
};

export type Unavailable = { unavailable: true };

export type RegisterInput = RegisterAnswer | NotFound | Unavailable | null;

export type SubjectCheckInput = {
  party: PartyIdentity;
  /** Whether this party is her company, on the side its folder gives it. */
  isClientParty: boolean;
  /** Her company's identity from the profile. Without one, the client's party is judged offline only. */
  profile?: ClientIdentity | null;
  /**
   * The counterparty's register answer, from the subject directory. Never used
   * for her own party, which is checked against the profile alone.
   */
  register?: RegisterInput;
  /** VIES's answer for the party's VAT ID, from the subject directory. Never used for her own party. */
  vies?: ViesAnswer | Unavailable | null;
  /** The VAT group the directory records the subject as a member of (normalised group VAT ID). */
  vatGroupId?: string | null;
};

/** What the directory knows about a counterparty, by side of the document. */
export type CounterpartyEvidence = {
  register?: RegisterInput;
  vies?: ViesAnswer | Unavailable | null;
  vatGroupId?: string | null;
};

export type SubjectCheck = {
  verdict: IntegrityVerdict;
  findings: IntegrityFinding[];
};

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function upper(value: string): string {
  return compact(value).toUpperCase();
}

function finding(
  field: IntegrityField,
  code: IntegrityCode,
  severity: IntegritySeverity,
  printed: string,
  expected?: string,
): IntegrityFinding {
  return expected === undefined
    ? { field, code, severity, printed }
    : { field, code, severity, printed, expected };
}

/** The country a party's numbers belong to, from its VAT prefix or a CZ DIČ; null when unknown. */
export function countryOf(party: PartyIdentity): "SK" | "CZ" | "foreign" | null {
  const vat = upper(party.icDph);
  if (vat.startsWith("SK")) {
    return "SK";
  }
  if (vat.startsWith("CZ")) {
    return "CZ";
  }
  if (/^[A-Z]{2}/.test(vat)) {
    return "foreign";
  }
  if (upper(party.dic).startsWith("CZ")) {
    return "CZ";
  }
  return null;
}

type OfflineResult = { findings: IntegrityFinding[]; passed: number };

/**
 * The checks of the printed numbers alone: what a register is not needed for.
 * `groupExplained`: the subject's VAT group is known (recorded, or VIES says so),
 * so an IČ DPH that is not SK + DIČ is no longer a question to raise here.
 */
function offlineChecks(party: PartyIdentity, groupExplained: boolean): OfflineResult {
  const findings: IntegrityFinding[] = [];
  let passed = 0;

  const ico = compact(party.ico);
  if (ico.length > 0) {
    if (!/^\d{8}$/.test(ico)) {
      findings.push(finding("ico", "ico-format", "mismatch", party.ico.trim()));
    } else if (!isValidIcoChecksum(ico)) {
      findings.push(finding("ico", "ico-checksum", "mismatch", party.ico.trim()));
    } else {
      passed++;
    }
  }

  const dic = upper(party.dic);
  if (dic.length > 0) {
    const country = countryOf(party);
    let ok = false;
    let bad = false;
    if (dic.startsWith("CZ")) {
      ok = /^CZ\d{8,10}$/.test(dic);
      bad = !ok;
    } else if (/^\d+$/.test(dic)) {
      if (dic.length === 10) {
        ok = true;
      } else if (country === "SK") {
        bad = true;
      } else if (country === "CZ") {
        ok = /^\d{8,10}$/.test(dic);
        bad = !ok;
      }
      // Any other digits are a tax number of an unknown country: not guessed at.
    } else if (country !== "foreign") {
      bad = true;
    }
    if (bad) {
      findings.push(finding("dic", "dic-format", "mismatch", party.dic.trim()));
    } else if (ok) {
      passed++;
    }
  }

  const vat = upper(party.icDph);
  if (vat.length > 0) {
    if (vat.startsWith("SK")) {
      if (!/^SK\d{10}$/.test(vat)) {
        findings.push(finding("icDph", "icdph-format", "mismatch", party.icDph.trim()));
      } else if (Number(vat.slice(2)) % 11 !== 0) {
        findings.push(finding("icDph", "icdph-mod11", "mismatch", party.icDph.trim()));
      } else {
        passed++;
        // A VAT group's IČ DPH is its own number, not SK + DIČ: a notice (ADR 0018).
        if (!groupExplained && /^\d{10}$/.test(dic) && vat !== `SK${dic}`) {
          findings.push(finding("icDph", "vat-group", "notice", party.icDph.trim(), `SK${dic}`));
        }
      }
    } else if (vat.startsWith("CZ")) {
      if (!/^CZ\d{8,10}$/.test(vat)) {
        findings.push(finding("icDph", "icdph-format", "mismatch", party.icDph.trim()));
      } else if (/^CZ\d{8}$/.test(vat) && !isValidIcoChecksum(vat.slice(2))) {
        findings.push(finding("icDph", "icdph-checksum", "mismatch", party.icDph.trim()));
      } else {
        passed++;
      }
    } else if (!/^[A-Z]{2}/.test(vat)) {
      findings.push(finding("icDph", "icdph-format", "mismatch", party.icDph.trim()));
    }
    // A foreign VAT ID is not checked here.
  }

  return { findings, passed };
}

type ProfileResult = { findings: IntegrityFinding[]; compared: number };

/** Her party against her company profile: every field both sides print is compared. */
function profileChecks(party: PartyIdentity, profile: ClientIdentity): ProfileResult {
  const findings: IntegrityFinding[] = [];
  let compared = 0;

  const name = party.name.trim();
  const legalName = (profile.legalName ?? "").trim();
  if (name.length > 0 && legalName.length > 0) {
    compared++;
    if (coreCompanyName(name) !== coreCompanyName(legalName)) {
      findings.push(finding("name", "profile-name", "mismatch", name, legalName));
    }
  }

  const ico = compact(party.ico);
  const profileIco = compact(profile.ico);
  if (ico.length > 0 && profileIco.length > 0) {
    compared++;
    if (ico !== profileIco) {
      findings.push(finding("ico", "profile-ico", "mismatch", party.ico.trim(), profileIco));
    }
  }

  const dic = upper(party.dic);
  const profileDic = upper(profile.dic ?? "");
  if (dic.length > 0 && profileDic.length > 0) {
    compared++;
    if (dic !== profileDic) {
      findings.push(finding("dic", "profile-dic", "mismatch", party.dic.trim(), (profile.dic ?? "").trim()));
    }
  }

  const vat = upper(party.icDph);
  const profileVat = upper(profile.icDph);
  if (vat.length > 0 && profileVat.length > 0) {
    compared++;
    if (vat !== profileVat) {
      findings.push(finding("icDph", "profile-icdph", "mismatch", party.icDph.trim(), profile.icDph.trim()));
    }
  }

  // The VAT prefix names a country: a party of another country than hers is not her.
  const prefix = vat.slice(0, 2);
  if ((prefix === "SK" || prefix === "CZ") && prefix !== profile.country) {
    compared++;
    findings.push(finding("icDph", "profile-country", "mismatch", party.icDph.trim(), profile.country));
  }

  return { findings, compared };
}

function isUnavailable(answer: unknown): answer is Unavailable {
  return typeof answer === "object" && answer !== null && (answer as { unavailable?: unknown }).unavailable === true;
}

function isNotFound(answer: unknown): answer is NotFound {
  return typeof answer === "object" && answer !== null && (answer as { notFound?: unknown }).notFound === true;
}

/** A DIČ as the register and the document compare it: no spaces, no case, no CZ/SK prefix. */
export function comparableDic(value: string): string {
  return upper(value).replace(/^(SK|CZ)/, "");
}

type RegisterResult = { findings: IntegrityFinding[]; compared: number; unavailable: boolean };

/**
 * The party against what the register says about its IČO (ADR 0018, amended
 * 2026-11-11). The name is compared with the current legal name and then the
 * former ones, by the core company name, so legal form, diacritics and
 * punctuation do not matter; the DIČ exactly, after normalisation.
 */
function registerChecks(party: PartyIdentity, answer: RegisterInput | undefined): RegisterResult {
  if (answer === undefined || answer === null) {
    return { findings: [], compared: 0, unavailable: false };
  }
  if (isUnavailable(answer)) {
    return { findings: [], compared: 0, unavailable: true };
  }
  if (isNotFound(answer)) {
    return {
      findings: [finding("ico", "register-not-found", "notice", party.ico.trim())],
      compared: 0,
      unavailable: false,
    };
  }

  const findings: IntegrityFinding[] = [];
  let compared = 0;
  if (answer.status === "dissolved") {
    findings.push(finding("ico", "register-dissolved", "notice", party.ico.trim()));
  }

  const name = party.name.trim();
  const legalName = answer.legalName.trim();
  const printedCore = coreCompanyName(name);
  if (printedCore.length > 0 && legalName.length > 0) {
    if (printedCore === coreCompanyName(legalName)) {
      compared++;
    } else if (answer.formerNames.some((former) => coreCompanyName(former) === printedCore)) {
      compared++;
      findings.push(finding("name", "register-former-name", "notice", name, legalName));
    } else {
      findings.push(finding("name", "register-name", "mismatch", name, legalName));
    }
  }

  const dic = comparableDic(party.dic);
  const registered = answer.dic ? comparableDic(answer.dic) : "";
  if (dic.length > 0 && registered.length > 0) {
    if (dic === registered) {
      compared++;
    } else {
      findings.push(finding("dic", "register-dic", "mismatch", party.dic.trim(), (answer.dic ?? "").trim()));
    }
  }

  return { findings, compared, unavailable: false };
}

/** A VAT ID as the comparisons read it: no spaces, upper case. */
export function normalizedVatId(value: string | null | undefined): string {
  return upper(value ?? "");
}

/** VIES's group holder: "Group registration", with or without the long explanation VIES adds. */
export function isGroupRegistrationHolder(holderName: string | null | undefined): boolean {
  return /group registration|group of taxpayers/i.test(holderName ?? "");
}

/**
 * A holder name VIES gave that can be compared. VIES answers empty names, or
 * "---", for some member states: those are no name to compare, not a mismatch.
 */
export function comparableHolderName(holderName: string | null | undefined): string | null {
  const name = (holderName ?? "").trim();
  return name.length === 0 || name === "---" ? null : name;
}

/** The party is recorded as a member of the VAT group its IČ DPH belongs to. */
function isMemberOfGroup(party: PartyIdentity, vatGroupId: string | null | undefined): boolean {
  const group = normalizedVatId(vatGroupId);
  return group.length > 0 && normalizedVatId(party.icDph) === group;
}

type ViesResult = {
  findings: IntegrityFinding[];
  compared: number;
  unavailable: boolean;
  /** VIES reported the group registration: the group is known, whether or not the subject is recorded in it. */
  groupExplained: boolean;
};

/**
 * The party's IČ DPH against VIES (PRD 0004, story 32, 33): invalid is a
 * mismatch, and a lapsed registration says so; a valid number is compared with
 * the holder's name, legal form aside, and a VAT group ("Group registration")
 * is verified only when the subject is recorded as a member of that group.
 */
function viesChecks(
  party: PartyIdentity,
  vies: ViesAnswer | Unavailable | null | undefined,
  register: RegisterInput | undefined,
  vatGroupId: string | null | undefined,
): ViesResult {
  const none: ViesResult = { findings: [], compared: 0, unavailable: false, groupExplained: false };
  // The VAT ID VIES was asked about: the IČ DPH, or a Czech party's DIČ, which is its VAT ID.
  const field: IntegrityField = compact(party.icDph) ? "icDph" : "dic";
  const printed = (field === "icDph" ? party.icDph : party.dic).trim();

  if (isUnavailable(vies)) {
    return {
      ...none,
      unavailable: true,
      findings: printed ? [finding(field, "vies-unavailable", "unavailable", printed)] : [],
    };
  }
  if (!vies || printed.length === 0) {
    return none;
  }
  if (!vies.valid) {
    return {
      ...none,
      findings: [finding(field, vies.lapsed ? "vies-lapsed" : "vies-invalid", "mismatch", printed)],
    };
  }

  const holder = comparableHolderName(vies.holderName);
  if (holder === null) {
    return none;
  }
  if (isGroupRegistrationHolder(holder)) {
    const member = isMemberOfGroup(party, vatGroupId);
    return {
      findings: member ? [] : [finding(field, "vat-group-unconfirmed", "notice", printed)],
      compared: member ? 1 : 0,
      unavailable: false,
      groupExplained: true,
    };
  }

  const printedName = party.name.trim();
  if (printedName.length === 0) {
    return none;
  }
  // The holder may be the register's name for the IČO rather than the name as printed (a trade name).
  const accepted = [printedName, register && "legalName" in register ? register.legalName : ""];
  if (register && "formerNames" in register) {
    accepted.push(...register.formerNames);
  }
  const holderCore = coreCompanyName(holder);
  if (accepted.some((name) => name.trim().length > 0 && coreCompanyName(name) === holderCore)) {
    return { ...none, compared: 1 };
  }
  return { ...none, findings: [finding("name", "vies-holder", "mismatch", printedName, holder)] };
}

/**
 * The verdict for one party. Mismatches outrank notices; a party compared with
 * her profile or with the register is verified; otherwise what passed offline
 * is valid, and a party with nothing checkable is unverifiable. An unavailable
 * register or VIES turns the non-findings into unavailable.
 */
export function checkSubject(input: SubjectCheckInput): SubjectCheck {
  // Her own party is never judged by a register or VIES: the profile is its source.
  const counterparty = !input.isClientParty;
  const register = counterparty ? registerChecks(input.party, input.register) : null;
  const vies = counterparty ? viesChecks(input.party, input.vies, input.register, input.vatGroupId) : null;
  const member = counterparty && isMemberOfGroup(input.party, input.vatGroupId);

  const offline = offlineChecks(input.party, member || (vies?.groupExplained ?? false));
  const findings = [...offline.findings];
  let compared = 0;
  if (input.isClientParty && input.profile) {
    const profile = profileChecks(input.party, input.profile);
    findings.push(...profile.findings);
    compared = profile.compared;
  }

  if (register) {
    findings.push(...register.findings);
    compared += register.compared;
  }
  if (vies) {
    findings.push(...vies.findings);
    compared += vies.compared;
  }
  const unavailable = (register?.unavailable ?? false) || (vies?.unavailable ?? false);

  if (findings.some((item) => item.severity === "mismatch")) {
    return { verdict: "mismatch", findings };
  }
  if (findings.some((item) => item.severity === "notice")) {
    return { verdict: "notice", findings };
  }
  if (compared > 0) {
    return { verdict: "verified", findings };
  }
  if (unavailable) {
    return { verdict: "unavailable", findings };
  }
  if (offline.passed > 0) {
    return { verdict: "valid", findings };
  }
  return { verdict: "unverifiable", findings };
}

/**
 * Which side is her company: by its folder when the folder says so (the
 * supplier of issued invoices, the customer of received ones), else by the
 * side whose IČO or DIČ matches the profile.
 */
export function clientSideOf(input: {
  folderSlot: string;
  supplier: PartyIdentity;
  customer: PartyIdentity;
  profile: ClientIdentity | null;
}): "supplier" | "customer" | null {
  const designated = clientSideOfFolder(input.folderSlot);
  if (designated) {
    return designated;
  }
  if (!input.profile) {
    return null;
  }
  const index = clientPartyIndex([input.supplier, input.customer], input.profile);
  if (index === 0) {
    return "supplier";
  }
  if (index === 1) {
    return "customer";
  }
  return null;
}

/** Both parties of a document, judged with the side of hers that its folder gives. */
export function checkBothParties(input: {
  folderSlot: string;
  supplier: PartyIdentity;
  customer: PartyIdentity;
  profile: ClientIdentity | null;
  /** The counterparty's directory evidence, by side. Absent judges offline and against the profile only. */
  evidence?: { supplier?: CounterpartyEvidence; customer?: CounterpartyEvidence };
}): { supplier: SubjectCheck; customer: SubjectCheck } {
  const side = clientSideOf(input);
  return {
    supplier: checkSubject({
      party: input.supplier,
      isClientParty: side === "supplier",
      profile: input.profile,
      ...evidenceOf(input.evidence?.supplier),
    }),
    customer: checkSubject({
      party: input.customer,
      isClientParty: side === "customer",
      profile: input.profile,
      ...evidenceOf(input.evidence?.customer),
    }),
  };
}

function evidenceOf(evidence: CounterpartyEvidence | undefined): Partial<SubjectCheckInput> {
  return {
    register: evidence?.register,
    vies: evidence?.vies,
    vatGroupId: evidence?.vatGroupId,
  };
}

/** Her company as the integrity checks and roles read it; null without a profile. */
export function clientIdentityOf(profile: CompanyProfileFields | null): ClientIdentity | null {
  if (!profile) {
    return null;
  }
  return {
    country: profile.country,
    ico: profile.ico,
    icDph: profile.icDph,
    dic: profile.dic,
    legalName: profile.legalName,
  };
}

/** The party fields of a document, under the names the editor and the view both use. */
export type DocumentPartyFields = {
  supplierName: string;
  ico: string;
  dic: string;
  icDph: string;
  customerName: string;
  customerIco: string;
  customerDic: string;
  customerIcDph: string;
};

/** checkBothParties on a document's fields, as the view and the fields panel both read them. */
export function checkDocumentParties(input: {
  folderSlot: string;
  fields: DocumentPartyFields;
  profile: ClientIdentity | null;
  evidence?: { supplier?: CounterpartyEvidence; customer?: CounterpartyEvidence };
}): { supplier: SubjectCheck; customer: SubjectCheck } {
  const { fields } = input;
  return checkBothParties({
    folderSlot: input.folderSlot,
    supplier: { name: fields.supplierName, ico: fields.ico, dic: fields.dic, icDph: fields.icDph },
    customer: {
      name: fields.customerName,
      ico: fields.customerIco,
      dic: fields.customerDic,
      icDph: fields.customerIcDph,
    },
    profile: input.profile,
    evidence: input.evidence,
  });
}

/**
 * The identity a verdict was judged for: the eight party values and her
 * profile's identity. A stored verdict is current only while this is the same.
 */
export function partyIdentityKey(fields: DocumentPartyFields, profile: ClientIdentity | null): string {
  const values = [
    fields.supplierName,
    fields.ico,
    fields.dic,
    fields.icDph,
    fields.customerName,
    fields.customerIco,
    fields.customerDic,
    fields.customerIcDph,
  ].map((value) => String(value ?? "").trim());
  const who = profile
    ? [profile.country, profile.ico, profile.icDph, profile.dic ?? "", profile.legalName ?? ""]
    : null;
  return JSON.stringify([values, who]);
}

/**
 * The verdicts the worker stored for a document, with the identity they were
 * judged for (ADR 0022: pages read only stored verdicts). The worker writes it;
 * a stale identity means the page judges offline until the worker catches up.
 */
export type PartyIntegrityRecord = {
  identity: string;
  checkedAt: string;
  supplier: SubjectCheck;
  customer: SubjectCheck;
};

function isSubjectCheck(value: unknown): value is SubjectCheck {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { verdict?: unknown; findings?: unknown };
  return typeof record.verdict === "string" && Array.isArray(record.findings);
}

export function parsePartyIntegrityRecord(json: string | null | undefined): PartyIntegrityRecord | null {
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as Partial<PartyIntegrityRecord>;
    if (
      typeof parsed.identity === "string" &&
      typeof parsed.checkedAt === "string" &&
      isSubjectCheck(parsed.supplier) &&
      isSubjectCheck(parsed.customer)
    ) {
      return parsed as PartyIntegrityRecord;
    }
  } catch {
    // A corrupt record is no record: the page judges offline.
  }
  return null;
}

/** The mismatches the register or VIES states with the value it holds, which "Prevziať z registra" takes (PRD 0004, story 34). */
const REGISTER_TAKEOVER_CODES: readonly IntegrityCode[] = ["register-name", "register-dic", "vies-holder"];

/** Whether a verdict holds a register or VIES mismatch the accountant may take the register's value for. */
export function offersRegisterTakeover(check: SubjectCheck): boolean {
  return check.findings.some(
    (item) =>
      item.severity === "mismatch" &&
      item.expected !== undefined &&
      REGISTER_TAKEOVER_CODES.includes(item.code),
  );
}

/** The mismatches the profile states with the value it holds, which "Prevziať z profilu" takes (PRD 0007, issue 14). */
const PROFILE_TAKEOVER_CODES: readonly IntegrityCode[] = ["profile-name", "profile-ico", "profile-dic", "profile-icdph"];

/**
 * Whether a verdict holds a profile mismatch the accountant may take the profile's value for. Only her own
 * party is judged against the profile, so only her party's verdict can offer it.
 */
export function offersProfileTakeover(check: SubjectCheck): boolean {
  return check.findings.some(
    (item) =>
      item.severity === "mismatch" &&
      item.expected !== undefined &&
      PROFILE_TAKEOVER_CODES.includes(item.code),
  );
}

const VERDICT_LABELS: Record<IntegrityVerdict, string> = {
  verified: "Overené",
  valid: "Formálne v poriadku",
  notice: "Upozornenie",
  mismatch: "Nesúhlasí",
  unverifiable: "Nedá sa overiť",
  unavailable: "Overenie nedostupné",
};

export function verdictLabel(verdict: IntegrityVerdict): string {
  return VERDICT_LABELS[verdict];
}

const FINDING_MESSAGES: Record<IntegrityCode, (item: IntegrityFinding) => string> = {
  "ico-format": () => "IČO musí mať 8 číslic.",
  "ico-checksum": () => "IČO nemá platnú kontrolnú číslicu — pravdepodobne preklep.",
  "dic-format": () => "DIČ nemá platný tvar — slovenské má 10 číslic, české CZ a 8 až 10 číslic.",
  "icdph-format": () => "IČ DPH nemá platný tvar — SK a 10 číslic, CZ a 8 až 10 číslic.",
  "icdph-mod11": () => "Slovenské IČ DPH musí byť deliteľné 11.",
  "icdph-checksum": () => "České IČ DPH nemá platnú kontrolnú číslicu.",
  "vat-group": (item) =>
    `IČ DPH nie je SK + DIČ (${item.expected}) — môže ísť o člena skupiny DPH.`,
  "profile-name": (item) => `Názov nezodpovedá profilu klienta — v profile: ${item.expected}.`,
  "profile-ico": (item) => `IČO nezodpovedá profilu klienta — v profile: ${item.expected}.`,
  "profile-dic": (item) => `DIČ nezodpovedá profilu klienta — v profile: ${item.expected}.`,
  "profile-icdph": (item) => `IČ DPH nezodpovedá profilu klienta — v profile: ${item.expected}.`,
  "profile-country": (item) => `Predvoľba IČ DPH nezodpovedá krajine firmy — v profile: ${item.expected}.`,
  "register-name": (item) => `Názov nezodpovedá IČO — v registri: ${item.expected}.`,
  "register-former-name": (item) => `Bývalý názov firmy — v registri je dnes: ${item.expected}.`,
  "register-dic": (item) => `DIČ nezodpovedá registru — v registri: ${item.expected}.`,
  "register-dissolved": () => "Subjekt je v registri vedený ako zaniknutý.",
  "register-not-found": () => "IČO sa v registri nenašlo.",
  "vies-invalid": () => "IČ DPH nie je registrované vo VIES — overte číslo.",
  "vies-lapsed": () => "IČ DPH už nie je platné — VIES ho dnes nepozná.",
  "vies-holder": (item) => `Názov nezodpovedá IČ DPH — vo VIES je: ${item.expected}.`,
  "vat-group-unconfirmed": () => "Skupinová registrácia DPH — členstvo nie je potvrdené.",
  "vies-unavailable": () => "VIES neodpovedá — IČ DPH sa nedalo overiť.",
};

/** The Slovak line shown for one finding; the panel and the tests share it. */
export function subjectFindingMessage(item: IntegrityFinding): string {
  return FINDING_MESSAGES[item.code](item);
}
