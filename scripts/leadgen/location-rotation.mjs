// Location-rotation pool for the scheduled leadgen sweep.
//
// Extracted from run-scheduled-leadgen.mjs (2026-09-03) to stay under the
// 700-line script guardrail after the visited-set migration doubled the
// file's size. The pool itself is loaded from the checked-in
// data/leadgen/nl-woonplaatsen.json (2,502 CBS BAG woonplaatsen); the
// LEGACY_LOCATION_ROTATION_TIER3 array below is kept ONLY so migrations
// can resolve pre-v4 rotation-state.json files that store positional
// cursors into the old 841-entry pool back to specific location names.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../../services/lib/runtime-config.mjs';

// Legacy hardcoded pool (Tier-3 aka "CBS BAG 841" from PR #87). Kept in
// the code for ONE reason only: migration. Existing rotation-state.json
// files reference these entries by INDEX (cityIndexByNiche), so when we
// convert to the visited-set model in 2026-09-03 (Tier 4), we need to
// resolve each niche's stored cityIndex back to the specific location
// name that was visited. After migration completes, this array is no
// longer read at runtime — LOCATION_ROTATION below is loaded from the
// checked-in nl-woonplaatsen.json instead.
export const LEGACY_LOCATION_ROTATION_TIER3 = [
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
// code. Bump this whenever the pool composition changes so migrations
// know to re-derive the visited set from the previous shape.
//   1 = original 22 major cities
//   2 = Tier 1 expansion to 568 (PR #40, 2026-08-10)
//   3 = CBS BAG 841 hardcoded (PR #87, 2026-09-02) — see LEGACY_LOCATION_ROTATION_TIER3
//   4 = CBS BAG ~2,500 loaded from data/leadgen/nl-woonplaatsen.json + visited-set state
//       model (2026-09-03) — every woonplaats active; visited tracked by name so pool
//       reshuffles don't lose per-niche progress.
export const CURRENT_POOL_EXPANSION_VERSION = 4;

// Load LOCATION_ROTATION from the checked-in nl-woonplaatsen.json — see
// scripts/leadgen/fetch-nl-woonplaatsen.mjs for how that file is
// produced. Format:
//   - Positions 0-21: 22 originals (preserved in operator's requested
//     order — big cities they want to revisit each cycle).
//   - Positions 22+: everything else, alphabetized. Names that appear
//     in multiple provinces get disambiguated with "(Provincie)" so
//     the search query stays unambiguous.
const ORIGINALS = [
  'Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht', 'Eindhoven',
  'Groningen', 'Tilburg', 'Almere', 'Breda', 'Nijmegen', 'Arnhem',
  'Haarlem', 'Amersfoort', 'Apeldoorn', "'s-Hertogenbosch", 'Zwolle',
  'Leiden', 'Maastricht', 'Leeuwarden', 'Assen', 'Middelburg', 'Lelystad',
];
// PDOK's official BAG name for a few historical Dutch cities differs
// from the everyday name the operator has in ORIGINALS. Alias so both
// entries collapse into one canonical form (the ORIGINALS name wins).
export const BAG_TO_ORIGINALS_ALIAS = new Map([
  ["'s-Gravenhage", 'Den Haag'],
]);
// BAG's disambiguation for cross-province namesake towns uses cryptic
// abbreviations ("Bergen (NH)", "Bergen L", "Elst Ut") instead of full
// province names. Rewrite to the readable "Name (Provincie)" form —
// stays unambiguous for search engines and matches the operator's
// mental model established in the pre-Tier-4 curated list.
const BAG_DISAMBIGUATION_REWRITES = new Map([
  ['Bergen (NH)', 'Bergen (Noord-Holland)'],
  ['Bergen L', 'Bergen (Limburg)'],
  ['Elst Ut', 'Elst (Utrecht)'],
]);
const WOONPLAATSEN_JSON_PATH = resolve(projectRoot, 'data', 'leadgen', 'nl-woonplaatsen.json');

function buildLocationRotation() {
  const doc = JSON.parse(readFileSync(WOONPLAATSEN_JSON_PATH, 'utf8'));
  const rows = (doc.rows || []).filter((r) => r.is_active);
  // Detect names with multiple rows across provinces — those need a
  // "(Provincie)" disambiguator so search queries stay unambiguous.
  const nameCounts = new Map();
  for (const r of rows) nameCounts.set(r.name, (nameCounts.get(r.name) || 0) + 1);
  const originalsSet = new Set(ORIGINALS);
  const formatted = new Set(ORIGINALS);
  const nonOriginal = [];
  for (const r of rows) {
    const canonical = BAG_TO_ORIGINALS_ALIAS.get(r.name) || r.name;
    if (originalsSet.has(canonical)) continue;
    const rawDisplay = (nameCounts.get(r.name) || 0) > 1 ? `${r.name} (${r.provincie})` : r.name;
    // Prefer the readable rewrite when BAG shipped an abbreviated form.
    const display = BAG_DISAMBIGUATION_REWRITES.get(rawDisplay) || rawDisplay;
    if (formatted.has(display)) continue;
    formatted.add(display);
    nonOriginal.push(display);
  }
  nonOriginal.sort((a, b) => a.localeCompare(b, 'nl'));
  return [...ORIGINALS, ...nonOriginal];
}

export const LOCATION_ROTATION = buildLocationRotation();
