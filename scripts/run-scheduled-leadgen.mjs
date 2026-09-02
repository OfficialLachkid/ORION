#!/usr/bin/env node
// Runs the daily automated lead-generation sweep: ALL niches, one city per
// day, city advancing daily. Installed via scripts/install-leadgen-schedule.mjs
// as a daily 07:00 launchd job.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { runLeadgenSearch } from '../services/leadgen-scraper/src/worker.mjs';
import { countLeads } from './lib/leadgen-supabase.mjs';
import {
  beginLeadgenProgress,
  postLeadgenQueued,
  postSweepOverview,
  reportLeadgenRunToDiscord,
  updateSweepOverview,
} from '../services/leadgen-scraper/src/discord-report.mjs';

const ROTATION_STATE_PATH = resolve(projectRoot, 'data', 'leadgen', 'rotation-state.json');
// DuckDuckGo returns ~30-40 results per query in practice, so 50 is
// effectively "everything the search engine will give us".
export const MAX_RESULTS_PER_NICHE = 50;
// Match the installer's DEFAULT_TIMES so callers that skip --times get
// the same 6 rounds the scheduled launchd job requests. Bumped 2026-09-02
// as part of the CBS-BAG expansion — see install-leadgen-schedule.mjs for
// the rationale (qualifier under-fed at 2×/day, expanded pool absorbs
// the higher rate without saturating).
export const DEFAULT_SCHEDULED_SWEEP_ROUNDS = 6;
const MAX_SCHEDULED_SWEEP_ROUNDS = 10;

// Dutch search terms — this targets the Dutch market, so the query itself is
// in Dutch to get relevant local results (matches the "loodgieter Rotterdam"
// test that worked well during development).
export const NICHE_ROTATION = [
  { key: 'electricians', term: 'elektriciens' },
  { key: 'plumbing', term: 'loodgieters' },
  { key: 'real_estate', term: 'makelaars' },
  { key: 'recruitment_agencies', term: 'recruitmentbureaus' },
  { key: 'clinics', term: 'klinieken' },
  { key: 'liquor_stores', term: 'slijterijen' },
];

