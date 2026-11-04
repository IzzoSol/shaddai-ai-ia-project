/**
 * SAP Canopy Adapter — Treegens → Three.js bridge
 * ---------------------------------------------------------------------------
 * TURTLE design note: keep the mapping pure, deterministic and explainable.
 *
 * DATA REALITY CHECK (verified against the Treegens handoff):
 *   Treegens Dashboard v2 stores airline sponsorship claims in `AirlinesDB`
 *   (localStorage key `treegensAirlines`). A record looks like:
 *     { id, name, region, fleet, dealSize, urgency, stage, status,
 *       claimedBy, ceo, contactEmail, phase, lastContact, nextFollowUp }
 *   Methods: load() save() add() update() delete() claim() unclaim()
 *            getByClaim(claimedBy) getByRegion(region) getByStage(stage)
 *
 *   There is NO tree geometry, species, lat/lng, height or health field in
 *   Treegens. A Treegens claim is a SPONSORSHIP of a tree cohort, so this
 *   adapter DERIVES an illustrative tree cohort from each claim using a
 *   deterministic, documented rule set (see `deriveCohort`). Derived values
 *   are clearly marked `derived: true` and must be presented as
 *   "illustrative averages, not site-specific predictions".
 *
 *   If a future Treegens schema ships real tree fields, they are picked up
 *   automatically — real fields always win over derived ones.
 */

// ---------------------------------------------------------------------------
// Region centroids — copied from TREEGENS Dashboard v2 `regionCoords`
// ---------------------------------------------------------------------------
export const TREEGENS_REGIONS = {
  EU:     { lat: 48.8566, lng: 2.3522,  name: 'Europe' },
  US:     { lat: 40.7128, lng: -74.006, name: 'North America' },
  Asia:   { lat: 35.6762, lng: 139.6503,name: 'Asia Pacific' },
  ME:     { lat: 25.2048, lng: 55.2708, name: 'Middle East' },
  Africa: { lat: -1.2921, lng: 36.8219, name: 'Africa' },
  LatAm:  { lat: -23.5505, lng: -46.6333,name: 'Latin America' }
};

// Species pools per biome (illustrative averages)
const MANGROVE_REGIONS = new Set(['ME', 'Asia', 'LatAm']);
const MANGROVE_SPECIES = ['Rhizophora mangle', 'Avicennia germinans', 'Laguncularia racemosa'];
const STREET_SPECIES  = ['Quercus alba', 'Acer saccharum', 'Tilia americana', 'Platanus x acerifolia'];

// Pipeline stage → expected establishment health (illustrative)
const STAGE_HEALTH = {
  won: 0.95, negotiating: 0.82, engaged: 0.74, contacted: 0.64,
  researching: 0.56, unclaimed: 0.5
};

// CORSIA / Treegens phase → cohort multiplier (illustrative)
const PHASE_MULTIPLIER = { 'Phase 1': 1.0, 'Phase 2': 1.35, 'Phase 3': 1.65 };

