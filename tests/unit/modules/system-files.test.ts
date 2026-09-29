import { test } from "node:test";
import assert from "node:assert/strict";
import { isSystemFile } from "../../../src/modules/system-files.ts";

test("files a system writes by itself are system files", () => {
  for (const name of ["desktop.ini", "Desktop.ini", ".DS_Store", "Thumbs.db", "._faktura.pdf", "~$faktura.docx", ".~lock.vypis.xlsx#", "Icon\r", "Faktúry - skratka.lnk"]) {
    assert.equal(isSystemFile(name), true, JSON.stringify(name));
  }
});

test("anything a person saved stays, Word and Excel included", () => {
  for (const name of ["faktura.pdf", "IMG_3475.HEIC", "vypis.xml", "faktura.docx", "mzdy.xlsx", "desktop.ini.pdf", "Icon.png"]) {
    assert.equal(isSystemFile(name), false, name);
  }
});
