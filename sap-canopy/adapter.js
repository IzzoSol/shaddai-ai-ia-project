/**
 * SAP Canopy Adapter
 * Bridges Treegens Dashboard v2 data schema (AirlinesDB) to Three.js tree attributes.
 * TURTLE design note: keep mapping pure, testable, and easily extensible for new species.
 */

export class TreegensAdapter {
  constructor(){ this.db = null; }

  async load(){
    // TREEGENS-handoff provides AirlinesDB global
    if(window.AirlinesDB && typeof AirlinesDB.load === 'function'){
      await AirlinesDB.load();
      this.db = AirlinesDB;
    }else{
      console.warn('[SAP] AirlinesDB not found, using mock data');
      this.db = this._mockDB();
    }
  }

  _mockDB(){
    const mock = {
      getByClaim: (claimId) => {
        // demo claims
        const claims = {
          'CLAIM-001':{id:'CLAIM-001',lat:40.7128,lng:-74.0060,species:'Quercus alba',health:0.82,height:12.4,canopy:6.2,age:45,carbon:8.1,source:'TREEGENS'},
          'CLAIM-002':{id:'CLAIM-002',lat:40.7135,lng:-74.0055,species:'Acer saccharum',health:0.64,height:9.8,canopy:4.9,age:32,carbon:5.3,source:'TREEGENS'}
        };
        return claims[claimId] || null;
      },
      queryByBounds: (ne, sw) => {
        // return array of claims within bounds — mock
        return [
          {id:'CLAIM-001',lat:40.7128,lng:-74.0060,species:'Quercus alba',health:0.82,height:12.4,canopy:6.2,age:45,carbon:8.1},
          {id:'CLAIM-003',lat:40.7140,lng:-74.0040,species:'Tilia americana',health:0.91,height:14.0,canopy:7.0,age:60,carbon:9.4}
        ];
      }
    };
    return mock;
  }

  // Map Treegens record -> Three.js instance attributes
  mapToTree(record){
    const health = clamp(record.health ?? 0.5,0,1);
    const height = clamp(record.height ?? 8,2,35);
    const canopy = clamp(record.canopy ?? 4,1.5,12);

    // Species palette
    const speciesColor = this._speciesColor(record.species ?? 'Unknown');

    // Sacred geometry influence: use age to modulate scale variance
    const ageFactor = Math.log10(record.age ?? 10 + 1) / 2;

    return {
      id: record.id,
      position:{lat:record.lat,lng:record.lng},
      species: record.species,
      health,
      height,
      canopy,
      age: record.age ?? 0,
      carbon: record.carbon ?? 0,
      source: record.source ?? 'TREEGENS',
      // Three attributes
      trunkScale:[1, height/10, 1],
      foliageScale:[canopy/5, canopy/5, canopy/5],
      color: speciesColor,
      opacity: 0.6 + 0.4*health,
      metalness: 0.02,
      roughness: 0.8 - 0.2*health,
      ageFactor
    };
  }

  _speciesColor(species){
    const map = {
      'Quercus alba':0x4caf50,
      'Acer saccharum':0xff9800,
      'Tilia americana':0x8bc34a,
      'Pinus strobus':0x2e7d32
    };
    return map[species] ?? 0x4caf50;
  }

  // Generate sacred geometry placement points within a radius
  generateMetatronPositions(count, centerLat, centerLng, radiusMeters = 200){
    const pts = [];
    // Metatron's cube -> 13 points approx
    for(let i=0;i<count;i++){
      const t = i / count;
      // Fibonacci spiral
      const angle = t * Math.PI * 2 * 1.6180339887;
      const r = radiusMeters * Math.sqrt(t);
      const [dx,dy] = this._metersToDeg(r, angle);
      pts.push({
        lat:centerLat + dy,
        lng:centerLng + dx
      });
    }
    return pts;
  }

  _metersToDeg(m, angle){
    const R = 6371000;
    const latOffset = (m * Math.sin(angle)) / R * (180/Math.PI);
    const lngOffset = (m * Math.cos(angle)) / (R * Math.cos( (0)*Math.PI/180 )) * (180/Math.PI);
    return [lngOffset, latOffset];
  }
}

function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
