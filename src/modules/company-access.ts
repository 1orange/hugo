/**
 * Who may see a company, read from the sharing of its Drive folder (PRD 0007).
 *
 * Pure: a folder's grants go in, an email goes in, and the answer comes out. No
 * Drive call, no database. Issue 08 only reads and shows this; nothing is
 * restricted by it yet.
 *
 * Why four principal types: Drive also lists other kinds, which are dropped. A
 * `group` cannot be expanded here: that needs the Admin or Cloud Identity API,
 * which the service account does not have. Its grant is kept and reported, so
 * the office knows to share with those people directly.
 */

export const PRINCIPAL_TYPES = ["user", "group", "domain", "anyone"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

/** A grant on a folder as Drive lists it. `inherited` means it was made on a parent folder only. */
export type DrivePermission = {
  type: string;
  role: string;
  emailAddress?: string | null;
  domain?: string | null;
  inherited: boolean;
};

/** One principal of a company folder, normalised: email and domain lower-cased, the rest null. */
export type AccessPrincipal = {
  type: PrincipalType;
  email: string | null;
  domain: string | null;
  role: string;
  inherited: boolean;
};

function isPrincipalType(type: string): type is PrincipalType {
  return (PRINCIPAL_TYPES as readonly string[]).includes(type);
}

/**
 * Drive's grants as principals. A user or group grant without an email, or a
 * domain grant without a domain, cannot match anyone, so it is left out.
 */
export function principalsFromPermissions(permissions: readonly DrivePermission[]): AccessPrincipal[] {
  const principals: AccessPrincipal[] = [];
  for (const permission of permissions) {
    if (!isPrincipalType(permission.type)) {
      continue;
    }
    const email = permission.emailAddress?.trim().toLowerCase() || null;
    const domain = permission.domain?.trim().toLowerCase() || null;
    if (permission.type === "anyone") {
      principals.push({ type: "anyone", email: null, domain: null, role: permission.role, inherited: permission.inherited });
    } else if (permission.type === "domain") {
      if (domain) {
        principals.push({ type: "domain", email: null, domain, role: permission.role, inherited: permission.inherited });
      }
    } else if (email) {
      principals.push({ type: permission.type, email, domain: null, role: permission.role, inherited: permission.inherited });
    }
  }
  return principals;
}

/**
 * Whether the person with this email sees the company. A user principal with
 * the same email, a domain principal for the email's domain, or an anyone
 * principal. Groups are not expanded. No snapshot (null) means not visible:
 * a company Hugo has never read its sharing of is closed, not open.
 */
export function canSee(email: string, principals: readonly AccessPrincipal[] | null): boolean {
  if (!principals) {
    return false;
  }
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  const domain = at >= 0 ? address.slice(at + 1) : "";
  return principals.some((principal) => {
    if (principal.type === "anyone") {
      return true;
    }
    if (principal.type === "user") {
      const granted = principal.email?.trim().toLowerCase();
      return granted !== undefined && granted !== "" && granted === address;
    }
    if (principal.type === "domain") {
      const granted = principal.domain?.trim().toLowerCase();
      return granted !== undefined && granted !== "" && granted === domain;
    }
    return false;
  });
}

/** The group grants of a company: reported, not expanded (see the module comment). */
export function groupGrantsOf(principals: readonly AccessPrincipal[] | null): AccessPrincipal[] {
  return (principals ?? []).filter((principal) => principal.type === "group");
}

/** The allowlisted emails that see the company, in the order given. */
export function visibleToAllowlist(allowlist: readonly string[], principals: readonly AccessPrincipal[] | null): string[] {
  return allowlist.filter((email) => canSee(email, principals));
}

/** A company whose sharing is read: its folder, its company id, and its parent folder in Drive. */
export type AccessRefreshCandidate = { companyId: number; driveFolderId: string; parentId: string | null };

/**
 * The companies whose sharing a sweep reads. Everything on a full pass or a
 * poll. Otherwise those the change log named: the company folder itself, or its
 * group folder (sharing changes show there). A change to the Clients folder
 * itself reaches every company, since they inherit from it.
 */
export function companiesForAccessRefresh(input: {
  companies: readonly AccessRefreshCandidate[];
  driveParentFolderId: string;
  changedFileIds: readonly string[];
  all: boolean;
}): AccessRefreshCandidate[] {
  const changed = new Set(input.changedFileIds);
  if (input.all || changed.has(input.driveParentFolderId)) {
    return [...input.companies];
  }
  return input.companies.filter(
    (company) => changed.has(company.driveFolderId) || (company.parentId !== null && changed.has(company.parentId)),
  );
}
