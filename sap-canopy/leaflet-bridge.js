/**
 * SAP Canopy — Leaflet ⇄ Three.js bridge
 * ---------------------------------------------------------------------------
 * Two-way camera sync for the urban forest digital twin.
 *
 *  • Leaflet → Three : map move/zoom writes the camera target (ground plane XZ).
 *  • Three → Leaflet : orbit controls write the map view (debounced).
 *
 * Tile source matches TREEGENS Dashboard v2: CartoDB dark_matter (no API key).
 * MarkerCluster is used when available so 100s of claim markers stay smooth.
 */

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export class LeafletBridge {
  constructor(options = {}) {
    this.container = options.container;
    this.center = options.center || { lat: 30, lng: 0 };
    this.zoom = options.zoom ?? 2;
    this.onCameraChange = options.onCameraChange || (() => {});
    this.onSelect = options.onSelect || (() => {});
    this.onHover = options.onHover || (() => {});
    this.map = null;
    this.layer = null;
    this.markers = new Map();
    this._syncLock = false;
    this._lastPush = 0;
    this._pushTimer = null;
    this.available = typeof window !== 'undefined' && typeof window.L !== 'undefined';
  }

  init() {
    if (!this.available || !this.container) {
      this.container && (this.container.innerHTML =
        '<div class="map-fallback"><span>🗺️</span><p>Leaflet unavailable (offline?). 3D twin still runs.</p></div>');
      return null;
    }
    const L = window.L;
    this.map = L.map(this.container, {
      center: [this.center.lat, this.center.lng],
      zoom: this.zoom,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
      minZoom: 2,
      maxZoom: 18
    });

    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19, subdomains: 'abcd' }).addTo(this.map);

    // Clustered layer when the plugin is present, plain layer otherwise.
    if (L.markerClusterGroup) {
      this.layer = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 48,
        showCoverageOnHover: false,
        iconCreateFunction: (cluster) => L.divIcon({
          className: 'sap-cluster',
          html: `<div class="sap-cluster-dot"><span>${cluster.getChildCount()}</span></div>`,
          iconSize: [34, 34]
        })
      });
    } else {
      this.layer = L.layerGroup();
    }
    this.layer.addTo(this.map);

    this.map.on('moveend zoomend', () => {
      if (this._syncLock) return;
      const c = this.map.getCenter();
      const z = this.map.getZoom();
      this.onCameraChange({ lat: c.lat, lng: c.lng, zoom: z, source: 'leaflet' });
    });

    // Pointer -> nearest marker (used by the tooltip / selection panel)
    this.map.on('mousemove', (e) => {
      const hit = this._nearest(e.latlng);
      if (hit) this.onHover(hit, e);
    });

    setTimeout(() => this.map.invalidateSize(), 120);
    return this.map;
  }

  _nearest(latlng) {
    let best = null, bestD = Infinity;
    for (const [id, marker] of this.markers) {
      const p = marker.getLatLng();
      const d = Math.hypot(p.lat - latlng.lat, p.lng - latlng.lng);
      if (d < bestD) { bestD = d; best = { id, marker, props: marker.options.sapProps }; }
    }
    const threshold = 6 / Math.max(this.map.getZoom(), 1);
    return bestD <= threshold ? best : null;
  }

  /** Render claim cohorts as coloured circles. */
  setTrees(geojson) {
    if (!this.map || !this.layer) return;
    const L = window.L;
    this.layer.clearLayers();
    this.markers.clear();

    const biomeColor = { mangrove: '#2e7d32', street: '#66bb6a' };

    geojson.features.forEach((f) => {
      const p = f.properties;
      const c = f.geometry.coordinates;
      const color = biomeColor[p.biome] || '#4caf50';
      const radius = Math.max(3, Math.min(16, 3 + Math.log10(Math.max(p.stems, 10)) * 1.9));
      const marker = L.circleMarker([c[1], c[0]], {
        radius,
        color,
        weight: 1.5,
        opacity: 0.95,
        fillColor: color,
        fillOpacity: 0.55
      });
      marker.options.sapProps = p;
      marker.bindPopup(
        `<div class="sap-popup">
           <strong>${p.airline || p.id}</strong><br>
           <span>${p.species || '—'}</span><br>
           ${Number(p.stems).toLocaleString()} stems · ${p.height?.toFixed?.(1) ?? '—'} m<br>
           ~${Number(p.carbon).toFixed(0)} tCO₂e · health ${(p.health * 100).toFixed(0)}%<br>
           <em>Illustrative averages, not site-specific predictions.</em>
         </div>`
      );
      marker.on('click', () => this.onSelect(p));
      marker.on('mouseover', () => this.onHover({ id: p.id, props: p }));
      marker.on('mouseout', () => this.onHover(null));
      marker.addTo(this.layer);
      this.markers.set(p.id, marker);
    });
  }

  /** Push a Three.js camera state into the map (debounced to avoid feedback loops). */
  pushFromThree(lat, lng, zoom) {
    if (!this.map) return;
    const now = performance.now();
    if (now - this._lastPush < 120) return;
    this._lastPush = now;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this._syncLock = true;
      this.map.setView([lat, lng], zoom, { animate: false });
      this._syncLock = false;
    }, 60);
  }

  focus(lat, lng, zoom = 8) {
    if (!this.map) return;
    this._syncLock = true;
    this.map.setView([lat, lng], zoom, { animate: true });
    setTimeout(() => { this._syncLock = false; }, 500);
  }

  setVisible(visible) {
    if (!this.map || !this.container) return;
    const el = this.container;
    if (visible) {
      el.style.display = 'block';
      el.style.pointerEvents = 'auto';
      setTimeout(() => this.map.invalidateSize(), 50);
    } else {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    }
  }

  invalidate() { this.map && this.map.invalidateSize(); }
}