const SPECIES_COLOR = {
  'Rhizophora mangle': 0x2e7d32,
  'Avicennia germinans': 0x388e3c,
  'Laguncularia racemosa': 0x43a047,
  'Quercus alba': 0x66bb6a,
  'Acer saccharum': 0xffb300,
  'Tilia americana': 0x9ccc65,
  'Platanus x acerifolia': 0x8bc34a
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** Deterministic 32-bit string hash → stable seed for a record id. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic, tiny, no dependencies. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal offline seed (subset of Treegens `realData`) so the twin boots with no network. */
const SEED_AIRLINES = [
  { name: 'American Airlines', region: 'US', fleet: 900, dealSize: 45000000, ceo: 'Robert Isom', email: 'esg@aa.com', phase: 'Phase 1' },
  { name: 'United Airlines', region: 'US', fleet: 941, dealSize: 48000000, ceo: 'Scott Kirby', email: 'esg@united.com', phase: 'Phase 1' },
  { name: 'Delta Air Lines', region: 'US', fleet: 768, dealSize: 42000000, ceo: 'Ed Bastian', email: 'esg@delta.com', phase: 'Phase 1' },
  { name: 'Ryanair', region: 'EU', fleet: 500, dealSize: 28000000, ceo: 'Michael OLeary', email: 'sustainability@ryanair.com', phase: 'Phase 1' },
  { name: 'Southwest', region: 'US', fleet: 750, dealSize: 38000000, ceo: 'Bob Jordan', email: 'investor.relations@wnco.com', phase: 'Phase 1' },
  { name: 'China Eastern', region: 'Asia', fleet: 753, dealSize: 35000000, ceo: 'Ma Xulun', email: 'esg@ceair.com', phase: 'Phase 1' },
  { name: 'LATAM Airlines', region: 'LatAm', fleet: 312, dealSize: 15000000, ceo: 'Roberto Alvo', email: 'esg@latam.com', phase: 'Phase 1' },
  { name: 'ANA', region: 'Asia', fleet: 274, dealSize: 20000000, ceo: 'Yuji Akasaka', email: 'esg@ana.co.jp', phase: 'Phase 1' },
  { name: 'Turkish Airlines', region: 'ME', fleet: 440, dealSize: 24000000, ceo: 'Bilal Eksi', email: 'esg@thy.com', phase: 'Phase 1' },
  { name: 'Emirates', region: 'ME', fleet: 259, dealSize: 28000000, ceo: 'Ahmed bin Saeed', email: 'esg@emirates.ae', phase: 'Phase 1' },
  { name: 'Ethiopian Airlines', region: 'Africa', fleet: 141, dealSize: 9000000, ceo: 'Mesfin Tasew', email: 'ir@ethiopianairlines.co', phase: 'Phase 1' },
  { name: 'Qantas', region: 'Asia', fleet: 286, dealSize: 16000000, ceo: 'Alan Joyce', email: 'esg@qantas.com', phase: 'Phase 1' }
];

export class TreegensAdapter {
  constructor(options = {}) {
    this.options = {
      localStorageKey: 'treegensAirlines',
      jsonUrl: null,            // e.g. './treegens-airlines.json' or a REST endpoint
      db: null,                // injected DB (window.AirlinesDB) wins over everything
      ...options
    };
    this.db = null;
    this.records = [];
    this.source = 'none';      // 'injected' | 'localStorage' | 'json' | 'seed'
    this.cohorts = [];
  }

  // -------------------------------------------------------------------------
  // Loading — mirrors Treegens AirlinesDB.load() semantics
  // -------------------------------------------------------------------------
  async load() {
    const injected = this.options.db || (typeof window !== 'undefined' ? window.AirlinesDB : null);
    if (injected && typeof injected.load === 'function') {
      this.db = injected;
      this.records = injected.load() || [];
      this.source = 'injected';
    } else if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(this.options.localStorageKey);
      if (raw) {
        try {
          this.records = JSON.parse(raw);
          this.source = 'localStorage';
          this.db = this._wrapRecords(this.records);
        } catch { /* fall through */ }
      }
    }

    if (!this.records.length && this.options.jsonUrl) {
      try {
        const res = await fetch(this.options.jsonUrl, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          this.records = Array.isArray(data) ? data : (data.records || []);
          this.source = 'json';
          this.db = this._wrapRecords(this.records);
        }
      } catch (e) {
        console.warn('[SAP] Treegens JSON fetch failed:', e.message);
      }
    }

    if (!this.records.length) {
      this.records = this._seedRecords();
      this.source = 'seed';
      this.db = this._wrapRecords(this.records);
    }

    this._normalize();
    this.cohorts = this.records.map(r => this.deriveCohort(r));
    return this.cohorts;
  }

  _seedRecords() {
    return SEED_AIRLINES.map((a, i) => ({
      id: 'airline_' + (i + 1),
      name: a.name,
      region: a.region,
      fleet: a.fleet,
      dealSize: a.dealSize,
      urgency: (i * 5) % 100,
      stage: 'unclaimed',
      status: 'not_contacted',
      claimedBy: null,
      ceo: a.ceo,
      contactEmail: a.email,
      phase: a.phase,
      lastContact: null,
      nextFollowUp: null
    }));
  }

  /** Wrap plain records in an AirlinesDB-compatible facade. */
  _wrapRecords(records) {
    const self = this;
    return {
      load: () => records,
      save: (next) => { self.records = next; },
      getByClaim: (claimedBy) => records.filter(r => r.claimedBy === claimedBy),
      getByRegion: (region) => records.filter(r => r.region === region),
      getByStage: (stage) => records.filter(r => r.stage === stage),
      getById: (id) => records.find(r => r.id === id) || null
    };
  }

  /** Fill in the fields Treegens assigns at seed time (mirrors AirlinesDB.load). */
  _normalize() {
    this.records = this.records.map((r, i) => ({
      id: r.id || ('airline_' + (i + 1)),
      name: r.name || 'Unknown Airline',
      region: r.region || 'US',
      fleet: r.fleet ?? 0,
      dealSize: r.dealSize ?? 0,
      urgency: r.urgency ?? ((i * 5) % 100),
      stage: r.stage || 'unclaimed',
      status: r.status || 'not_contacted',
      claimedBy: r.claimedBy ?? null,
      ceo: r.ceo || '',
      contactEmail: r.contactEmail || r.email || '',
      phase: r.phase || 'Phase 1',
      lastContact: r.lastContact ?? null,
      nextFollowUp: r.nextFollowUp ?? null,
      // Real tree fields, if a future Treegens schema provides them:
      lat: r.lat, lng: r.lng, species: r.species, health: r.health,
      height: r.height, canopy: r.canopy, age: r.age, carbon: r.carbon,
      trees: r.trees
    }));
  }

  // -------------------------------------------------------------------------
  // Treegens-compatible accessors
  // -------------------------------------------------------------------------
  getByClaim(claimedBy) {
    return this.db ? this.db.getByClaim(claimedBy) : [];
  }

  getByRegion(region) {
    return this.db ? this.db.getByRegion(region) : [];
  }

  getByStage(stage) {
    return this.db ? this.db.getByStage(stage) : [];
  }

  getById(id) {
    return this.records.find(r => r.id === id) || null;
  }

  /** Bounds query used by the Leaflet viewport culling. */
  queryByBounds(ne, sw) {
    return this.cohorts.filter(c =>
      c.lat <= ne.lat && c.lat >= sw.lat && c.lng <= ne.lng && c.lng >= sw.lng
    );
  }

  // -------------------------------------------------------------------------
  // Derivation — Treegens claim → illustrative tree cohort
  // -------------------------------------------------------------------------
  /**
   * Rules (all deterministic, all documented):
   *   stems      = dealSize / 1000, clamped 250..40 000, scaled by phase multiplier
   *   biome      = mangrove when region ∈ {ME, Asia, LatAm}, otherwise street canopy
   *   species    = deterministic pick from the biome pool
   *   health     = stage → STAGE_HEALTH (illustrative establishment health)
   *   age        = programme years since 2024 baseline (clamped 0..20)
   *   height     = biome growth curve at age (illustrative average)
   *   canopy     = crown radius at age (illustrative average)
   *   carbon     = generic allometric biomass → carbon (illustrative average)
   *   position   = region centroid + deterministic jitter (stable across reloads)
   */
  deriveCohort(record) {
    const rand = seededRandom(hashSeed(record.id));
    const region = TREEGENS_REGIONS[record.region] || TREEGENS_REGIONS.US;
    const isMangrove = MANGROVE_REGIONS.has(record.region);

    const phaseMult = PHASE_MULTIPLIER[record.phase] || 1.0;
    const rawStems = (record.dealSize || 0) / 1000;
    const stems = Math.round(clamp(rawStems, 250, 40000) * phaseMult);

    const pool = isMangrove ? MANGROVE_SPECIES : STREET_SPECIES;
    const species = record.species || pool[Math.floor(rand() * pool.length) % pool.length];

    const age = record.age ?? clamp(new Date().getFullYear() - 2024, 0, 20);
    const health = clamp(record.health ?? STAGE_HEALTH[record.stage] ?? 0.5, 0, 1);

    const H_MAX = isMangrove ? 14 : 19;
    const K_H   = isMangrove ? 0.26 : 0.18;
    const P_H   = isMangrove ? 0.85 : 0.95;
    const R_MAX = isMangrove ? 3.4 : 4.6;
    const K_C   = isMangrove ? 0.24 : 0.16;

    const height = clamp(record.height ?? H_MAX * (1 - Math.exp(-K_H * Math.pow(age, P_H))), 1, 40);
    const canopyRadius = clamp(record.canopy ?? R_MAX * (1 - Math.exp(-K_C * age)), 0.4, 9);
    const dbh = (isMangrove ? 0.21 : 0.28) * Math.pow(height, isMangrove ? 1.02 : 1.0);
    const biomass = (isMangrove ? 0.25 : 0.20) * Math.pow(dbh, 2) * height;
    const carbon = record.carbon ?? (biomass * stems * 0.47 / 1000);

    // Deterministic jitter around the region centroid (±0.55° ≈ ±60km)
    const spread = 0.55;
    const lat = record.lat ?? (region.lat + (rand() - 0.5) * spread);
    const lng = record.lng ?? (region.lng + (rand() - 0.5) * spread);

    return {
      id: record.id,
      airline: record.name,
      region: record.region,
      regionName: region.name,
      claimedBy: record.claimedBy,
      stage: record.stage,
      phase: record.phase,
      dealSize: record.dealSize,
      fleet: record.fleet,
      ceo: record.ceo,
      contactEmail: record.contactEmail,
      biome: isMangrove ? 'mangrove' : 'street',
      species,
      stems,
      age,
      health,
      height,
      canopy: canopyRadius,
      carbon,
      lat,
      lng,
      derived: true,
      source: 'TREEGENS',
      caveat: 'Illustrative averages, not site-specific predictions.'
    };
  }

  // -------------------------------------------------------------------------
  // Three.js attribute mapping
  // -------------------------------------------------------------------------
  mapToTree(record) {
    const health = clamp(record.health ?? 0.5, 0, 1);
    const height = clamp(record.height ?? 8, 2, 35);
    const canopy = clamp(record.canopy ?? 4, 1.5, 12);
    const color = SPECIES_COLOR[record.species] ?? (record.biome === 'mangrove' ? 0x2e7d32 : 0x4caf50);
    const ageFactor = Math.log10((record.age ?? 10) + 1) / 2;

    return {
      id: record.id,
      airline: record.airline,
      species: record.species,
      biome: record.biome,
      region: record.region,
      regionName: record.regionName,
      stage: record.stage,
      phase: record.phase,
      stems: record.stems,
      position: { lat: record.lat, lng: record.lng },
      health,
      height,
      canopy,
      age: record.age ?? 0,
      carbon: record.carbon ?? 0,
      source: record.source ?? 'TREEGENS',
      derived: record.derived ?? true,
      caveat: record.caveat ?? 'Illustrative averages, not site-specific predictions.',
      // Three.js
      trunkScale: [1, height / 10, 1],
      foliageScale: [canopy / 5, canopy / 5, canopy / 5],
      color,
      opacity: 0.6 + 0.4 * health,
      metalness: 0.02,
      roughness: 0.8 - 0.2 * health,
      ageFactor
    };
  }

  /** Full mapping pipeline: cohorts → tree render records. */
  treeRecords() {
    return this.cohorts.map(c => this.mapToTree(c));
  }

  // -------------------------------------------------------------------------
  // Sacred geometry placement (Metatron / Fibonacci) — unchanged behaviour
  // -------------------------------------------------------------------------
  generateMetatronPositions(count, centerLat, centerLng, radiusMeters = 200) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * Math.PI * 2 * 1.6180339887;
      const r = radiusMeters * Math.sqrt(t);
      const [dx, dy] = this._metersToDeg(r, angle);
      pts.push({ lat: centerLat + dy, lng: centerLng + dx });
    }
    return pts;
  }

  _metersToDeg(m, angle) {
    const R = 6371000;
    const latOffset = (m * Math.sin(angle)) / R * (180 / Math.PI);
    const lngOffset = (m * Math.cos(angle)) / (R * Math.cos(0 * Math.PI / 180)) * (180 / Math.PI);
    return [lngOffset, latOffset];
  }

  /** GeoJSON for Leaflet circle markers. */
  toGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: this.cohorts.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: {
          id: c.id, airline: c.airline, region: c.region, biome: c.biome,
          species: c.species, stems: c.stems, health: c.health,
          height: c.height, carbon: c.carbon, stage: c.stage, phase: c.phase
        }
      }))
    };
  }

  summary() {
    const totalStems = this.cohorts.reduce((s, c) => s + c.stems, 0);
    const totalCarbon = this.cohorts.reduce((s, c) => s + c.carbon, 0);
    const avgHealth = this.cohorts.length
      ? this.cohorts.reduce((s, c) => s + c.health, 0) / this.cohorts.length
      : 0;
    return {
      source: this.source,
      claims: this.cohorts.length,
      totalStems,
      totalCarbon,
      avgHealth,
      regions: Object.keys(TREEGENS_REGIONS).filter(r => this.getByRegion(r).length)
    };
  }
}

export { clamp, SEED_AIRLINES, MANGROVE_SPECIES, STREET_SPECIES };
