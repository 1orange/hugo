"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CompanyProfileRow } from "@/adapters/store/company-profiles";
import type { CompanyCountry, RegisterSearchHit } from "@/modules/company-profile";
import {
  countrySetupLabel,
  registerDirectLookupLabel,
  registerSearchHeading,
  registerStatusLabel,
} from "@/modules/company-profile";
import { lookupRegisterAction, searchRegisterAction } from "./actions";

type CompanyProfileFormProps = {
  companyId: number;
  folderName: string;
  initialCountry: CompanyCountry;
  initialProfile: CompanyProfileRow | null;
  initialCandidates?: RegisterSearchHit[];
  pickedFromRegister?: {
    legalName: string;
    address: string;
    ico: string;
    dic: string;
    registerSource: string;
  } | null;
  registerLookupError?: string | null;
  saveFormAction: (formData: FormData) => void | Promise<void>;
  savedFlash?: boolean;
  saveErrorFlash?: string | null;
};

type Draft = {
  legalName: string;
  address: string;
  ico: string;
  dic: string;
  icDph: string;
  registerSource: string;
};

export function CompanyProfileForm({
  companyId,
  folderName,
  initialCountry,
  initialProfile,
  initialCandidates = [],
  pickedFromRegister = null,
  registerLookupError = null,
  saveFormAction,
  savedFlash = false,
  saveErrorFlash = null,
}: CompanyProfileFormProps) {
  const [country, setCountry] = useState<CompanyCountry>(
    initialProfile?.country ?? initialCountry,
  );
  const [searchQuery, setSearchQuery] = useState(folderName);
  const [hits, setHits] = useState<RegisterSearchHit[]>(initialCandidates);
  const [directIco, setDirectIco] = useState(pickedFromRegister?.ico ?? "");
  const [draft, setDraft] = useState<Draft>(() => {
    if (initialProfile) {
      return {
        legalName: initialProfile.legalName,
        address: initialProfile.address,
        ico: initialProfile.ico,
        dic: initialProfile.dic,
        icDph: initialProfile.icDph,
        registerSource: initialProfile.registerSource,
      };
    }
    if (pickedFromRegister) {
      return {
        legalName: pickedFromRegister.legalName,
        address: pickedFromRegister.address,
        ico: pickedFromRegister.ico,
        dic: pickedFromRegister.dic,
        icDph: "",
        registerSource: pickedFromRegister.registerSource,
      };
    }
    return {
      legalName: "",
      address: "",
      ico: "",
      dic: "",
      icDph: "",
      registerSource: "",
    };
  });
  const [message, setMessage] = useState<string | null>(() => {
    if (savedFlash) {
      return "Profil firmy uložený.";
    }
    if (pickedFromRegister) {
      return country === "CZ"
        ? "Údaje z ARES doplnené. DIČ je zároveň IČ DPH."
        : "Údaje z registra doplnené. IČ DPH zadaj ručne.";
    }
    return null;
  });
  const [error, setError] = useState<string | null>(
    saveErrorFlash ?? registerLookupError,
  );
  const [searchPending, startSearch] = useTransition();
  const [lookupPending, setLookupPending] = useState(false);

  const isCzech = country === "CZ";

  async function runLookup(ico: string) {
    setError(null);
    setLookupPending(true);
    try {
      const result = await lookupRegisterAction(ico, country);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      applyLookup({
        legalName: result.data.lookup.legalName,
        address: result.data.lookup.address,
        ico: result.data.lookup.ico,
        dic: result.data.lookup.dic,
        registerSource: result.data.registerSource,
      });
    } finally {
      setLookupPending(false);
    }
  }

  function applyLookup(fields: {
    legalName: string;
    address: string;
    ico: string;
    dic: string;
    registerSource: string;
  }) {
    setDraft((prev) => ({
      ...prev,
      legalName: fields.legalName,
      address: fields.address,
      ico: fields.ico,
      dic: fields.dic,
      icDph: prev.icDph,
      registerSource: fields.registerSource,
    }));
    setError(null);
    setMessage(
      isCzech
        ? "Údaje z ARES doplnené. DIČ je zároveň IČ DPH."
        : "Údaje z registra doplnené. IČ DPH zadaj ručne.",
    );
  }

  function profilePickHref(ico: string): string {
    const params = new URLSearchParams({ ico, country });
    return `/companies/${companyId}/profile?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      {!initialProfile ? (
        <section className="rounded-lg border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-[15px]">Krajina klienta</h2>
            <p className="mt-1 text-[12.5px] text-ink-2">
              Určuje register na vyhľadanie a domácu menu firmy pri dokladoch.
            </p>
          </header>
          <div className="flex gap-4 p-4">
            {(["SK", "CZ"] as const).map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 text-[13px]"
              >
                <input
                  type="radio"
                  name="setup-country"
                  value={value}
                  checked={country === value}
                  data-testid={`profile-country-${value}`}
                  onChange={() => {
                    setCountry(value);
                    setHits([]);
                    setMessage(null);
                    setError(null);
                  }}
                />
                {countrySetupLabel(value)}
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {!initialProfile ? (
        <section className="rounded-lg border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-[15px]">{registerSearchHeading(country)}</h2>
            <p className="mt-1 text-[12.5px] text-ink-2">
              Názov priečinka v Drive sa zriedka rovná právnemu názvu — prehľadaj register podľa
              názvu priečinka alebo vlastného textu.
            </p>
          </header>
          <div className="flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-ink-2">Hľadaný názov</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                data-testid="profile-search-query"
                className="rounded border border-line bg-surface-2 px-3 py-2 text-[13px]"
              />
            </label>
            <button
              type="button"
              disabled={searchPending}
              data-testid="profile-search-submit"
              className="w-fit rounded bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
              onClick={() => {
                setError(null);
                startSearch(async () => {
                  const result = await searchRegisterAction(companyId, searchQuery, country);
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  setHits(result.data.hits);
                  if (result.data.hits.length === 0) {
                    setMessage("Register nevrátil žiadne zhody.");
                  } else {
                    setMessage(null);
                  }
                });
              }}
            >
              {searchPending ? "Hľadám…" : "Hľadať v registri"}
            </button>

            {hits.length > 0 ? (
              <ul className="flex flex-col gap-2" data-testid="profile-candidates">
                {hits.map((hit) => (
                  <li key={hit.ico}>
                    <Link
                      href={profilePickHref(hit.ico)}
                      data-testid={`profile-candidate-${hit.ico}`}
                      className="block w-full rounded border border-line bg-surface-2 px-3 py-2 text-left text-[13px] hover:border-accent"
                    >
                      <span className="font-semibold">{hit.legalName}</span>
                      <span className="mt-0.5 block font-mono text-[12px] text-ink-2">
                        IČO {hit.ico} · {registerStatusLabel(hit.status)}
                      </span>
                      {hit.address ? (
                        <span className="mt-0.5 block text-[12px] text-ink-3">{hit.address}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="border-t border-line pt-4">
              <label className="flex flex-col gap-1 text-[12.5px]">
                <span className="text-ink-2">Alebo zadaj IČO priamo</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={directIco}
                    onChange={(event) => setDirectIco(event.target.value)}
                    data-testid="profile-direct-ico"
                    className="flex-1 rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[13px]"
                  />
                  <button
                    type="button"
                    disabled={lookupPending}
                    data-testid="profile-direct-ico-submit"
                    className="rounded border border-line px-3 py-2 text-[13px] hover:bg-surface-2 disabled:opacity-50"
                    onClick={() => {
                      void runLookup(directIco);
                    }}
                  >
                    {lookupPending ? "Načítavam…" : registerDirectLookupLabel(country)}
                  </button>
                </div>
              </label>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-[15px]">
            {initialProfile ? "Upraviť profil firmy" : "Profil firmy"}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-2">
            {isCzech
              ? "Právny názov, adresa a DIČ pochádzajú z ARES. České DIČ je zároveň identifikátor pre DPH."
              : "Právny názov, adresa a DIČ pochádzajú z registra. IČ DPH sa nikdy nepredvyplní — zadaj ho podľa dokladov klienta."}
          </p>
        </header>
        <form action={saveFormAction} className="flex flex-col gap-3 p-4">
          <input type="hidden" name="country" value={country} />
          <input type="hidden" name="registerSource" value={draft.registerSource} />
          {initialProfile ? (
            <p className="text-[12.5px] text-ink-2" data-testid="profile-country-display">
              Krajina: {countrySetupLabel(country)}
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-ink-2">Právny názov</span>
            <input
              type="text"
              name="legalName"
              required
              value={draft.legalName}
              onChange={(event) => setDraft({ ...draft, legalName: event.target.value })}
              data-testid="profile-legal-name"
              className="rounded border border-line bg-surface-2 px-3 py-2 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-ink-2">Adresa</span>
            <input
              type="text"
              name="address"
              value={draft.address}
              onChange={(event) => setDraft({ ...draft, address: event.target.value })}
              data-testid="profile-address"
              className="rounded border border-line bg-surface-2 px-3 py-2 text-[13px]"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-ink-2">IČO</span>
              <input
                type="text"
                name="ico"
                inputMode="numeric"
                required
                value={draft.ico}
                onChange={(event) => setDraft({ ...draft, ico: event.target.value })}
                data-testid="profile-ico"
                className="rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-ink-2">{isCzech ? "DIČ (IČ DPH)" : "DIČ"}</span>
              <input
                type="text"
                name="dic"
                inputMode={isCzech ? "text" : "numeric"}
                required={!isCzech}
                value={draft.dic}
                onChange={(event) => setDraft({ ...draft, dic: event.target.value })}
                data-testid="profile-dic"
                className="rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[13px] uppercase"
              />
            </label>
          </div>
          {!isCzech ? (
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-ink-2">IČ DPH</span>
              <input
                type="text"
                name="icDph"
                required
                value={draft.icDph}
                onChange={(event) => setDraft({ ...draft, icDph: event.target.value })}
                data-testid="profile-ic-dph"
                placeholder="SK1234567890"
                className="rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[13px] uppercase"
              />
            </label>
          ) : (
            <input type="hidden" name="icDph" value="" />
          )}
          {error ? (
            <p className="text-[13px] text-bad" data-testid="profile-error">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="text-[13px] text-good" data-testid="profile-message">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            data-testid="profile-save"
            className="w-fit rounded bg-good px-4 py-2 text-[13px] font-medium text-white"
          >
            Uložiť profil
          </button>
        </form>
      </section>
    </div>
  );
}
