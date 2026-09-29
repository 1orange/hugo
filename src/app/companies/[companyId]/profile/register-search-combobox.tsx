"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CompanyCountry, RegisterSearchHit } from "@/modules/company-profile";
import { registerStatusLabel } from "@/modules/company-profile";
import { countWithNoun } from "@/modules/format-sk";

type SearchResponse =
  | { ok: true; hits: RegisterSearchHit[]; total: number }
  | { ok: false; message: string };

type SearchState = {
  loading: boolean;
  /** The last answer, kept on screen while a narrower query is asked. */
  results: { hits: RegisterSearchHit[]; total: number } | null;
  error: string | null;
};

/** Typing pauses this long before the register is asked; RPO answers in seconds, not milliseconds. */
const DEBOUNCE_MS = 450;
const MIN_QUERY_LENGTH = 2;

function registerName(country: CompanyCountry): string {
  return country === "CZ" ? "ARES" : "RPO";
}

/**
 * The register searched as she types, candidates in a list under the field.
 * Folder names rarely match legal names — "spring" is SPRING.etc., spol. s r. o.
 * — so the folder name is searched as soon as the page opens, and every
 * change after that narrows it.
 */
export function RegisterSearchCombobox({
  companyId,
  country,
  initialQuery,
  searchOnMount,
  onPick,
}: {
  companyId: number;
  country: CompanyCountry;
  initialQuery: string;
  /** False when a candidate was already picked (the page opened with ?ico=). */
  searchOnMount: boolean;
  onPick: (hit: RegisterSearchHit) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<SearchState>({ loading: false, results: null, error: null });
  const [open, setOpen] = useState(searchOnMount);
  const [active, setActive] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  const hits = state.results?.hits ?? [];

  function search(text: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    abortRef.current?.abort();
    if (text.trim().length < MIN_QUERY_LENGTH) {
      setState({ loading: false, results: null, error: null });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    const params = new URLSearchParams({ q: text, country });
    fetch(`/api/companies/${companyId}/register-search?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = (await response.json()) as SearchResponse;
        if (controller.signal.aborted) {
          return;
        }
        setActive(-1);
        setState(
          body.ok
            ? { loading: false, results: { hits: body.hits, total: body.total }, error: null }
            : { loading: false, results: null, error: body.message },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        setState({ loading: false, results: null, error: `Hľadanie zlyhalo (${detail}).` });
      });
  }

  function searchSoon(text: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => search(text), DEBOUNCE_MS);
  }

  // The folder name on arrival, and the query again whenever the country
  // changes the register. A ref, not a mount flag: StrictMode runs effects twice.
  const searchedCountry = useRef<CompanyCountry | null>(searchOnMount ? null : country);
  useEffect(() => {
    if (searchedCountry.current !== country) {
      searchedCountry.current = country;
      search(query);
    }
    // Only the register changes what the same query finds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  function pick(hit: RegisterSearchHit) {
    setQuery(hit.legalName);
    setOpen(false);
    setActive(-1);
    onPick(hit);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && hits[active]) {
        pick(hits[active]);
      } else {
        setOpen(true);
        search(query);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && hits.length > 0;
  const activeId = hits[active] ? `${listId}-${hits[active].ico}` : undefined;
  const total = state.results?.total ?? 0;

  return (
    <div>
      <label className="text-[12.5px] text-ink-2" htmlFor={`${listId}-input`}>
        Názov firmy
      </label>
      <div className="relative mt-1">
        <input
          id={`${listId}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          autoFocus={searchOnMount}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={query}
          placeholder="napr. spring.etc"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            searchSoon(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          data-testid="profile-search-query"
          className="w-full rounded border border-line bg-surface-2 py-2 pl-3 pr-9 text-[13px] focus:border-accent focus:outline-none"
        />
        {state.loading ? (
          <span
            aria-hidden
            className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-line-2 border-t-accent"
          />
        ) : null}
        {showList ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={`Zhody v ${registerName(country)}`}
            aria-busy={state.loading}
            data-testid="profile-candidates"
            className={`absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-line-2 bg-surface py-1 shadow-lg ${
              state.loading ? "opacity-60" : ""
            }`}
          >
            {hits.map((hit, index) => (
              <li
                key={hit.ico}
                id={`${listId}-${hit.ico}`}
                role="option"
                aria-selected={index === active}
                data-testid={`profile-candidate-${hit.ico}`}
                // Keeps focus in the field, so the blur does not close the list before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(hit)}
                className={`cursor-pointer px-3 py-2 text-[13px] ${index === active ? "bg-accent-soft" : ""}`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    className={`truncate ${hit.status === "dissolved" ? "text-ink-3" : "font-semibold text-ink"}`}
                  >
                    {hit.legalName}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] text-ink-2">{hit.ico}</span>
                </span>
                <span className="mt-0.5 flex gap-2 text-[11.5px] text-ink-3">
                  {hit.status === "dissolved" ? (
                    <span className="shrink-0 text-bad">{registerStatusLabel(hit.status)}</span>
                  ) : null}
                  {hit.address ? <span className="truncate">{hit.address}</span> : null}
                </span>
              </li>
            ))}
            {total > hits.length ? (
              <li role="presentation" className="border-t border-line px-3 py-1.5 text-[11.5px] text-ink-3">
                {hits.length} z {total} — spresni názov
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <p className="mt-1.5 min-h-[18px] text-[12px] text-ink-3" aria-live="polite">
        {state.error ? (
          <span className="text-bad" data-testid="profile-search-error">
            {state.error}
          </span>
        ) : state.loading ? (
          `Hľadám v ${registerName(country)}…`
        ) : state.results && total === 0 ? (
          "Žiadna zhoda. Skús iný tvar názvu — s bodkou, bez právnej formy — alebo zadaj IČO nižšie."
        ) : state.results && !showList ? (
          `${countWithNoun(total, ["zhoda", "zhody", "zhôd"])} v ${registerName(country)}`
        ) : null}
      </p>
    </div>
  );
}
