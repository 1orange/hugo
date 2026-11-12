import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like fields-panel-integrity.spec.ts: the register button and the
// provenance badges *z registra* and *z adresára* on the party fields (PRD 0004, story 34-35).

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

        // Delta, a. s. is hers: IČO, DIČ and IČ DPH all check out.
        const CLIENT = { country: "SK", legalName: "Delta, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" };
        const FOLDER = "02 Prijaté faktúry";
        // Received invoice: the counterparty Beta is the supplier, Delta the customer.
        // Beta prints its IČO and name only; the directory knows its DIČ.
        const extracted = {
          kind: "extracted", source: "model",
          parties: [
            { name: "Beta s.r.o.", ico: "50861930", dic: null, icDph: null },
            { name: "Delta, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" },
          ],
          documentNumber: "FA-9", variableSymbol: null, issueDate: "2026-01-10", taxableSupplyDate: null,
          dueDate: null, currency: "EUR", amountCents: 12000, amountLiteral: "120.00", vatRecap: [], docTypeHint: "invoice",
        };
        // The directory's facts for Beta's IČO (ADR 0022): a DIČ it fills, nothing else.
        const DIRECTORY = { "ico:50861930": { name: "", dic: "2020111222", icDph: "" } };
        // What the register says Beta is; the harness can switch it off (no register findings).
        window.registerName = "Gama, a. s.";

        function documentFor(confirmed, decision) {
          const merged = mergeDocumentFields(extracted, confirmed, { folderSlot: FOLDER, profile: CLIENT, directory: DIRECTORY });
          const evidence = window.registerName
            ? { supplier: { register: { legalName: window.registerName, formerNames: [], dic: "2020111222", status: "active" } } }
            : undefined;
          const partyIntegrity = checkDocumentParties({ folderSlot: FOLDER, fields: merged.fields, profile: CLIENT, evidence });
          return {
            id: "register-document", sameReceiptAs: [], folderSlot: FOLDER, decision, extractionSource: "model",
            canReextract: false, showUidBox: false, outsideEkasa: false, typedEkasaUid: null,
            fieldEditor: { ...merged, fieldChecks: null, docTypeHint: "invoice", arithmeticWarning: null,
              homeCurrency: "EUR", profileCountry: "SK", exportSectionOverride: null, exportSectionResolved: "T01",
              roleContext: { profile: CLIENT, enrichmentEnabled: true, directory: DIRECTORY },
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
            onTakeFromRegister={(side) => {
              window.takeCount++;
              // The server writes every party value as shown; the register's name and DIČ become hers, the IČO stays.
              const shown = documentFor(confirmed, null).fieldEditor.fields;
              const next = {
                ...confirmed,
                supplierName: window.registerName,
                ico: shown.ico,
                dic: "2020111222",
                icDph: shown.icDph,
                customerName: shown.customerName,
                customerIco: shown.customerIco,
                customerDic: shown.customerDic,
                customerIcDph: shown.customerIcDph,
                partyProvenance: { ico: "extracted", supplierName: "register", dic: "register" },
              };
              respondWith(next);
            }} />;
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
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Beta s.r.o.");
});

test("a counterparty the register contradicts offers *Prevziať z registra*; the client's party does not", async ({ page }) => {
  await expect(page.getByTestId("party-integrity-supplier")).toHaveText("Nesúhlasí");
  await expect(page.getByTestId("take-register-supplier")).toBeVisible();
  await expect(page.getByTestId("take-register-supplier")).toHaveText("Prevziať z registra");
  await expect(page.getByTestId("take-register-customer")).toHaveCount(0);
});

test("without a register mismatch there is nothing to take", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setRegisterName: (name: string) => void }).setRegisterName("Beta s.r.o."));
  await expect(page.getByTestId("party-integrity-supplier")).toHaveText("Overené");
  await expect(page.getByTestId("take-register-supplier")).toHaveCount(0);
});

test("the directory's DIČ shows the *z adresára* badge, and the register's name the *z registra* one after taking", async ({ page }) => {
  await expect(page.getByTestId("field-dic")).toHaveValue("2020111222");
  await expect(page.locator("label", { has: page.getByTestId("field-dic") }).getByText("z adresára")).toBeVisible();
  await expect(page.locator("label", { has: page.getByTestId("field-supplier-name") }).getByText("z registra")).toHaveCount(0);

  await page.getByTestId("take-register-supplier").click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Gama, a. s.");
  await expect(page.locator("label", { has: page.getByTestId("field-supplier-name") }).getByText("z registra")).toBeVisible();
  await expect(page.locator("label", { has: page.getByTestId("field-dic") }).getByText("z registra")).toBeVisible();
  await expect(page.getByTestId("field-ico")).toHaveValue("50861930");
  await expect(page.getByTestId("party-integrity-supplier")).toHaveText("Overené");
  await expect(page.getByTestId("take-register-supplier")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { takeCount: number }).takeCount)).toBe(1);
});
