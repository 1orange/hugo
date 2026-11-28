/**
 * *Novinky*: what changed in Hugo, for the office, in Slovak. The developers'
 * CHANGELOG.md says the same in their terms; keep both in step when a pull
 * request changes what the accountants see.
 *
 * Newest first. The `id` is the release's date; a note added the same day as
 * another gets a suffix (`2026-11-24b`). The app bar shows a dot until the
 * newest id has been seen in this browser.
 */

export type ReleaseNote = {
  /** Unique, sortable: the date, with a suffix for a second note that day. */
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  title: string;
  items: ReadonlyArray<{ title: string; text: string }>;
};

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    id: "2026-11-24",
    date: "2026-11-24",
    title: "Doklady hneď po nahratí, firmy podľa zdieľania v Drive",
    items: [
      {
        title: "Doklady sa čítajú hneď po nahratí",
        text:
          "Keď klient nahrá doklad na Drive, Hugo sa to dozvie do minúty a doklad prečíta bez toho, aby ste mesiac " +
          "otvárali. Číta všetky neuzavreté mesiace roka, najprv ten, ktorý máte otvorený, potom minulý a tento mesiac. " +
          "Prvé načítanie celého roka trvá asi deň, potom už len nové doklady. Na obrazovke Fronta vidíte, čo ešte " +
          "čaká, a odhad, kedy bude hotovo.",
      },
      {
        title: "Firmy podľa zdieľania v Google Drive",
        text:
          "Každý vidí len firmy, ktorých priečinok má nazdieľaný v Google Drive na e-mail, ktorým sa prihlasuje do " +
          "Huga. Zoznam „Moje firmy“ sme zrušili. Kto čo vidí, nájdete v Nastaveniach v časti Prístup z Drive.",
      },
      {
        title: "Firmy sa otvárajú na minulom mesiaci",
        text: "Počas novembra sa zoznam firiem otvorí na októbri. Iný mesiac alebo Otvorené mesiace vyberiete hore.",
      },
      {
        title: "Bankové výpisy v zozname dokladov",
        text:
          "Výpisy sú v mesiaci v samostatnej skupine, s náhľadom PDF aj XML. Zatiaľ sa nečítajú ani neexportujú, " +
          "môžete ich označiť ako skontrolované.",
      },
      {
        title: "Číslo dokladu KV DPH a variabilný symbol",
        text:
          "Pole sa volá „Číslo dokladu KV DPH“. Prázdny variabilný symbol sa doplní z čísla dokladu bez " +
          "písmen a znakov (SK-26001 → 26001); prepísať ho môžete.",
      },
      {
        title: "Prevziať z profilu",
        text:
          "Keď sa údaje klienta na doklade nezhodujú s jeho profilom, tlačidlo „Prevziať z profilu“ ich jedným " +
          "kliknutím prepíše na názov, IČO, DIČ a IČ DPH z profilu.",
      },
      {
        title: "Chýba mesačná štruktúra",
        text:
          "Klient, ktorý v Drive nemá priečinky mesiacov (2026_01 …) priamo vo svojom priečinku, je označený v " +
          "Štruktúre. Hugo z neho nečíta, kým priečinky nepreusporiadate.",
      },
      {
        title: "Neskoro nahrané doklady",
        text:
          "Doklad, ktorý klient nahrá do staršieho mesiaca, keď sa už spracúva ďalší, Hugo navrhne presunúť do " +
          "spracúvaného mesiaca. Presun potvrdíte a môžete ho vrátiť.",
      },
      {
        title: "Opravy",
        text:
          "Naskenované PDF sa znova čítajú celé a bločky eKasa uložené v Ostatných dokumentoch sa prečítajú ako " +
          "bločky. Priečinky so starým číslom 04, 05 alebo 06 a neznámym názvom Hugo neodhaduje, ukáže ich na " +
          "premenovanie.",
      },
    ],
  },
];

/** The newest note's id; null when there are none. */
export function latestReleaseNoteId(notes: readonly ReleaseNote[] = RELEASE_NOTES): string | null {
  return notes.reduce<string | null>((latest, note) => (latest === null || note.id > latest ? note.id : latest), null);
}

/** Whether there is a note newer than the one last seen (none seen: any note is new). */
export function hasUnreadReleaseNotes(lastSeenId: string | null, notes: readonly ReleaseNote[] = RELEASE_NOTES): boolean {
  const latest = latestReleaseNoteId(notes);
  return latest !== null && (lastSeenId === null || latest > lastSeenId);
}

const SEEN_KEY_PREFIX = "hugo.novinky.seen.v1.";

/** Where this browser keeps the last note seen, per signed-in email. */
export function releaseNotesSeenKey(email: string): string {
  return `${SEEN_KEY_PREFIX}${email.trim().toLowerCase()}`;
}