// One fixed national query saturates fast — a 50-candidate re-run of
// "loodgieters Nederland" produced exactly 1 new (junk) lead once the
// known-domain skip was active. City-level queries surface local
// businesses the national query never ranks. Positions 0-21 are the
// original 22 major cities + provincial capitals, preserved in their
// original order — operator wants to return to them on future cycles
// ("those are big"). Positions 22+ are the smaller-town expansion pool
// from issue #3 (2026-08-10), roughly the "next tier" of towns per
// province. See [[05_Playbooks/Leadgen_Location_Expansion]] for the
// tiered design + rationale.
//
// Full rotation of the expanded list = ~560 days per niche at 1 run/day.
// Cross-province namesake towns (Elst UT/GLD, Bergen NH/LB, Valkenburg
// ZH/LB) are disambiguated with a "(Province)" suffix — search engines
// treat parentheses as location modifier.
export const LOCATION_ROTATION = [
  // === Positions 0-21: originals (preserved order) ===
  'Amsterdam',
  'Rotterdam',
  'Den Haag',
  'Utrecht',
  'Eindhoven',
  'Groningen',
  'Tilburg',
  'Almere',
  'Breda',
  'Nijmegen',
  'Arnhem',
  'Haarlem',
  'Amersfoort',
  'Apeldoorn',
  "'s-Hertogenbosch",
  'Zwolle',
  'Leiden',
  'Maastricht',
  'Leeuwarden',
  'Assen',
  'Middelburg',
  'Lelystad',
  // === Positions 22+: expansion pool (issue #3) ===
  // Noord-Holland
  'Alkmaar', 'Hoorn', 'Den Helder', 'Zaandam', 'Purmerend', 'Hilversum',
  'Amstelveen', 'Heerhugowaard', 'Castricum', 'Heemskerk', 'Beverwijk',
  'Uitgeest', 'Heiloo', 'Limmen', 'Akersloot', 'Egmond aan Zee',
  'Egmond aan den Hoef', 'Bergen (Noord-Holland)', 'Schoorl',
  'Broek op Langedijk', 'Zuid-Scharwoude', 'Noord-Scharwoude', 'Obdam',
  'Spanbroek', 'Opmeer', 'Medemblik', 'Enkhuizen', 'Bovenkarspel',
  'Grootebroek', 'Andijk', 'Wervershoof', 'Zwaag', 'Blokker', 'Avenhorn',
  'De Goorn', 'Volendam', 'Edam', 'Monnickendam', 'Landsmeer', 'Oostzaan',
  'Wormerveer', 'Krommenie', 'Assendelft', 'Koog aan de Zaan', 'Zaandijk',
  'IJmuiden', 'Santpoort-Noord', 'Velserbroek', 'Bloemendaal', 'Overveen',
  'Zandvoort', 'Heemstede', 'Bennebroek', 'Hoofddorp', 'Nieuw-Vennep',
  'Badhoevedorp', 'Aalsmeer', 'Uithoorn', 'Ouderkerk aan de Amstel',
  'Diemen', 'Weesp', 'Muiden', 'Bussum', 'Naarden', 'Huizen', 'Laren',
  'Blaricum', 'Loosdrecht', 'Kortenhoef', "'s-Graveland", 'Den Burg',
  'Julianadorp', 'Anna Paulowna', 'Schagen', 'Warmenhuizen',
  // Zuid-Holland
  'Delft', 'Dordrecht', 'Gouda', 'Zoetermeer', 'Alphen aan den Rijn',
  'Schiedam', 'Vlaardingen', 'Maassluis', 'Spijkenisse', 'Hellevoetsluis',
  'Brielle', 'Rockanje', 'Oostvoorne', 'Barendrecht', 'Ridderkerk',
  'Hendrik-Ido-Ambacht', 'Zwijndrecht', 'Papendrecht', 'Sliedrecht',
  'Hardinxveld-Giessendam', 'Alblasserdam', 'Capelle aan den IJssel',
  'Krimpen aan den IJssel', 'Nieuwerkerk aan den IJssel', 'Waddinxveen',
  'Boskoop', 'Bodegraven', 'Reeuwijk', 'Schoonhoven', 'Bergambacht',
  'Lekkerkerk', 'Stolwijk', 'Haastrecht', 'Leidschendam', 'Voorburg',
  'Rijswijk', 'Wassenaar', 'Voorschoten', 'Oegstgeest', 'Leiderdorp',
  'Katwijk', 'Rijnsburg', 'Valkenburg (Zuid-Holland)', 'Noordwijk',
  'Noordwijkerhout', 'Lisse', 'Hillegom', 'Sassenheim', 'Voorhout',
  'Warmond', 'Roelofarendsveen', 'Ter Aar', 'Nieuwkoop', 'Pijnacker',
  'Nootdorp', 'Berkel en Rodenrijs', 'Bergschenhoek', 'Bleiswijk',
  'Naaldwijk', 'Monster', "'s-Gravenzande", 'Wateringen', 'De Lier',
  'Maasdijk', 'Hoek van Holland', 'Gorinchem', 'Leerdam', 'Arkel',
  'Meerkerk', 'Giessenburg', 'Oud-Beijerland', 'Numansdorp', 'Strijen',
  "'s-Gravendeel", 'Middelharnis', 'Sommelsdijk', 'Dirksland', 'Ouddorp',
  'Stellendam',
  // Utrecht
  'Nieuwegein', 'Houten', 'Zeist', 'Veenendaal', 'Woerden', 'IJsselstein',
  'Maarssen', 'De Bilt', 'Bilthoven', 'Bunnik', 'Odijk',
  'Driebergen-Rijsenburg', 'Doorn', 'Leersum', 'Amerongen',
  'Wijk bij Duurstede', 'Cothen', 'Langbroek', 'Baarn', 'Soest',
  'Soesterberg', 'Bunschoten-Spakenburg', 'Leusden', 'Woudenberg',
  'Renswoude', 'Rhenen', 'Elst (Utrecht)', 'Montfoort', 'Oudewater',
  'Lopik', 'Vianen', 'Breukelen', 'Loenen aan de Vecht', 'Vinkeveen',
  'Mijdrecht', 'Wilnis', 'Abcoude', 'Harmelen', 'Linschoten',
  // Noord-Brabant
  'Helmond', 'Oss', 'Roosendaal', 'Bergen op Zoom', 'Waalwijk',
  'Oosterhout', 'Etten-Leur', 'Veldhoven', 'Best', 'Son en Breugel',
  'Geldrop', 'Mierlo', 'Nuenen', 'Valkenswaard', 'Waalre', 'Eersel',
  'Bladel', 'Reusel', 'Bergeijk', 'Hapert', 'Oirschot', 'Boxtel', 'Vught',
  'Sint-Michielsgestel', 'Rosmalen', 'Drunen', 'Vlijmen', 'Heusden',
  'Kaatsheuvel', 'Loon op Zand', 'Dongen', 'Rijen', 'Gilze', 'Goirle',
  'Hilvarenbeek', 'Oisterwijk', 'Moergestel', 'Uden', 'Veghel',
  'Schijndel', 'Sint-Oedenrode', 'Boekel', 'Gemert', 'Bakel', 'Deurne',
  'Asten', 'Someren', 'Laarbeek', 'Beek en Donk', 'Lieshout', 'Boxmeer',
  'Cuijk', 'Grave', 'Mill', 'Wanroij', 'Sint Anthonis', 'Zevenbergen',
  'Klundert', 'Made', 'Drimmelen', 'Raamsdonksveer', 'Geertruidenberg',
  'Werkendam', 'Woudrichem', 'Sleeuwijk', 'Dussen', 'Zundert', 'Rucphen',
  'Sprundel', 'Hoeven', 'Oudenbosch', 'Steenbergen', 'Halsteren',
  'Woensdrecht', 'Hoogerheide',
  // Gelderland
  'Ede', 'Doetinchem', 'Harderwijk', 'Tiel', 'Zutphen', 'Wageningen',
  'Barneveld', 'Nijkerk', 'Putten', 'Ermelo', 'Elburg', 'Nunspeet', 'Epe',
  'Vaassen', 'Heerde', 'Hattem', 'Lochem', 'Borculo', 'Ruurlo', 'Eibergen',
  'Neede', 'Winterswijk', 'Aalten', 'Dinxperlo', 'Lichtenvoorde',
  'Groenlo', 'Varsseveld', 'Terborg', 'Ulft', 'Zevenaar', 'Duiven',
  'Westervoort', 'Didam', "'s-Heerenberg", 'Velp', 'Rheden', 'Dieren',
  'Oosterbeek', 'Doorwerth', 'Elst (Gelderland)', 'Bemmel', 'Huissen',
  'Gendt', 'Wijchen', 'Beuningen', 'Druten', 'Groesbeek', 'Malden',
  'Beneden-Leeuwen', 'Zaltbommel', 'Geldermalsen', 'Culemborg', 'Beesd',
  'Buren', 'Maurik', 'Lienden', 'Kesteren', 'Opheusden', 'Renkum',
  'Lunteren', 'Bennekom', 'Voorthuizen', 'Garderen', 'Twello',
  // Overijssel
  'Enschede', 'Deventer', 'Hengelo', 'Almelo', 'Kampen', 'Hardenberg',
  'Oldenzaal', 'Rijssen', 'Holten', 'Nijverdal', 'Hellendoorn', 'Raalte',
  'Dalfsen', 'Ommen', 'Dedemsvaart', 'Gramsbergen', 'Steenwijk',
  'Genemuiden', 'Hasselt', 'Zwartsluis', 'Vollenhove', 'Giethoorn',
  'Staphorst', 'Nieuwleusen', 'Wierden', 'Enter', 'Goor', 'Delden',
  'Borne', 'Haaksbergen', 'Losser', 'Denekamp', 'Ootmarsum', 'Tubbergen',
  'Vriezenveen',
  // Limburg
  'Venlo', 'Roermond', 'Heerlen', 'Sittard', 'Geleen', 'Weert', 'Kerkrade',
  'Brunssum', 'Landgraaf', 'Valkenburg (Limburg)', 'Meerssen', 'Bunde',
  'Stein', 'Beek', 'Elsloo', 'Echt', 'Susteren', 'Born', 'Limbricht',
  'Maasbracht', 'Linne', 'Swalmen', 'Reuver', 'Beesel', 'Tegelen',
  'Belfeld', 'Horst', 'Sevenum', 'Panningen', 'Helden', 'Baarlo', 'Kessel',
  'Venray', 'Gennep', 'Bergen (Limburg)', 'Well', 'Arcen', 'Grubbenvorst',
  'Nederweert', 'Heythuysen', 'Roggel', 'Haelen', 'Thorn', 'Heel',
  'Gulpen', 'Wittem', 'Eijsden', 'Margraten', 'Simpelveld', 'Vaals',
  // Zeeland
  'Vlissingen', 'Goes', 'Terneuzen', 'Hulst', 'Zierikzee', 'Sluis',
  'Oostburg', 'Breskens', 'Cadzand', 'Aardenburg', 'Axel', 'Sas van Gent',
  'Philippine', 'Kapelle', 'Yerseke', 'Kruiningen', 'Wemeldinge',
  'Heinkenszand', "'s-Gravenpolder", 'Kloetinge', 'Arnemuiden', 'Veere',
  'Domburg', 'Westkapelle', 'Zoutelande', 'Oostkapelle', 'Vrouwenpolder',
  'Renesse', 'Burgh-Haamstede', 'Brouwershaven', 'Bruinisse', 'Tholen',
  'Sint-Maartensdijk', 'Sint-Annaland', 'Poortvliet',
  // Flevoland
  'Dronten', 'Emmeloord', 'Zeewolde', 'Urk', 'Biddinghuizen', 'Swifterbant',
  'Ens', 'Marknesse', 'Nagele', 'Creil', 'Rutten', 'Bant', 'Espel',
  'Tollebeek', 'Luttelgeest',
  // Friesland
  'Drachten', 'Heerenveen', 'Sneek', 'Harlingen', 'Franeker', 'Joure',
  'Lemmer', 'Bolsward', 'Dokkum', 'Workum', 'Hindeloopen', 'Stavoren',
  'Makkum', 'Grou', 'Akkrum', 'Wolvega', 'Oosterwolde', 'Appelscha',
  'Surhuisterveen', 'Burgum', 'Buitenpost', 'Kollum', 'Gorredijk',
  'Beetsterzwaag', 'Bakkeveen', 'Hallum', 'Stiens', 'Sint Annaparochie',
  'West-Terschelling', 'Nes', 'Hollum',
  // Groningen
  'Delfzijl', 'Appingedam', 'Winschoten', 'Veendam', 'Stadskanaal',
  'Hoogezand', 'Sappemeer', 'Haren', 'Zuidhorn', 'Leek', 'Marum', 'Bedum',
  'Winsum', 'Uithuizen', 'Uithuizermeeden', 'Loppersum', 'Ten Boer',
  'Scheemda', 'Oude Pekela', 'Nieuwe Pekela', 'Ter Apel', 'Musselkanaal',
  // Drenthe
  'Emmen', 'Hoogeveen', 'Meppel', 'Coevorden', 'Roden', 'Eelde',
  'Paterswolde', 'Zuidlaren', 'Gieten', 'Borger', 'Exloo', 'Klazienaveen',
  'Erica', 'Nieuw-Amsterdam', 'Schoonebeek', 'Beilen', 'Westerbork',
  'Dwingeloo', 'Diever', 'Havelte', 'Ruinen', 'Zuidwolde', 'De Wijk',
  'Norg', 'Vries', 'Peize',
  // === Positions 568+: CBS BAG expansion (issue #3 Tier 4, 2026-09-02) ===
  // 273 net-new woonplaatsen not in the operator's curated 568 above.
  // Derived from data/leadgen/nl-woonplaatsen.json (PDOK BAG, filtered
  // for is_active=true: municipality capitals + small-gemeente
  // members + curated set). Alphabetized within this section. Same-name
  // rows across provinces are disambiguated with "(Provincie)". See
  // scripts/leadgen/fetch-nl-woonplaatsen.mjs for the fetch/filter policy
  // and [[05_Playbooks/Leadgen_Location_Expansion]] Tier 4 for context.
  "'s Gravenmoer",
  "'t Goy",
  "'t Harde",
  'Aadorp',
  'Aarle-Rixtel',
  'Aartswoud',
  'Achterveld',
  'Achtmaal',
  'Aerdenhout',
  'Afferden',
  'Afferden L',
  'Amsterdam-Duivendrecht',
  'Austerlitz',
  'Baarle-Nassau',
  'Ballum',
  'Baneheide',
  'Bavel',
  'Benschop',
  'Bentveld',
  'Berg en Dal',
  'Berg en Terblijt',
  'Bergen (NH)',
  'Bergen L',
  'Berkel-Enschot',
  'Berlicum',
  'Beuningen Gld',
  'Biest-Houtakker',
  'Biezenmortel',
  'Bocholtz',
  'Borgercompagnie',
  'Bornerbroek',
  'Bosch en Duin',
  'Bosschenhoofd',
  'Bredevoort',
  'Broekhuizen',
  'Brummen',
  'Castelre',
  'Casteren',
  'Cortelande',
  'Cromvoirt',
  'Daarle',
  'Daarlerveen',
  'Dalem',
  'De Heen',
  'De Heurne',
  'De Kwakel',
  'De Meern',
  'De Moer',
  'De Schiphorst',
  'De Weere',
  'De Zilk',
  'Deest',
  'Delfgauw',
  'Den Dolder',
  'Den Dungen',
  'Den Hoorn',
  'Den Hout',
  'Den Ilp',
  'Deurningen',
  'Diessen',
  'Dinteloord',
  'Doesburg',
  'Doornspijk',
  'Dorst',
  'Driebruggen',
  'Duivendrecht',
  'Eemdijk',
  'Eemnes',
  'Elspeet',
  'Elst Ut',
  'Emst',
  'Erp',
  'Esbeek',
  'Esch',
  'Ewijk',
  'Eygelshoven',
  'Gaanderen',
  'Gelderswoude',
  'Gemonde',
  'Geulle',
  'Glane',
  'Groessen',
  'Haaren',
  'Haarle',
  'Haarzuilens',
  'Haghorst',
  'Heerjansdam',
  'Heeze',
  'Heijen',
  'Hekendorp',
  'Helenaveen',
  'Helvoirt',
  'Herten',
  'Hertme',
  'Heukelom',
  'Heumen',
  'Hierden',
  'Hoensbroek',
  'Hoevelaken',
  'Hoge Hexel',
  'Hooge Mierde',
  'Hoogeloon',
  'Hoogland',
  'Hooglanderveen',
  'Hoogwoud',
  'Horssen',
  'Huijbergen',
  'Huis ter Heide',
  'Huisduinen',
  'Hulsel',
  'Hulshorst',
  'Hulten',
  'IJhorst',
  'Jaarsveld',
  'Jisp',
  'Kamerik',
  'Kapel Avezaath',
  'Kerk Avezaath',
  'Klein Zundert',
  'Klimmen',
  'Kruisland',
  'Kudelstaart',
  'Lage Mierde',
  'Lage Vuursche',
  'Leende',
  'Lemelerveld',
  'Lemiers',
  'Lent',
  'Lepelstraat',
  'Leveroy',
  'Liempde',
  'Lierop',
  'Liessel',
  'Loo Gld',
  'Lopikerkapel',
  'Lutjebroek',
  'Luyksgestel',
  'Maasland',
  'Maastricht-Airport',
  'Mariahout',
  'Marle',
  'Mastenbroek',
  'Middelaar',
  'Middenbeemster',
  'Midlum',
  'Milsbeek',
  'Moerdijk',
  'Moerkapelle',
  'Molenhoek',
  'Molenschot',
  'Mook',
  'Moordrecht',
  'Moorveld',
  'Muiderberg',
  'Nederasselt',
  'Nederweert-Eind',
  'Neerkant',
  'Netersel',
  'Nieuw- en Sint Joosland',
  'Nieuw-Vossemeer',
  'Nieuwerbrug aan den Rijn',
  'Nijeveen',
  'Nijkerkerveen',
  'Noordbeemster',
  'Notter',
  'Nuland',
  'Oene',
  'Oldebroek',
  'Olst',
  'Ommel',
  'Oost West en Middelbeers',
  'Oost-Souburg',
  'Oosteind',
  'Oostknollendam',
  'Ospel',
  'Ossendrecht',
  'Ottersum',
  'Oud Gastel',
  'Overasselt',
  'Overdinkel',
  'Papekop',
  'Plasmolen',
  'Polsbroek',
  'Poortugaal',
  'Prinsenbeek',
  'Puiflijk',
  'Punthorst',
  'Purmerland',
  'Putte',
  'Raamsdonk',
  'Ransdaal',
  'Rhoon',
  'Riel',
  'Riethoven',
  'Rijsbergen',
  'Ritthem',
  'Rogat',
  'Rotterdam-Albrandswaard',
  'Rouveen',
  'Rozendaal',
  'Schalkwijk',
  'Scherpenzeel',
  'Schiermonnikoog',
  'Schijf',
  'Schin op Geul',
  'Schipluiden',
  'Schore',
  'Siebengewald',
  'Snelrewaard',
  'Spaarndam gem. Haarlem',
  'Spaubeek',
  'Spijkerboor',
  'Sprang-Capelle',
  'St. Willebrord',
  'Stampersgat',
  'Sterksel',
  'Stoutenburg',
  'Stoutenburg Noord',
  'Stramproy',
  'Teteringen',
  "Tull en 't Waal",
  'Tynaarlo',
  'Udenhout',
  'Ulestraten',
  'Ulicoten',
  'Ulvenhout',
  'Urmond',
  'Veessen',
  'Ven-Zelderheide',
  'Venhorst',
  'Vierhouten',
  'Vijlen',
  'Vinkel',
  'Vleuten',
  'Vlieland',
  'Vlierden',
  'Voerendaal',
  'Vogelenzang',
  'Voorst',
  'Vorchten',
  'Waarder',
  'Wadenoijen',
  'Walem',
  'Wapenveld',
  'Warnsveld',
  'Waspik',
  'Wehl',
  'Well L',
  'Wellerlooi',
  'Welsum',
  'Werkhoven',
  'Wernhout',
  'Wesepe',
  'Westbeemster',
  'Westerhoven',
  'Weurt',
  'Wijdewormer',
  'Wijhe',
  'Wijk aan Zee',
  'Wijnaldum',
  'Wildervank',
  'Winssen',
  'Wormer',
  'Zegge',
  'Zegveld',
  'Zenderen',
  'Zennewijnen',
  'Zevenhuizen',
  'Zoeterwoude',
  'Zuidoostbeemster',
  'Zuna',
  'de Lutte',
  'de Woude',
];

