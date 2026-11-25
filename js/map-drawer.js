/* Map Drawing Studio (Google Earth Style) for Project Dashboard
 * Supports: Distance & Area measurement (sq.m & Thai Rai-Ngan-Wah),
 * Geometric shapes (Polyline, Polygon, Rectangle, Circle),
 * Preset Icons (Pin, Directional Arrow, Star), Labels, Colors, and persistence.
 */

class ProjectMapDrawer {
  constructor() {
    this.map = null;
    this.drawnGroup = null;
    this.items = []; // Array of serialized drawing objects
    this.activeTool = 'select';
    this.activeColor = '#ef4444';
    this.showLabels = true;
    this.onSaveCallback = null;
    this.onUseCoordsCallback = null;
    this.modalInstance = null;

    // Arrow two-click placement state
    this._arrowStage = 0;
    this._arrowStart = null;
    this._arrowPreviewLayer = null;

    // Live measurement tooltip while drawing
    this._liveTooltip = null;
    this._drawPoints = [];
  }

  /**
   * Geodesic polygon area in square meters (Shoelace on WGS84 sphere)
   */
  static geodesicArea(latLngs) {
    if (!Array.isArray(latLngs) || latLngs.length < 3) return 0;
    const d2r = Math.PI / 180;
    const radius = 6378137;
    let area = 0;
    const len = latLngs.length;
    for (let i = 0; i < len; i++) {
      const p1 = latLngs[i];
      const p2 = latLngs[(i + 1) % len];
      const lat1 = (Array.isArray(p1) ? p1[0] : p1.lat) * d2r;
      const lng1 = (Array.isArray(p1) ? p1[1] : p1.lng) * d2r;
      const lat2 = (Array.isArray(p2) ? p2[0] : p2.lat) * d2r;
      const lng2 = (Array.isArray(p2) ? p2[1] : p2.lng) * d2r;
      area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs((area * radius * radius) / 2.0);
  }

  /**
   * Geodesic polyline distance in meters
   */
  static polylineDistance(latLngs) {
    if (!Array.isArray(latLngs) || latLngs.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < latLngs.length - 1; i++) {
      const a = Array.isArray(latLngs[i]) ? L.latLng(latLngs[i][0], latLngs[i][1]) : L.latLng(latLngs[i]);
      const b = Array.isArray(latLngs[i + 1]) ? L.latLng(latLngs[i + 1][0], latLngs[i + 1][1]) : L.latLng(latLngs[i + 1]);
      total += a.distanceTo(b);
    }
    return total;
  }

  static formatDistance(meters) {
    if (!meters || isNaN(meters)) return '0 m';
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km (${Math.round(meters).toLocaleString()} m)`;
    }
    return `${meters.toFixed(1)} m`;
  }

  static formatThaiArea(sqm) {
    if (!sqm || isNaN(sqm)) return '0 ตร.ม.';
    const totalWah = sqm / 4;
    const rai = Math.floor(totalWah / 400);
    const remAfterRai = totalWah % 400;
    const ngan = Math.floor(remAfterRai / 100);
    const wah = (remAfterRai % 100).toFixed(1);
    const sqmText = sqm >= 10000
      ? `${Math.round(sqm).toLocaleString()} ตร.ม.`
      : `${sqm.toFixed(1)} ตร.ม.`;
    return `${sqmText} (${rai} ไร่ ${ngan} งาน ${wah} ตร.วา)`;
  }

  /**
   * Create SVG DivIcon for preset icons (pin, arrow, star)
   */
  static createPresetIcon(kind, color = '#ef4444', rotation = 0) {
    const safeColor = color || '#ef4444';
    let svg = '';
    let size = [32, 32];
    let anchor = [16, 16];

    if (kind === 'pin') {
      size = [30, 40];
      anchor = [15, 39];
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="30" height="40" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.55));">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 8.25 12 20 12 20s12-11.75 12-20C24 5.37 18.63 0 12 0z" fill="${safeColor}" stroke="#ffffff" stroke-width="1.8"/>
        <circle cx="12" cy="11.5" r="4.5" fill="#ffffff"/>
      </svg>`;
    } else if (kind === 'star') {
      size = [32, 32];
      anchor = [16, 16];
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.6));">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${safeColor}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>`;
    } else if (kind === 'arrow') {
      size = [36, 36];
      anchor = [18, 18];
      const deg = Number(rotation) || 0;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36" style="transform: rotate(${deg}deg); filter: drop-shadow(0 2px 3px rgba(0,0,0,0.65));">
        <path d="M18 3 L30 22 L22 22 L22 33 L14 33 L14 22 L6 22 Z" fill="${safeColor}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      </svg>`;
    }

    return L.divIcon({
      className: 'map-drawer-div-icon',
      html: svg,
      iconSize: size,
      iconAnchor: anchor,
      popupAnchor: [0, -anchor[1] + 4]
    });
  }

  /**
   * Compute display measurement string for an item
   */
  static computeMeasureText(item) {
    if (!item) return '';
    if (item.kind === 'measure-line' || item.kind === 'polyline') {
      const dist = ProjectMapDrawer.polylineDistance(item.latlngs || []);
      return ProjectMapDrawer.formatDistance(dist);
    }
    if (item.kind === 'measure-area' || item.kind === 'polygon' || item.kind === 'rectangle') {
      const pts = Array.isArray(item.latlngs) && Array.isArray(item.latlngs[0]) && Array.isArray(item.latlngs[0][0])
        ? item.latlngs[0]
        : (item.latlngs || []);
      const area = ProjectMapDrawer.geodesicArea(pts);
      return ProjectMapDrawer.formatThaiArea(area);
    }
    if (item.kind === 'circle') {
      const r = Number(item.radius) || 0;
      const area = Math.PI * r * r;
      return `R: ${r.toFixed(1)} m | ${ProjectMapDrawer.formatThaiArea(area)}`;
    }
    if (item.kind === 'pin' || item.kind === 'arrow' || item.kind === 'star') {
      if (Array.isArray(item.center) && item.center.length === 2) {
        return `${Number(item.center[0]).toFixed(5)}, ${Number(item.center[1]).toFixed(5)}`;
      }
    }
    return '';
  }

  /**
   * Create a Leaflet layer from a serialized drawing item
   */
  static buildLeafletLayer(item, options = {}) {
    const color = item.color || '#ef4444';
    const interactive = options.interactive !== false;
    let layer = null;

    if (item.kind === 'pin' || item.kind === 'arrow' || item.kind === 'star') {
      if (!Array.isArray(item.center) || item.center.length < 2) return null;
      const icon = ProjectMapDrawer.createPresetIcon(item.kind, color, item.rotation || 0);
      layer = L.marker([item.center[0], item.center[1]], { icon, interactive });
    } else if (item.kind === 'circle') {
      if (!Array.isArray(item.center) || item.center.length < 2) return null;
      layer = L.circle([item.center[0], item.center[1]], {
        radius: Number(item.radius) || 50,
        color: color,
        weight: 3,
        fillColor: color,
        fillOpacity: 0.2,
        interactive
      });
    } else if (item.kind === 'measure-line' || item.kind === 'polyline') {
      if (!Array.isArray(item.latlngs) || item.latlngs.length < 2) return null;
      layer = L.polyline(item.latlngs, {
        color: color,
        weight: item.kind === 'measure-line' ? 4 : 3,
        dashArray: item.kind === 'measure-line' ? '8, 6' : null,
        interactive
      });
    } else if (item.kind === 'measure-area' || item.kind === 'polygon' || item.kind === 'rectangle') {
      if (!Array.isArray(item.latlngs) || item.latlngs.length < 3) return null;
      layer = L.polygon(item.latlngs, {
        color: color,
        weight: 3,
        dashArray: item.kind === 'measure-area' ? '6, 4' : null,
        fillColor: color,
        fillOpacity: 0.22,
        interactive
      });
    }

    if (layer) {
      layer._drawingId = item.id;
      const measureText = item.measureText || ProjectMapDrawer.computeMeasureText(item);
      const labelHtml = item.label ? `<strong>${ProjectMapDrawer.escapeHtml(item.label)}</strong>` : '';
      const measureHtml = measureText ? `<div style="font-size:11px;opacity:0.9;">${ProjectMapDrawer.escapeHtml(measureText)}</div>` : '';
      const prefix = options.projectPrefix ? `<div style="font-size:10px;font-weight:700;color:#10b981;">${ProjectMapDrawer.escapeHtml(options.projectPrefix)}</div>` : '';

      if (prefix || labelHtml || measureHtml) {
        const tipContent = `${prefix}${labelHtml}${measureHtml}`;
        layer.bindTooltip(tipContent, {
          permanent: !!options.permanentTooltip && (!!item.label || item.kind.startsWith('measure-')),
          direction: 'top',
          className: 'map-drawer-tooltip'
        });
        if (options.bindPopup) {
          layer.bindPopup(`<div style="min-width:160px;">${prefix}${labelHtml}${measureHtml}</div>`);
        }
      }
    }

    return layer;
  }

  static escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render saved drawings for a list of projects onto an overview/portfolio Leaflet LayerGroup
   */
  static renderProjectsDrawings(layerGroup, projects) {
    if (!layerGroup) return;
    layerGroup.clearLayers();
    (projects || []).forEach(p => {
      if (!Array.isArray(p.mapDrawings) || p.mapDrawings.length === 0) return;
      p.mapDrawings.forEach(item => {
        const layer = ProjectMapDrawer.buildLeafletLayer(item, {
          interactive: true,
          permanentTooltip: false,
          bindPopup: true,
          projectPrefix: `${p.code || ''} ${p.name || ''}`.trim()
        });
        if (layer) {
          layerGroup.addLayer(layer);
        }
      });
    });
  }

  /**
   * Compute LatLngBounds for a project's drawings without requiring a mounted map
   */
  static getDrawingsBounds(drawings) {
    if (!Array.isArray(drawings) || drawings.length === 0) return null;
    const bounds = L.latLngBounds([]);
    drawings.forEach(item => {
      if ((item.kind === 'pin' || item.kind === 'arrow' || item.kind === 'star') && Array.isArray(item.center) && item.center.length >= 2) {
        bounds.extend([Number(item.center[0]), Number(item.center[1])]);
      } else if (item.kind === 'circle' && Array.isArray(item.center) && item.center.length >= 2) {
        const lat = Number(item.center[0]);
        const lng = Number(item.center[1]);
        const r = Number(item.radius) || 50;
        const dLat = r / 111320;
        const dLng = r / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
        bounds.extend([lat - dLat, lng - dLng]);
        bounds.extend([lat + dLat, lng + dLng]);
      } else if (Array.isArray(item.latlngs)) {
        const pts = Array.isArray(item.latlngs[0]) && Array.isArray(item.latlngs[0][0])
          ? item.latlngs[0]
          : item.latlngs;
        pts.forEach(pt => {
          if (Array.isArray(pt) && pt.length >= 2) {
            bounds.extend([Number(pt[0]), Number(pt[1])]);
          }
        });
      }
    });
    return bounds.isValid() ? bounds : null;
  }

  /**
   * Open the Google Earth-style Map Drawing Studio Modal
   */
  open({ title, initialLat, initialLng, drawings, onSave, onUseCoords }) {
    this.items = JSON.parse(JSON.stringify(Array.isArray(drawings) ? drawings : []));
    this.onSaveCallback = onSave || null;
    this.onUseCoordsCallback = onUseCoords || null;
    this.activeTool = 'select';
    this._arrowStage = 0;
    this._clearArrowPreview();

    const modalEl = document.getElementById('mapDrawingModal');
    if (!modalEl) {
      alert('Map Drawing modal not found in DOM.');
      return;
    }

    const titleEl = document.getElementById('map-drawer-title');
    if (titleEl) titleEl.textContent = title || 'Map Studio';

    this._bindModalUi();
    this._pendingCenter = { lat: initialLat, lng: initialLng };

    if (!this.modalInstance) {
      this.modalInstance = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
      modalEl.addEventListener('shown.bs.modal', () => {
        this._initStudioMap();
      });
      modalEl.addEventListener('hidden.bs.modal', () => {
        this._teardownStudioMap();
      });
    }

    this.modalInstance.show();
  }

  _initStudioMap() {
    const cLat = this._pendingCenter && this._pendingCenter.lat;
    const cLng = this._pendingCenter && this._pendingCenter.lng;
    const hasCoords = cLat !== null && cLat !== undefined && cLng !== null && cLng !== undefined && !isNaN(cLat) && !isNaN(cLng);
    const center = hasCoords ? [Number(cLat), Number(cLng)] : [13.7563, 100.5018];
    const zoom = hasCoords ? 17 : 6;

    const container = document.getElementById('map-drawer-canvas');
    if (!container) return;

    if (this.map) {
      try { this.map.remove(); } catch (e) {}
      this.map = null;
    }

    const satelliteLayer = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      })
    ]);

    const streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    });

    this.map = L.map(container, {
      center,
      zoom,
      layers: [satelliteLayer],
      zoomControl: true
    });

    this.map.getContainer().classList.add('map-satellite-active');

    L.control.layers(
      { 'Satellite (ดาวเทียม)': satelliteLayer, 'Street Map (ถนน)': streetLayer },
      null,
      { position: 'topright', collapsed: false }
    ).addTo(this.map);

    this.map.on('baselayerchange', (e) => {
      const isSat = e.name.indexOf('Satellite') !== -1;
      this.map.getContainer().classList.toggle('map-satellite-active', isSat);
    });

    if (hasCoords) {
      L.circleMarker(center, {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 1
      }).addTo(this.map).bindTooltip('พิกัดโครงการ (Project Coords)', { direction: 'top' });
    }

    this.drawnGroup = new L.FeatureGroup().addTo(this.map);
    this._renderAllItems();

    const existingBounds = ProjectMapDrawer.getDrawingsBounds(this.items);
    if (existingBounds) {
      this.map.fitBounds(existingBounds, { padding: [50, 50], maxZoom: 18 });
    }

    if (this.map.pm) {
      this.map.pm.setGlobalOptions({
        layerGroup: this.drawnGroup,
        templineStyle: { color: this.activeColor, dashArray: '6, 4' },
        hintlineStyle: { color: this.activeColor, dashArray: '5, 5' },
        pathOptions: { color: this.activeColor, fillColor: this.activeColor, fillOpacity: 0.22, weight: 3 }
      });
    }

    this.map.on('pm:create', (e) => this._handlePmCreate(e));
    this.map.on('pm:remove', (e) => this._handlePmRemove(e));
    this.map.on('pm:drawstart', (e) => this._handleDrawStart(e));
    this.map.on('pm:drawend', () => this._clearLiveTooltip());
    this.map.on('click', (e) => this._handleMapClick(e));
    this.map.on('mousemove', (e) => this._handleMapMouseMove(e));

    const coordsReadout = document.getElementById('map-drawer-cursor-coords');
    if (coordsReadout) {
      this.map.on('mousemove', (e) => {
        coordsReadout.textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      });
    }

    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 220);

    this._setActiveTool('select');
    this._renderLayersPanel();
  }

  _teardownStudioMap() {
    this._clearArrowPreview();
    this._clearLiveTooltip();
    if (this.map) {
      try { this.map.remove(); } catch (e) {}
      this.map = null;
    }
    this.drawnGroup = null;
  }

  _renderAllItems() {
    if (!this.drawnGroup) return;
    this.drawnGroup.clearLayers();

    this.items.forEach(item => {
      item.measureText = ProjectMapDrawer.computeMeasureText(item);
      const layer = ProjectMapDrawer.buildLeafletLayer(item, {
        interactive: true,
        permanentTooltip: this.showLabels,
        bindPopup: false
      });
      if (layer) {
        this._attachLayerEditHooks(layer, item);
        this.drawnGroup.addLayer(layer);
      }
    });
  }

  _attachLayerEditHooks(layer, item) {
    layer.on('pm:edit', () => {
      this._syncItemFromLayer(item, layer);
      this._renderLayersPanel();
      this._refreshLayerTooltip(layer, item);
    });
    layer.on('pm:dragend', () => {
      this._syncItemFromLayer(item, layer);
      this._renderLayersPanel();
      this._refreshLayerTooltip(layer, item);
    });
    layer.on('click', () => {
      if (this.activeTool === 'select') {
        this._highlightListItem(item.id);
      }
    });
  }

  _refreshLayerTooltip(layer, item) {
    const measureText = ProjectMapDrawer.computeMeasureText(item);
    item.measureText = measureText;
    const labelHtml = item.label ? `<strong>${ProjectMapDrawer.escapeHtml(item.label)}</strong>` : '';
    const measureHtml = measureText ? `<div style="font-size:11px;opacity:0.9;">${ProjectMapDrawer.escapeHtml(measureText)}</div>` : '';
    if (labelHtml || measureHtml) {
      layer.unbindTooltip();
      layer.bindTooltip(`${labelHtml}${measureHtml}`, {
        permanent: this.showLabels && (!!item.label || item.kind.startsWith('measure-')),
        direction: 'top',
        className: 'map-drawer-tooltip'
      });
    }
  }

  _syncItemFromLayer(item, layer) {
    if (layer instanceof L.Marker) {
      const ll = layer.getLatLng();
      item.center = [Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6))];
    } else if (layer instanceof L.Circle) {
      const ll = layer.getLatLng();
      item.center = [Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6))];
      item.radius = Number(layer.getRadius().toFixed(2));
    } else if (layer instanceof L.Polygon) {
      const raw = layer.getLatLngs();
      const ring = Array.isArray(raw[0]) ? raw[0] : raw;
      item.latlngs = ring.map(p => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]);
    } else if (layer instanceof L.Polyline) {
      const pts = layer.getLatLngs();
      item.latlngs = pts.map(p => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]);
    }
    item.measureText = ProjectMapDrawer.computeMeasureText(item);
  }

  _handleDrawStart(e) {
    this._drawPoints = [];
    const workingLayer = e.workingLayer;
    if (!workingLayer) return;

    workingLayer.on('pm:vertexadded', (ev) => {
      if (ev.latlng) {
        this._drawPoints.push(ev.latlng);
      }
    });
  }

  _handleMapMouseMove(e) {
    if (this.activeTool === 'measure-line' || this.activeTool === 'polyline' || this.activeTool === 'measure-area' || this.activeTool === 'polygon') {
      if (this._drawPoints.length >= 1) {
        const pts = [...this._drawPoints, e.latlng];
        let text = '';
        if (this.activeTool === 'measure-line' || this.activeTool === 'polyline') {
          text = `ระยะทาง: ${ProjectMapDrawer.formatDistance(ProjectMapDrawer.polylineDistance(pts))}`;
        } else if (pts.length >= 3) {
          text = `พื้นที่: ${ProjectMapDrawer.formatThaiArea(ProjectMapDrawer.geodesicArea(pts))}`;
        } else {
          text = `ระยะ: ${ProjectMapDrawer.formatDistance(ProjectMapDrawer.polylineDistance(pts))}`;
        }
        this._showLiveTooltip(e.latlng, text);
      }
    }

    if (this.activeTool === 'arrow' && this._arrowStage === 1 && this._arrowStart) {
      const deg = this._computeBearing(this._arrowStart, e.latlng);
      if (this._arrowPreviewLayer) {
        this._arrowPreviewLayer.setIcon(ProjectMapDrawer.createPresetIcon('arrow', this.activeColor, deg));
      }
      this._showLiveTooltip(e.latlng, `ทิศลูกศร: ${Math.round(deg)}° (คลิกอีกครั้งเพื่อวาง)`);
    }
  }

  _handleMapClick(e) {
    if (this.activeTool === 'pin' || this.activeTool === 'star') {
      const kind = this.activeTool;
      const defaultLabel = kind === 'pin' ? `จุดปักหมุด ${this.items.length + 1}` : `จุดสำคัญ ${this.items.length + 1}`;
      const newItem = {
        id: 'D-' + Date.now() + Math.floor(Math.random() * 100),
        kind,
        label: defaultLabel,
        color: this.activeColor,
        center: [Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))],
        measureText: ''
      };
      newItem.measureText = ProjectMapDrawer.computeMeasureText(newItem);
      this.items.push(newItem);
      this._renderAllItems();
      this._renderLayersPanel();
      return;
    }

    if (this.activeTool === 'arrow') {
      if (this._arrowStage === 0) {
        this._arrowStage = 1;
        this._arrowStart = e.latlng;
        this._arrowPreviewLayer = L.marker(e.latlng, {
          icon: ProjectMapDrawer.createPresetIcon('arrow', this.activeColor, 0),
          interactive: false
        }).addTo(this.map);
        this._showLiveTooltip(e.latlng, 'ขยับเมาส์เพื่อหมุนทิศ แล้วคลิกยืนยัน');
      } else if (this._arrowStage === 1 && this._arrowStart) {
        const deg = Math.round(this._computeBearing(this._arrowStart, e.latlng));
        const newItem = {
          id: 'D-' + Date.now() + Math.floor(Math.random() * 100),
          kind: 'arrow',
          label: `ลูกศรชี้ ${this.items.length + 1}`,
          color: this.activeColor,
          rotation: deg,
          center: [Number(this._arrowStart.lat.toFixed(6)), Number(this._arrowStart.lng.toFixed(6))],
          measureText: ''
        };
        newItem.measureText = ProjectMapDrawer.computeMeasureText(newItem);
        this._clearArrowPreview();
        this._clearLiveTooltip();
        this.items.push(newItem);
        this._renderAllItems();
        this._renderLayersPanel();
      }
    }
  }

  _computeBearing(fromLatLng, toLatLng) {
    const d2r = Math.PI / 180;
    const lat1 = fromLatLng.lat * d2r;
    const lat2 = toLatLng.lat * d2r;
    const dLng = (toLatLng.lng - fromLatLng.lng) * d2r;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  _clearArrowPreview() {
    this._arrowStage = 0;
    this._arrowStart = null;
    if (this._arrowPreviewLayer && this.map) {
      try { this.map.removeLayer(this._arrowPreviewLayer); } catch (e) {}
    }
    this._arrowPreviewLayer = null;
  }

  _showLiveTooltip(latlng, text) {
    if (!this.map) return;
    if (!this._liveTooltip) {
      this._liveTooltip = L.tooltip({ permanent: true, direction: 'right', offset: [14, 0], className: 'map-drawer-live-tip' })
        .setLatLng(latlng)
        .setContent(text)
        .addTo(this.map);
    } else {
      this._liveTooltip.setLatLng(latlng).setContent(text);
    }
  }

  _clearLiveTooltip() {
    this._drawPoints = [];
    if (this._liveTooltip && this.map) {
      try { this.map.removeLayer(this._liveTooltip); } catch (e) {}
    }
    this._liveTooltip = null;
  }

  _handlePmCreate(e) {
    this._clearLiveTooltip();
    const layer = e.layer;
    if (this.drawnGroup && this.drawnGroup.hasLayer(layer)) {
      this.drawnGroup.removeLayer(layer);
    }
    if (this.map && this.map.hasLayer(layer)) {
      this.map.removeLayer(layer);
    }

    const kindMap = {
      'measure-line': 'measure-line',
      'polyline': 'polyline',
      'measure-area': 'measure-area',
      'polygon': 'polygon',
      'rectangle': 'rectangle',
      'circle': 'circle'
    };
    const kind = kindMap[this.activeTool] || (e.shape ? e.shape.toLowerCase() : 'polygon');

    const defaultLabels = {
      'measure-line': `วัดระยะ ${this.items.length + 1}`,
      'measure-area': `วัดพื้นที่ ${this.items.length + 1}`,
      'polyline': `เส้นทาง ${this.items.length + 1}`,
      'polygon': `พื้นที่ ${this.items.length + 1}`,
      'rectangle': `ขอบเขตสี่เหลี่ยม ${this.items.length + 1}`,
      'circle': `รัศมีวงกลม ${this.items.length + 1}`
    };

    const newItem = {
      id: 'D-' + Date.now() + Math.floor(Math.random() * 100),
      kind,
      label: defaultLabels[kind] || `Shape ${this.items.length + 1}`,
      color: this.activeColor
    };

    this._syncItemFromLayer(newItem, layer);
    this.items.push(newItem);
    this._renderAllItems();
    this._renderLayersPanel();
  }

  _handlePmRemove(e) {
    const id = e.layer && e.layer._drawingId;
    if (id) {
      this.items = this.items.filter(item => item.id !== id);
      this._renderLayersPanel();
    }
  }

  _setActiveTool(toolName) {
    this.activeTool = toolName;
    this._clearArrowPreview();
    this._clearLiveTooltip();

    if (this.map && this.map.pm) {
      this.map.pm.disableDraw();
      this.map.pm.disableGlobalEditMode();
      this.map.pm.disableGlobalDragMode();
      this.map.pm.disableGlobalRemovalMode();

      const styleOpts = {
        templineStyle: { color: this.activeColor, dashArray: toolName.startsWith('measure-') ? '8, 6' : null, weight: 3 },
        hintlineStyle: { color: this.activeColor, dashArray: '5, 5', weight: 2 },
        pathOptions: {
          color: this.activeColor,
          fillColor: this.activeColor,
          fillOpacity: 0.22,
          weight: 3,
          dashArray: toolName.startsWith('measure-') ? '6, 4' : null
        }
      };
      this.map.pm.setGlobalOptions({ layerGroup: this.drawnGroup, ...styleOpts });

      if (toolName === 'measure-line' || toolName === 'polyline') {
        this.map.pm.enableDraw('Line', styleOpts);
      } else if (toolName === 'measure-area' || toolName === 'polygon') {
        this.map.pm.enableDraw('Polygon', styleOpts);
      } else if (toolName === 'rectangle') {
        this.map.pm.enableDraw('Rectangle', styleOpts);
      } else if (toolName === 'circle') {
        this.map.pm.enableDraw('Circle', styleOpts);
      } else if (toolName === 'edit') {
        this.map.pm.enableGlobalEditMode();
      } else if (toolName === 'drag') {
        this.map.pm.enableGlobalDragMode();
      } else if (toolName === 'remove') {
        this.map.pm.enableGlobalRemovalMode();
      }
    }

    const container = this.map ? this.map.getContainer() : null;
    if (container) {
      container.style.cursor = (toolName === 'pin' || toolName === 'arrow' || toolName === 'star') ? 'crosshair' : '';
    }

    document.querySelectorAll('#map-drawer-toolbar [data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === toolName);
    });
  }

  _bindModalUi() {
    if (this._uiBound) return;
    this._uiBound = true;

    const toolbar = document.getElementById('map-drawer-toolbar');
    if (toolbar) {
      toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tool]');
        if (btn) {
          this._setActiveTool(btn.getAttribute('data-tool'));
        }
      });
    }

    const colorInput = document.getElementById('map-drawer-color');
    if (colorInput) {
      colorInput.addEventListener('input', (e) => {
        this.activeColor = e.target.value;
        document.querySelectorAll('.map-drawer-swatch').forEach(s => s.classList.remove('active'));
        this._setActiveTool(this.activeTool);
      });
    }

    document.querySelectorAll('.map-drawer-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const c = swatch.getAttribute('data-color');
        if (c) {
          this.activeColor = c;
          if (colorInput) colorInput.value = c;
          document.querySelectorAll('.map-drawer-swatch').forEach(s => s.classList.toggle('active', s === swatch));
          this._setActiveTool(this.activeTool);
        }
      });
    });

    const toggleLabelsBtn = document.getElementById('map-drawer-toggle-labels');
    if (toggleLabelsBtn) {
      toggleLabelsBtn.addEventListener('click', () => {
        this.showLabels = !this.showLabels;
        toggleLabelsBtn.classList.toggle('active', this.showLabels);
        this._renderAllItems();
      });
    }

    const clearBtn = document.getElementById('map-drawer-clear-all');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (this.items.length === 0) return;
        if (confirm('ต้องการลบสิ่งที่วาดบนแผนที่ทั้งหมดใช่หรือไม่?')) {
          this.items = [];
          this._renderAllItems();
          this._renderLayersPanel();
        }
      });
    }

    const searchInp = document.getElementById('map-drawer-search-input');
    const searchBtn = document.getElementById('map-drawer-search-btn');
    const runSearch = () => {
      if (!searchInp || !this.map) return;
      const q = searchInp.value.trim();
      if (!q) return;
      if (window.app && typeof window.app.parseCoordinates === 'function') {
        const { lat, lng } = window.app.parseCoordinates(q, q);
        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
          this.map.setView([lat, lng], 17);
          return;
        }
      }
      fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            this.map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
          } else {
            alert('ไม่พบสถานที่หรือพิกัดที่ค้นหา');
          }
        })
        .catch(() => alert('ค้นหาสถานที่ล้มเหลว'));
    };
    if (searchBtn) searchBtn.addEventListener('click', runSearch);
    if (searchInp) {
      searchInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runSearch();
        }
      });
    }

    const useCenterBtn = document.getElementById('map-drawer-use-center-btn');
    if (useCenterBtn) {
      useCenterBtn.addEventListener('click', () => {
        if (!this.map) return;
        let target = this.map.getCenter();
        const b = ProjectMapDrawer.getDrawingsBounds(this.items);
        if (b) target = b.getCenter();
        const lat = Number(target.lat.toFixed(6));
        const lng = Number(target.lng.toFixed(6));
        if (this.onUseCoordsCallback) {
          this.onUseCoordsCallback(lat, lng);
        }
        alert(`นำพิกัด ${lat}, ${lng} ไปกรอกในช่องพิกัดโครงการเรียบร้อยแล้ว`);
      });
    }

    const saveBtn = document.getElementById('map-drawer-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (this.map && this.map.pm) {
          this.map.pm.disableDraw();
          this.map.pm.disableGlobalEditMode();
          this.map.pm.disableGlobalDragMode();
          this.map.pm.disableGlobalRemovalMode();
        }
        const savedCopy = JSON.parse(JSON.stringify(this.items));
        const bounds = ProjectMapDrawer.getDrawingsBounds(savedCopy);
        const centerCoords = bounds ? bounds.getCenter() : null;

        if (this.onSaveCallback) {
          this.onSaveCallback(savedCopy, centerCoords);
        }
        if (this.modalInstance) this.modalInstance.hide();
      });
    }
  }

  _renderLayersPanel() {
    const listEl = document.getElementById('map-drawer-layers-list');
    const countEl = document.getElementById('map-drawer-layers-count');
    if (countEl) countEl.textContent = String(this.items.length);
    if (!listEl) return;

    if (this.items.length === 0) {
      listEl.innerHTML = `
        <div class="text-center text-muted py-4 px-2" style="font-size: 12px;">
          <i class="fas fa-draw-polygon fa-2x mb-2 opacity-50"></i>
          <div>ยังไม่มีการวาดลงแผนที่</div>
          <div style="font-size: 11px;">เลือกเครื่องมือด้านบนเพื่อวัดระยะ วัดพื้นที่ วาดรูปทรง หรือปักไอคอน</div>
        </div>
      `;
      return;
    }

    const kindIcons = {
      'measure-line': 'fa-ruler',
      'measure-area': 'fa-ruler-combined',
      'polyline': 'fa-wave-square',
      'polygon': 'fa-draw-polygon',
      'rectangle': 'fa-vector-square',
      'circle': 'fa-circle',
      'pin': 'fa-map-pin',
      'arrow': 'fa-location-arrow',
      'star': 'fa-star'
    };

    listEl.innerHTML = '';
    this.items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'map-drawer-layer-card p-2 mb-2 rounded-2 border';
      card.setAttribute('data-layer-id', item.id);

      const iconCls = kindIcons[item.kind] || 'fa-shapes';
      const measureText = item.measureText || ProjectMapDrawer.computeMeasureText(item);

      card.innerHTML = `
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="d-inline-flex align-items-center justify-content-center rounded-circle" style="width: 24px; height: 24px; background: ${item.color}22; color: ${item.color}; flex-shrink: 0;">
            <i class="fas ${iconCls}" style="font-size: 11px;"></i>
          </span>
          <input type="text" class="form-control form-control-sm map-drawer-item-label fw-semibold" value="${ProjectMapDrawer.escapeHtml(item.label || '')}" placeholder="ชื่อ/คำอธิบาย..." style="font-size: 12px; padding: 2px 6px;">
          <input type="color" class="form-control form-control-color map-drawer-item-color" value="${item.color || '#ef4444'}" title="เปลี่ยนสี" style="width: 26px; height: 26px; padding: 1px; flex-shrink: 0;">
        </div>
        <div class="d-flex justify-content-between align-items-center mt-1" style="font-size: 11px;">
          <span class="text-muted text-truncate pe-2" title="${ProjectMapDrawer.escapeHtml(measureText)}">${ProjectMapDrawer.escapeHtml(measureText || item.kind)}</span>
          <div class="d-flex gap-1 flex-shrink-0">
            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1 map-drawer-zoom-item" title="ซูมไปยังรายการนี้"><i class="fas fa-crosshairs" style="font-size: 10px;"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger py-0 px-1 map-drawer-del-item" title="ลบรายการนี้"><i class="fas fa-trash-alt" style="font-size: 10px;"></i></button>
          </div>
        </div>
        ${item.kind === 'arrow' ? `
        <div class="d-flex align-items-center gap-2 mt-2 pt-1 border-top" style="font-size: 11px;">
          <span class="text-muted">มุมลูกศร:</span>
          <input type="range" class="form-range map-drawer-arrow-rot" min="0" max="359" value="${Number(item.rotation) || 0}" style="flex: 1;">
          <span class="map-drawer-arrow-deg fw-bold" style="width: 34px; text-align: right;">${Number(item.rotation) || 0}°</span>
        </div>` : ''}
      `;

      const labelInp = card.querySelector('.map-drawer-item-label');
      labelInp.addEventListener('input', (ev) => {
        item.label = ev.target.value;
        this._updateSingleLayerById(item.id);
      });

      const colorInp = card.querySelector('.map-drawer-item-color');
      colorInp.addEventListener('input', (ev) => {
        item.color = ev.target.value;
        this._renderAllItems();
        const badge = card.querySelector('span.rounded-circle');
        if (badge) {
          badge.style.background = `${item.color}22`;
          badge.style.color = item.color;
        }
      });

      const rotRange = card.querySelector('.map-drawer-arrow-rot');
      const rotText = card.querySelector('.map-drawer-arrow-deg');
      if (rotRange) {
        rotRange.addEventListener('input', (ev) => {
          item.rotation = Number(ev.target.value);
          if (rotText) rotText.textContent = `${item.rotation}°`;
          this._renderAllItems();
        });
      }

      card.querySelector('.map-drawer-zoom-item').addEventListener('click', () => {
        this._zoomToItem(item);
      });

      card.querySelector('.map-drawer-del-item').addEventListener('click', () => {
        this.items.splice(idx, 1);
        this._renderAllItems();
        this._renderLayersPanel();
      });

      listEl.appendChild(card);
    });
  }

  _updateSingleLayerById(id) {
    if (!this.drawnGroup) return;
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    this.drawnGroup.eachLayer(layer => {
      if (layer._drawingId === id) {
        this._refreshLayerTooltip(layer, item);
      }
    });
  }

  _highlightListItem(id) {
    const el = document.querySelector(`[data-layer-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.classList.add('border-success');
      setTimeout(() => el.classList.remove('border-success'), 1200);
    }
  }

  _zoomToItem(item) {
    if (!this.map) return;
    if (Array.isArray(item.center) && item.center.length === 2 && item.kind !== 'circle') {
      this.map.setView([item.center[0], item.center[1]], 18);
      return;
    }
    const b = ProjectMapDrawer.getDrawingsBounds([item]);
    if (b) {
      this.map.fitBounds(b, { padding: [60, 60], maxZoom: 18 });
    }
  }
}

window.ProjectMapDrawer = ProjectMapDrawer;
window.mapDrawer = new ProjectMapDrawer();
