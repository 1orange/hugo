import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DriveAccessSection, type DriveAccessRow } from "../../../src/app/settings/drive-access.tsx";

// Next compiles JSX with its automatic runtime, so the component never imports React. The test's
// loader compiles classic `React.createElement`, so React is put in scope for it here.
(globalThis as { React?: unknown }).React = React;
const createElement = React.createElement;

const row = (overrides: Partial<DriveAccessRow>): DriveAccessRow => ({
  companyId: 1,
  name: "Alfa",
  groupName: "Eva",
  refreshedAt: "2026-11-23T08:00:00.000Z",
  error: null,
  visibleTo: [],
  groups: [],
  ...overrides,
});

function render(rows: DriveAccessRow[]): string {
  return renderToStaticMarkup(createElement(DriveAccessSection, { rows }));
}

test("settings lists, per company, the allowlisted users who can see it and the group grants", () => {
  const html = render([
    row({ name: "Alfa", visibleTo: ["eva@kancelaria.sk", "jana@kancelaria.sk"] }),
    row({ companyId: 2, name: "Gama", groupName: "Jana", visibleTo: [], groups: [{ email: "ucto@kancelaria.sk", role: "reader" }] }),
  ]);

  assert.match(html, /Prístup z Drive/);
  assert.match(html, /Vidia: eva@kancelaria\.sk, jana@kancelaria\.sk/);
  assert.match(html, /Vidia: nikto z prihlásených/);
  assert.match(html, /Skupiny \(nepodporované, zdieľaj s ľuďmi priamo\): ucto@kancelaria\.sk \(čitateľ\)/);
});

test("settings shows when the sharing was last read, and a failed read with the previous state kept", () => {
  const html = render([row({ error: "Drive permissions.list failed with status 403" })]);

  assert.match(html, /Načítané /);
  assert.doesNotMatch(html, /ešte nebolo/);
  assert.match(html, /Posledné čítanie zlyhalo \(Drive permissions\.list failed with status 403\)/);
});

test("a company never read says so, and no group line appears without group grants", () => {
  const html = render([row({ refreshedAt: null })]);

  assert.match(html, /Načítané ešte nebolo/);
  assert.doesNotMatch(html, /Skupiny/);
});