// Marker of the LOCATION_ROTATION pool version currently baked into the
// code. Bump this whenever LOCATION_ROTATION is expanded so migrations
// can detect "the pool got bigger since I last ran" and jump each
// niche's cursor to the first new location — otherwise the newly-added
// locations wouldn't be hit for months (would have to wait for the
// cursor to naturally cycle through everything ahead of them).
//   1 = original 22 major cities
//   2 = Tier 1 expansion to 568 (PR #40, 2026-08-10)
//   3 = CBS BAG expansion to 841 (Tier 4, 2026-09-02, this file)
export const CURRENT_POOL_EXPANSION_VERSION = 3;
// Cumulative pool sizes at each version — used by the migration to
// figure out where the "new territory" starts for each expansion.
// Index into POOL_BOUNDARIES equals the pool version.
const POOL_BOUNDARIES = { 1: 22, 2: 568, 3: 841 };

function loadRotationState() {
  if (!existsSync(ROTATION_STATE_PATH)) {
    return { cityIndexByNiche: {}, poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION };
  }

  try {
    const state = JSON.parse(readFileSync(ROTATION_STATE_PATH, 'utf8'));
    // Migrate from the old single-shared-counter shape: every niche was in
    // lockstep through the same city, so seed each niche at that same
    // index — only future runs can diverge.
    let baseState = state.cityIndexByNiche
      ? state
      : Number.isInteger(state.dayCount)
        ? {
          cityIndexByNiche: Object.fromEntries(
            NICHE_ROTATION.map((niche) => [niche.key, state.dayCount]),
          ),
        }
        : { cityIndexByNiche: {} };

    // Pool-expansion migration: if this state predates the current
    // expansion, jump each niche's cursor to just BEFORE the first
    // new location so the next peek returns index (previousPoolSize).
    // Otherwise the operator would wait months for the cursor to cycle
    // through hundreds of old locations before ever seeing anything
    // added in this expansion.
    const previousVersion = Number(baseState.poolExpansionVersion) || 1;
    if (previousVersion < CURRENT_POOL_EXPANSION_VERSION) {
      const jumpToIndex = POOL_BOUNDARIES[previousVersion] - 1;
      const migratedCityIndexByNiche = Object.fromEntries(
        NICHE_ROTATION.map((niche) => [niche.key, jumpToIndex]),
      );
      baseState = {
        ...baseState,
        cityIndexByNiche: migratedCityIndexByNiche,
        poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION,
        migratedFromVersion: previousVersion,
        migratedAt: new Date().toISOString(),
      };
    } else {
      baseState = { ...baseState, poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION };
    }
    return baseState;
  } catch {
    return { cityIndexByNiche: {}, poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION };
  }
}

