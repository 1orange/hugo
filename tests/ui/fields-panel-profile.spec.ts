import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like fields-panel-register.spec.ts: the profile button and the *profil* badge on the
// client's own party (PRD 0007, issue 14), and both buttons when a counterparty and her party both apply.

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { FieldsPanel } from "./src/app/companies/[companyId]/[monthKey]/fields-panel";
        import { mergeDocumentFields, parseConfirmedFieldsFromInput } from "./src/modules/document-fields";
        import { emptyConfirmedPayload } from "./src/modules/document-payload";
        import { checkDocumentParties, partyIdentityKey } from "./src/modules/subject-integrity";

        // Delta, a. s. is hers; her profile holds all four identifiers.
        const CLIENT = { country: "SK", legalName: "Delta, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" };
        const FOLDER = "02 Prijaté faktúry";
        // Received invoice: the counterparty Beta is the supplier, Delta the customer, printed as Delta Trade.
        const extracted = {
          kind: "extracted", source: "model",
          parties: [
            { name: "Beta s.r.o.", ico: "50861930", dic: null, icDph: null },
            { name: "Delta Trade, a. s.", ico: "31322999", dic: "2020372640", icDph: "SK2020372640" },
          ],
          documentNumber: "FA-10", variableSymbol: null, issueDate: "2026-01-10", taxableSupplyDate: null,
          dueDate: null, currency: "EUR", amountCents: 12000, amountLiteral: "120.00", vatRecap: [], docTypeHint: "invoice",
        };
        // What the register says Beta is; the harness can switch it on (a register mismatch on the counterparty).
        window.registerName = "Beta s.r.o.";

        function documentFor(confirmed, decision) {
          const merged = mergeDocumentFields(extracted, confirmed, { folderSlot: FOLDER, profile: CLIENT, directory: {} });
          const evidence = window.registerName !== "Beta s.r.o."
            ? { supplier: { register: { legalName: window.registerName, formerNames: [], dic: null, status: "active" } } }
            : undefined;
          const partyIntegrity = checkDocumentParties({ folderSlot: FOLDER, fields: merged.fields, profile: CLIENT, evidence });
          return {
            id: "profile-document", sameReceiptAs: [], folderSlot: FOLDER, decision, extractionSource: "model",
            canReextract: false, showUidBox: false, outsideEkasa: false, typedEkasaUid: null,
            fieldEditor: { ...merged, fieldChecks: null, docTypeHint: "invoice", arithmeticWarning: null,
              homeCurrency: "EUR", profileCountry: "SK", exportSectionOverride: null, exportSectionResolved: "T01",
              roleContext: { profile: CLIENT, enrichmentEnabled: true, directory: {} },
              partyIntegrity, partyIntegrityStored: true, partyIntegrityIdentity: partyIdentityKey(merged.fields, CLIENT) },
          };
        }
        window.takeCount = 0;
        function Harness() {
          const [confirmed, setConfirmed] = useState(emptyConfirmedPayload());
          const [doc, setDoc] = useState(documentFor(emptyConfirmedPayload(), null));
          function respondWith(next) {
            setConfirmed(next);
            setTimeout(() => setDoc(documentFor(next, null)), 0);
          }
          window.setRegisterName = (name) => {
            window.registerName = name;
            setTimeout(() => setDoc(documentFor(confirmed, null)), 0);
          };
          return <FieldsPanel document={doc} readOnly={false} pending={false} saveState="saved"
            note="" noteDirty={false} onNoteChange={() => {}} onNoteSave={() => {}}
            onLookupUid={() => {}} uidLookupMessage={null} onReextract={() => {}}
            onSave={input => {
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              respondWith(parsed.payload);
            }}
            onSwapParties={(input, partyProvenance) => {
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              respondWith({ ...parsed.payload, partyProvenance });
            }}
            onTakeFromRegister={() => {}}
            onTakeFromProfile={(side) => {
              window.takeCount++;
              // The server writes the profile's values of her party, IČO included, with the profile badge.
              const shown = documentFor(confirmed, null).fieldEditor.fields;
              const next = {
                ...confirmed,
                supplierName: shown.supplierName,
                ico: shown.ico,
                dic: shown.dic,
                icDph: shown.icDph,
                customerName: CLIENT.legalName,
                customerIco: CLIENT.ico,
                customerDic: CLIENT.dic,
                customerIcDph: CLIENT.icDph,
                partyProvenance: { customerName: "profile", customerIco: "profile", customerDic: "profile", customerIcDph: "profile" },
              };
              respondWith(next);
            }}
            onSetAdvanceSettlement={() => {}} />;
        }
        createRoot(window.document.getElementById("root")).render(<Harness />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByTestId("field-customer-name")).toHaveValue("Delta Trade, a. s.");
});

test("a client's party that the profile contradicts offers *Prevziať z profilu*; the counterparty does not", async ({ page }) => {
  await expect(page.getByTestId("party-integrity-customer")).toHaveText("Nesúhlasí");
  await expect(page.getByTestId("take-profile-customer")).toBeVisible();
  await expect(page.getByTestId("take-profile-customer")).toHaveText("Prevziať z profilu");
  await expect(page.getByTestId("take-profile-supplier")).toHaveCount(0);
  await expect(page.getByTestId("take-register-customer")).toHaveCount(0);
});

test("the button's tooltip names what it writes", async ({ page }) => {
  await expect(page.getByTestId("take-profile-customer")).toHaveAttribute(
    "title",
    "Z profilu klienta sa zapíšu ako tvoje údaje: Názov, IČO, DIČ a IČ DPH.",
  );
});

test("a profile that agrees with her party offers nothing", async ({ page }) => {
  await page.getByTestId("field-customer-name").fill("Delta, a. s.");
  await page.getByTestId("field-customer-name").blur();
  await page.getByTestId("field-customer-ico").fill("31322832");
  await page.getByTestId("field-customer-ico").blur();
  await expect(page.getByTestId("party-integrity-customer")).toHaveText("Overené");
  await expect(page.getByTestId("take-profile-customer")).toHaveCount(0);
});

test("taking from the profile fills her party's values with the *profil* badge and clears the mismatch", async ({ page }) => {
  await page.getByTestId("take-profile-customer").click();

  await expect(page.getByTestId("field-customer-name")).toHaveValue("Delta, a. s.");
  await expect(page.getByTestId("field-customer-ico")).toHaveValue("31322832");
  await expect(page.locator("label", { has: page.getByTestId("field-customer-name") }).getByText("profil")).toBeVisible();
  await expect(page.locator("label", { has: page.getByTestId("field-customer-ico") }).getByText("profil")).toBeVisible();
  await expect(page.getByTestId("party-integrity-customer")).toHaveText("Overené");
  await expect(page.getByTestId("take-profile-customer")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { takeCount: number }).takeCount)).toBe(1);
});

test("with a register mismatch on the counterparty both buttons show, each on its own party", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setRegisterName: (name: string) => void }).setRegisterName("Gama, a. s."));

  await expect(page.getByTestId("take-register-supplier")).toBeVisible();
  await expect(page.getByTestId("take-profile-customer")).toBeVisible();
  await expect(page.getByTestId("take-profile-supplier")).toHaveCount(0);
  await expect(page.getByTestId("take-register-customer")).toHaveCount(0);
});