function saveRotationState(state) {
  mkdirSync(dirname(ROTATION_STATE_PATH), { recursive: true });
  writeFileSync(ROTATION_STATE_PATH, JSON.stringify(state, null, 2));
}

// Each niche tracks its OWN city index and advances independently —
// previously one shared counter drove all six niches together, so if 5
// niches succeeded and 1 failed, the failed niche's city silently
// advanced anyway just because the sweep "succeeded overall" (operator
// caught this: "shouldn't we update it per success leadgen per niche?").
// peek/commit split for the same reason as before: never persist an
// advance before the work is confirmed done.
function peekNicheCity(state, nicheKey) {
  const current = Number.isInteger(state.cityIndexByNiche?.[nicheKey])
    ? state.cityIndexByNiche[nicheKey]
    : -1;
  const cityIndex = current + 1;
  return {
    cityIndex,
    location: LOCATION_ROTATION[cityIndex % LOCATION_ROTATION.length],
    // Where THIS niche will search next time (after this run commits) — shown
    // in the sweep overview so the operator knows the upcoming destination.
    nextLocation: LOCATION_ROTATION[(cityIndex + 1) % LOCATION_ROTATION.length],
  };
}

function commitNicheAdvance(state, nicheKey, cityIndex) {
  const nextState = {
    ...state,
    cityIndexByNiche: { ...(state.cityIndexByNiche || {}), [nicheKey]: cityIndex },
    poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION,
    updatedAt: new Date().toISOString(),
  };
  saveRotationState(nextState);
  return nextState;
}

export function resolveScheduledSweepRounds(value = DEFAULT_SCHEDULED_SWEEP_ROUNDS) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_SCHEDULED_SWEEP_ROUNDS), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SCHEDULED_SWEEP_ROUNDS;
  }
  return Math.min(parsed, MAX_SCHEDULED_SWEEP_ROUNDS);
}

async function runNiche(config, niche, location, queuedMessage) {
  const query = `${niche.term} ${location}`;
  const startedAtMs = Date.now();
  const progress = beginLeadgenProgress(config, queuedMessage, {
    title: 'Scheduled Leadgen',
    niche: niche.key,
    query,
  });

  let result;
  let runError = null;
  try {
    result = await runLeadgenSearch(query, MAX_RESULTS_PER_NICHE, config, {
      niche: niche.key,
      // Stored as "City, Country" so the format survives international
      // expansion; the search query itself stays "<term> <city>".
      location: `${location}, Nederland`,
    });
  } catch (error) {
    runError = error;
  } finally {
    progress.stop();
  }
  const durationMinutes = Math.max(1, Math.round((Date.now() - startedAtMs) / 60000));

  recordOpsMetric(config, 'scheduled_leadgen_run', {
    niche: niche.key,
    query,
    leadCount: result?.leadCount ?? 0,
    insertedCount: result?.insertedCount ?? 0,
    error: runError?.message || '',
  });

  await reportLeadgenRunToDiscord(config, {
    title: 'Scheduled Leadgen',
    niche: niche.key,
    query,
    result,
    runError,
    startedMessage: queuedMessage,
    durationMinutes,
  });

  return { niche: niche.key, query, result, runError, durationMinutes };
}

export async function runLeadgenSweepRound({
  config = loadRuntimeConfig(),
  title = 'Scheduled Leadgen',
  overviewTitle = 'Daily Leadgen Sweep',
} = {}) {
  let rotationState = loadRotationState();

  // Each niche independently picks up wherever IT left off — they can be
  // searching different cities on the same calendar day if one's history
  // of failures differs from another's.
  const plans = NICHE_ROTATION.map((niche) => ({ niche, ...peekNicheCity(rotationState, niche.key) }));
  const outcomes = [];

  // One overview message tracks the whole sweep (X/6 complete, what's
  // running, what's queued), then the per-niche plan is posted upfront as
  // queued messages, in order — each flips to "Running (X min)" when its
  // turn comes and is edited in place with results. Each line carries its
  // own city since niches are no longer guaranteed to share one.
  const statuses = plans.map(({ niche, location, nextLocation }) => ({ niche: niche.key, location, nextLocation, state: 'queued' }));
  const overviewMessage = await postSweepOverview(config, {
    statuses,
    title: overviewTitle,
  });

  const queuedMessages = [];
  for (const { niche, location } of plans) {
    queuedMessages.push(await postLeadgenQueued(config, {
      title,
      niche: niche.key,
      query: `${niche.term} ${location}`,
    }));
  }

  // Sequential on purpose: one Ollama model instance, one Playwright at a
  // time — parallel niches would fight over the same 16GB.
  //
  // Each niche is isolated by its own try/catch: this loop runs unattended
  // for 1-2 hours, and one niche throwing (network blip, Discord hiccup,
  // anything unexpected) must never abandon the remaining niches — a bug
  // in reportLeadgenRunToDiscord's error handling did exactly that on
  // 2026-07-20, killing the whole sweep after ~15 minutes with nothing
  // saved for the day. That specific bug is fixed too, but this loop-level
  // guard is the backstop against the next unforeseen one.
  for (let i = 0; i < plans.length; i += 1) {
    const { niche, cityIndex, location } = plans[i];
    statuses[i].state = 'running';
    await updateSweepOverview(config, overviewMessage, {
      statuses,
      title: overviewTitle,
    });

    let outcome;
    try {
      outcome = await runNiche(config, niche, location, queuedMessages[i]);
    } catch (error) {
      outcome = { niche: niche.key, query: `${niche.term} ${location}`, result: null, runError: error, durationMinutes: 0 };
      process.stderr.write(`Niche ${niche.key} crashed, continuing sweep: ${error.message}\n`);
    }
    outcomes.push(outcome);

    statuses[i].state = outcome.runError ? 'failed' : 'completed';
    statuses[i].leadCount = outcome.result?.leadCount ?? 0;
    statuses[i].durationMinutes = outcome.durationMinutes;
    await updateSweepOverview(config, overviewMessage, {
      statuses,
      title: overviewTitle,
    });

    // Advance ONLY this niche's city, and only on its own success — a
    // different niche failing must not hold this one back, and this one
    // failing must not silently skip its own city either.
    if (!outcome.runError) {
      rotationState = commitNicheAdvance(rotationState, niche.key, cityIndex);
    } else {
      process.stderr.write(`${niche.key} failed — not advancing its city, will retry ${location} next run.\n`);
    }
  }

  // Final overview refresh with the current total lead count — done once at
  // the end (not on every transition) so it's a single extra query per sweep.
  // Approximate on purpose: the operator's daily junk-lead review deletes some
  // rows afterward, so this is "leads in DB right after the sweep", not a
  // forever-accurate figure — still a useful at-a-glance number.
  let totalLeads = null;
  try {
    totalLeads = await countLeads();
  } catch {
    // count is a nicety, never worth failing the sweep over
  }
  await updateSweepOverview(config, overviewMessage, {
    statuses,
    totalLeads,
    title: overviewTitle,
  });

  return {
    title,
    overviewTitle,
    outcomes,
    statuses,
    totalLeads,
    failures: outcomes.filter((outcome) => outcome.runError),
  };
}

export async function runScheduledLeadgen({
  config = loadRuntimeConfig(),
  rounds = DEFAULT_SCHEDULED_SWEEP_ROUNDS,
  title = 'Scheduled Leadgen',
  overviewTitle = 'Daily Leadgen Sweep',
} = {}) {
  const normalizedRounds = resolveScheduledSweepRounds(rounds);
  const roundReports = [];

  for (let index = 0; index < normalizedRounds; index += 1) {
    const roundLabel = normalizedRounds > 1 ? ` (${index + 1}/${normalizedRounds})` : '';
    roundReports.push(await runLeadgenSweepRound({
      config,
      title: `${title}${roundLabel}`,
      overviewTitle: `${overviewTitle}${roundLabel}`,
    }));
  }

  const outcomes = roundReports.flatMap((entry) => entry?.outcomes || []);
  const statuses = roundReports.flatMap((entry) => entry?.statuses || []);
  const failures = outcomes.filter((outcome) => outcome?.runError);
  const totalLeads = roundReports.at(-1)?.totalLeads ?? null;

  return {
    title,
    overviewTitle,
    rounds: normalizedRounds,
    roundReports,
    outcomes,
    statuses,
    totalLeads,
    failures,
  };
}

function getCliFlagValue(flag, argv = process.argv.slice(2)) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return argv[index + 1] || '';
}

function resolveCliSweepRounds(argv = process.argv.slice(2)) {
  const timesValue = getCliFlagValue('--times', argv);
  if (timesValue) {
    return resolveScheduledSweepRounds(timesValue);
  }
  return resolveScheduledSweepRounds(getCliFlagValue('--rounds', argv));
}

async function main() {
  const rounds = resolveCliSweepRounds();
  const result = await runScheduledLeadgen({ rounds });

  process.stdout.write(`${JSON.stringify(
    result.outcomes.map(({ niche, query, result: outcomeResult, runError }) => ({
      niche,
      query,
      leadCount: outcomeResult?.leadCount ?? 0,
      insertedCount: outcomeResult?.insertedCount ?? 0,
      alreadyKnownCount: outcomeResult?.alreadyKnownCount ?? 0,
      searchedCount: outcomeResult?.searchedCount ?? 0,
      error: runError?.message || undefined,
    })),
    null,
    2,
  )}\n`);

  if (result.failures.length > 0) {
    process.stderr.write(`${result.failures.length} niche run(s) failed across ${result.rounds} sweep(s).\n`);
    process.exitCode = 1;
  }
}

// Chain N sequential sweeps in one launchd fire. Operator's use case
// (2026-08-15): the 07:00 slot is the only quiet-machine window before
// the operator starts using Ollama themselves at ~9-10am; running a
// second sweep back-to-back inside that window doubles rotation speed
// without contending with their workday sessions. Each sweep reloads
// rotation-state.json fresh, so sweep 2 sees the commits from sweep 1
// and advances to the NEXT set of cities — the two sweeps hit distinct
// (city, niche) combinations, not the same ones twice.
//
// --times defaults to 1 (existing behavior preserved for callers that
// don't pass it). Hard-capped at 10 as a runaway guard — realistically
// 2-3 is the useful range given the qualification cap at 60/day.
async function legacySequentialSweepMain() {
  const config = loadRuntimeConfig();
  const times = getIntFlag('--times', 1, 1, 10);
  let totalFailures = 0;

  for (let sweep = 1; sweep <= times; sweep += 1) {
    if (times > 1) {
      process.stderr.write(`Scheduled leadgen: starting sweep ${sweep}/${times}.\n`);
    }
    const { failures } = await runOneSweep(config);
    totalFailures += failures.length;
    if (times > 1) {
      process.stderr.write(`Scheduled leadgen: sweep ${sweep}/${times} complete (${failures.length} niche failure(s)).\n`);
    }
  }

  if (totalFailures > 0) {
    process.stderr.write(`${totalFailures} total niche run(s) failed across ${times} sweep(s).\n`);
    process.exitCode = 1;
  }
}

// Guard main() so importing this file (e.g. from tests that need
// LOCATION_ROTATION) doesn't kick off a real leadgen sweep. Only runs when
// invoked as the CLI, not on `import`.
const IS_MAIN_MODULE = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (IS_MAIN_MODULE) {
  main().catch((error) => {
    process.stderr.write(`Scheduled leadgen sweep failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
