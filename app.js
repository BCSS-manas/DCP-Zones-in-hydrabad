/**
 * Telangana Police Commissionerate Map — Core Logic
 * Refactored into modular components for better maintainability.
 */

const App = {
    state: {
        config: null,
        geoData: null,
        policeData: null, // Full hierarchy from data.json
        currentFilter: 'all',
        theme: 'dark'
    },

    async init() {
        console.log('App Initializing...');
        this.UI.showLoader();
        
        try {
            await this.DataManager.loadAll();
            this.ThemeManager.init();
            this.MapManager.init();
            this.SearchEngine.init();
            this.UI.init();
            
            console.log('App Ready.');
        } catch (error) {
            console.error('Initialization failed:', error);
            this.UI.showError('Failed to load application data. Please refresh.');
        } finally {
            this.UI.hideLoader();
        }
    }
};

// ────────────────────────────────────────────────────────────
// DATA MANAGER: Handles fetching and parsing
// ────────────────────────────────────────────────────────────
App.DataManager = {
    async loadAll() {
        const [config, geo, police] = await Promise.all([
            fetch('config.json').then(r => r.json()),
            fetch('geo.json').then(r => r.json()),
            fetch('data.json').then(r => r.json())
        ]);

        App.state.config = config;
        App.state.geoData = geo;
        App.state.policeData = police;
    },

    norm(str) {
        if (!str) return 'Unknown';
        let n = str.trim().toLowerCase();
        // Manual mappings for known data inconsistencies
        if (n === 'malkajgiri' || n === 'rachakonda') return 'Rachakonda';
        if (n === 'cyberabad') return 'Cyberabad';
        if (n === 'hyderabad') return 'Hyderabad';
        if (n === 'futurecity' || n === 'future city') return 'FutureCity';
        if (n === 'warangal') return 'Warangal';
        if (n === 'karimnagar') return 'Karimnagar';
        if (n === 'khammam') return 'Khammam';
        if (n === 'nizamabad') return 'Nizamabad';
        if (n === 'ramagundam') return 'Ramagundam';
        if (n === 'siddipet') return 'Siddipet';
        
        // Default to Proper Case if not a known commissionerate
        return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    },

    dispName(key) {
        const normalized = this.norm(key);
        return App.state.config.COMM_DISPLAY[normalized] || normalized;
    },

    getColor(comm, district) {
        const normalized = this.norm(comm);
        if (App.state.config.COMM_COLORS[normalized]) {
            return App.state.config.COMM_COLORS[normalized];
        }
        
        // For Districts, use a hash based on the district name to ensure consistent but varied colors
        if (district) {
            let hash = 0;
            for (let i = 0; i < district.length; i++) {
                hash = district.charCodeAt(i) + ((hash << 5) - hash);
            }
            const h = Math.abs(hash) % 360;
            return `hsl(${h}, 50%, 45%)`;
        }
        
        return App.state.config.COMM_COLORS['Unknown'];
    }
};

// ────────────────────────────────────────────────────────────
// THEME MANAGER
// ────────────────────────────────────────────────────────────
App.ThemeManager = {
    TILE_DARK: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    TILE_LIGHT: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',

    init() {
        const saved = localStorage.getItem('ts-police-theme');
        if (saved) {
            App.state.theme = saved;
            document.documentElement.setAttribute('data-theme', saved);
        }
    },

    toggle() {
        const next = App.state.theme === 'dark' ? 'light' : 'dark';
        App.state.theme = next;
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('ts-police-theme', next);
        App.MapManager.updateTileLayer();
        App.MapManager.refreshGeoLayer();
    }
};

// ────────────────────────────────────────────────────────────
// MAP MANAGER: Leaflet logic
// ────────────────────────────────────────────────────────────
App.MapManager = {
    map: null,
    geoLayer: null,
    tileLayer: null,

    init() {
        const { MAP_CENTER, DEFAULT_ZOOM } = App.state.config;
        this.map = L.map('map', {
            center: MAP_CENTER,
            zoom: DEFAULT_ZOOM,
            zoomControl: true,
            zoomSnap: 0.5,
            zoomDelta: 0.5
        });

        this.updateTileLayer();
        this.addHomeControl();
        this.addLocateControl();
        this.renderGeoData();
    },

    addLocateControl() {
        const LocateControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate-ctrl');
                const btn = L.DomUtil.create('a', 'locate-btn', container);
                btn.href = '#';
                btn.title = 'Find My Nearest Police Station';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
                L.DomEvent.on(btn, 'click', (e) => {
                    L.DomEvent.preventDefault(e);
                    this.locateUser();
                });
                return container;
            }
        });
        this.map.addControl(new LocateControl());
    },

    locateUser() {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }

        App.UI.showLoader();
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                this.findNearestPS(lat, lng);
                App.UI.hideLoader();
            },
            (err) => {
                console.error(err);
                alert('Unable to retrieve your location');
                App.UI.hideLoader();
            }
        );
    },

    findNearestPS(lat, lng) {
        const userLoc = L.latLng(lat, lng);
        
        // Add a temporary marker for the user
        if (this.userMarker) this.map.removeLayer(this.userMarker);
        this.userMarker = L.circleMarker(userLoc, {
            radius: 8,
            fillColor: '#58a6ff',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(this.map).bindPopup("You are here").openPopup();

        // Find nearest feature in GeoJSON
        let nearest = null;
        let minDist = Infinity;

        this.geoLayer.eachLayer(layer => {
            const bounds = layer.getBounds();
            const center = bounds.getCenter();
            const dist = userLoc.distanceTo(center);
            
            if (dist < minDist) {
                minDist = dist;
                nearest = layer;
            }
        });

        if (nearest) {
            this.map.fitBounds(nearest.getBounds(), { padding: [40, 40] });
            this.highlightFeature(nearest);
            const props = nearest.feature.properties;
            App.UI.buildInfoPanel(props.commissionerate);
            
            const distKm = (minDist / 1000).toFixed(1);
            alert(`Nearest Police Station: ${props.ps_name || 'District Station'} (approx. ${distKm} km away)`);
        }
    },

    updateTileLayer() {
        const url = App.state.theme === 'light' ? App.ThemeManager.TILE_LIGHT : App.ThemeManager.TILE_DARK;
        if (this.tileLayer) this.map.removeLayer(this.tileLayer);
        this.tileLayer = L.tileLayer(url, {
            attribution: '&copy; OpenStreetMap &copy; CARTO | TS Police Official Data',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(this.map);
    },

    addHomeControl() {
        const HomeControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control home-reset-ctrl');
                const btn = L.DomUtil.create('a', 'home-reset-btn', container);
                btn.href = '#';
                btn.title = 'Reset Map';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>';
                L.DomEvent.on(btn, 'click', (e) => {
                    L.DomEvent.preventDefault(e);
                    this.resetView();
                });
                return container;
            }
        });
        this.map.addControl(new HomeControl());
    },

    resetView() {
        this.map.fitBounds(App.state.config.TELANGANA_BOUNDS);
        App.UI.resetInfoBox();
        if (this.geoLayer) this.geoLayer.eachLayer(l => this.geoLayer.resetStyle(l));
    },

    renderGeoData() {
        if (this.geoLayer) this.map.removeLayer(this.geoLayer);
        
        this.geoLayer = L.geoJSON(App.state.geoData, {
            style: (f) => this.getStyle(f),
            filter: (f) => this.filterFeature(f),
            onEachFeature: (f, layer) => {
                const p = f.properties;
                layer.bindTooltip(App.UI.buildTooltip(p), { sticky: true, direction: 'top', offset: [0, -8] });
                layer.on({
                    mouseover: (e) => this.highlightFeature(e.target),
                    mouseout: (e) => this.geoLayer.resetStyle(e.target),
                    click: (e) => this.onFeatureClick(e)
                });
            }
        }).addTo(this.map);
    },

    getStyle(f) {
        const p = f.properties;
        const color = p.color || App.DataManager.getColor(p.commissionerate, p.district);
        const isComm = p.commissionerate !== 'District_PS' && p.commissionerate !== 'Unknown';
        const isDark = App.state.theme === 'dark';
        
        // Enhance visibility
        let fillOp = isComm ? (isDark ? 0.35 : 0.25) : (isDark ? 0.2 : 0.15);
        if (App.state.currentFilter === 'dist' && !isComm) fillOp = isDark ? 0.3 : 0.25;

        return {
            fillColor: color,
            fillOpacity: fillOp,
            color: color,
            weight: isComm ? 1.5 : 0.8,
            opacity: isComm ? 1 : 0.6
        };
    },

    highlightFeature(layer) {
        layer.setStyle({ weight: 3, fillOpacity: 0.5, opacity: 1 });
        if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) layer.bringToFront();
    },

    onFeatureClick(e) {
        const props = e.target.feature.properties;
        App.UI.buildInfoPanel(props.commissionerate);
        this.map.fitBounds(e.target.getBounds(), { padding: [40, 40], maxZoom: 13 });
    },

    filterFeature(f) {
        const c = f.properties.commissionerate;
        const filter = App.state.currentFilter;
        if (filter === 'comm') return c !== 'District_PS' && c !== 'Unknown';
        if (filter === 'dist') return c === 'District_PS';
        return true;
    },

    refreshGeoLayer() {
        if (this.geoLayer) this.renderGeoData();
    },

    zoomToComm(name) {
        if (!this.geoLayer) return;
        const bounds = L.latLngBounds([]);
        this.geoLayer.eachLayer(l => {
            if (l.feature && App.DataManager.norm(l.feature.properties.commissionerate) === App.DataManager.norm(name)) bounds.extend(l.getBounds());
        });
        if (bounds.isValid()) {
            this.map.fitBounds(bounds, { padding: [40, 40] });
            App.UI.buildInfoPanel(name);
        }
    }
};

// ────────────────────────────────────────────────────────────
// UI MANAGER: Handles all DOM manipulation
// ────────────────────────────────────────────────────────────
App.UI = {
    init() {
        this.buildAnalyticsDashboard();
        this.buildLegend();
        this.buildHierarchicalSidebar();
        this.buildSpecDepts();
        this.setupFilterTabs();
    },

    buildAnalyticsDashboard() {
        const sbBody = document.querySelector('.sb-body');
        if (!sbBody) return;
        
        // Remove existing if any
        const existing = sbBody.querySelector('.analytics-row');
        if (existing) existing.remove();

        const comms = new Set(App.state.policeData.map(d => App.DataManager.norm(d.commissionerate)));
        const stats = {
            units: App.state.policeData.length,
            comms: comms.size,
            districts: new Set(App.state.geoData.features.map(f => f.properties.district)).size
        };

        const html = `
            <div class="analytics-row">
                <div class="stat-card">
                    <div class="stat-val">${stats.units}</div>
                    <div class="stat-lbl">Police Units</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${stats.comms}</div>
                    <div class="stat-lbl">Comm'rates</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${stats.districts}</div>
                    <div class="stat-lbl">Districts</div>
                </div>
            </div>
        `;
        sbBody.insertAdjacentHTML('afterbegin', html);

        // Update footer stats
        const elComms = document.getElementById('stat-comms');
        const elPS = document.getElementById('stat-ps');
        const elSpec = document.getElementById('stat-spec');
        
        if (elComms) elComms.textContent = stats.comms;
        if (elPS) elPS.textContent = stats.units + '+';
        if (elSpec) elSpec.textContent = Object.keys(App.state.config.OFFICERS.Special_Departments || {}).length;
    },


    buildHierarchicalSidebar() {
        const container = document.getElementById('leg-comm-list');
        if (!container) return;
        container.innerHTML = ''; // Clear previous

        // Group data with normalization
        const hierarchy = {};
        App.state.policeData.forEach(item => {
            const comm = App.DataManager.norm(item.commissionerate);
            const zone = item.zone || 'General';
            const division = item.division || 'General';
            const ps = item.police_station;

            if (!hierarchy[comm]) hierarchy[comm] = {};
            if (!hierarchy[comm][zone]) hierarchy[comm][zone] = {};
            if (!hierarchy[comm][zone][division]) hierarchy[comm][zone][division] = [];
            hierarchy[comm][zone][division].push(ps);
        });

        const sortedComms = Object.keys(hierarchy).sort();
        
        let html = '<div class="hier-title">Organizational Structure</div>';
        
        sortedComms.forEach(commKey => {
            const data = hierarchy[commKey];
            const color = App.DataManager.getColor(commKey);
            const dispName = App.DataManager.dispName(commKey);

            html += `
                <details class="hier-comm">
                    <summary style="border-left: 3px solid ${color}">
                        <span class="hier-label">${dispName}</span>
                        <span class="hier-count">${Object.keys(data).length} Zones</span>
                    </summary>
                    <div class="hier-zones">
            `;

            Object.entries(data).sort().forEach(([zoneName, divisions]) => {
                html += `
                    <details class="hier-zone">
                        <summary>${zoneName}</summary>
                        <div class="hier-divs">
                `;

                Object.entries(divisions).sort().forEach(([divName, stations]) => {
                    html += `
                        <details class="hier-div">
                            <summary>${divName} (${stations.length} PS)</summary>
                            <div class="hier-ps-list">
                                ${stations.sort().map(s => `<div class="hier-ps-item" onclick="App.UI.zoomToPS('${s}', '${commKey}')">${s}</div>`).join('')}
                            </div>
                        </details>
                    `;
                });

                html += `</div></details>`;
            });

            html += `</div></details>`;
        });

        container.insertAdjacentHTML('afterbegin', html);
    },

    zoomToPS(psName, commKey) {
        if (!App.MapManager.geoLayer) return;
        let found = null;
        App.MapManager.geoLayer.eachLayer(l => {
            if (l.feature && l.feature.properties.ps_name && l.feature.properties.ps_name.toLowerCase() === psName.toLowerCase()) found = l;
        });

        if (found) {
            App.MapManager.map.fitBounds(found.getBounds(), { padding: [100, 100], maxZoom: 14 });
            App.MapManager.highlightFeature(found);
            App.UI.buildInfoPanel(commKey);
        } else {
            // If not in geojson, just show comm info
            App.MapManager.zoomToComm(commKey);
        }
    },

    showLoader() {
        // Simple loader overlay if exists
        const loader = document.getElementById('map-loader');
        if (loader) loader.style.display = 'flex';
    },

    hideLoader() {
        const loader = document.getElementById('map-loader');
        if (loader) loader.style.display = 'none';
    },

    showError(msg) {
        const wrap = document.getElementById('info-wrap');
        if (wrap) wrap.innerHTML = `<div class="error-msg">${msg}</div>`;
    },

    resetInfoBox() {
        const wrap = document.getElementById('info-wrap');
        if (wrap) wrap.innerHTML = '<p id="info-ph">Hover or click any coloured zone on the map to see CP, DCPs, and zone officers.<br><br>Click legend items to zoom into a commissionerate.</p>';
    },

    buildTooltip(p) {
        const comm = p.commissionerate;
        const info = App.state.config.OFFICERS[comm];
        if (!info) {
            return `<div class="tt-comm">${p.ps_name || 'District PS'}</div><div style="font-size:.65rem;color:var(--muted)">District: ${p.district || 'N/A'}</div>`;
        }
        const color = App.DataManager.getColor(comm);
        const zones = info.zones || [];
        const rows = zones.slice(0, 5).map(z => `
            <div class="tt-officer-row"><span class="tt-rank">${z.rank}</span><span style="font-weight:600">${z.officer}</span><span class="tt-zone"> · ${z.zone}</span></div>
        `).join('');

        return `
            <div class="tt-comm" style="color:${color}">${App.DataManager.dispName(comm)} Commissionerate</div>
            <div class="tt-cp"><b>CP:</b> ${info.cp || '—'}</div>
            <div class="tt-officers">${rows}${zones.length > 5 ? '<div class="tt-more">More info on click...</div>' : ''}</div>
            <div style="font-size:.6rem;color:var(--faint);margin-top:.3rem">${p.ps_name} | Click for details</div>`;
    },

    buildInfoPanel(comm) {
        const normalized = App.DataManager.norm(comm);
        const info = App.state.config.OFFICERS[normalized];
        if (!info) return;
        const color = App.DataManager.getColor(normalized);
        const ps = App.state.config.COMM_PS[normalized] || App.state.policeData.filter(d => App.DataManager.norm(d.commissionerate) === normalized).map(d => d.police_station) || [];
        const zones = info.zones || [];

        const zrows = zones.map(z => `
            <div class="zrow">
                <span class="zrank" style="background:${color}18;color:${color}">${z.rank}</span>
                <div>
                    <div class="zname">${z.officer}</div>
                    <div class="zofficer">${z.zone}</div>
                    <div class="zcovers">${z.covers}</div>
                </div>
            </div>`).join('');

        const psTags = ps.map(p => `<span class="ps-tag">${p}</span>`).join('');

        document.getElementById('info-wrap').innerHTML = `
            <div class="icard">
                <div class="icard-hdr" style="border-bottom:2px solid ${color}">
                    <div class="icard-dot" style="background:${color}"></div>
                    <div>
                        <div class="icard-comm">${App.DataManager.dispName(comm)}</div>
                        <div style="font-size:.65rem;color:var(--muted)">${ps.length} Police Stations</div>
                    </div>
                </div>
                <div class="icard-cp">
                    <div class="icard-cp-label">Commissioner of Police</div>
                    <div class="icard-cp-name">${info.cp || '—'}</div>
                </div>
                <div class="icard-zones">
                    <div class="zone-title">Key Officers</div>
                    ${zrows}
                </div>
                ${ps.length ? `<div class="ps-wrap"><div class="ps-title">Stations</div><div class="ps-cloud">${psTags}</div></div>` : ''}
                <div class="icard-footer">
                    <button class="nav-btn" onclick="window.open('https://www.google.com/maps/search/Police+Station+${App.DataManager.dispName(comm)}', '_blank')">
                        🌍 Navigate to CP Office
                    </button>
                </div>
            </div>`;

        document.getElementById('info-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    buildLegend() {
        const container = document.getElementById('leg-comm-list');
        if (!container) return;
        container.innerHTML = '';
        
        // Count PS per comm dynamically
        const counts = {};
        App.state.policeData.forEach(d => {
            const c = App.DataManager.norm(d.commissionerate);
            if (c === 'District_PS') return;
            counts[c] = (counts[c] || 0) + 1;
        });

        const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));

        sorted.forEach(([name, cnt]) => {
            const color = App.DataManager.getColor(name);
            const div = document.createElement('div');
            div.className = 'leg-item';
            div.innerHTML = `
                <div class="leg-swatch" style="background:${color}"></div>
                <span class="leg-label">${App.DataManager.dispName(name)}</span>
                <span class="leg-cnt">${cnt} PS</span>
            `;
            div.onclick = () => App.MapManager.zoomToComm(name);
            container.appendChild(div);
        });
    },

    buildSpecDepts() {
        const container = document.getElementById('spec-dept-list');
        if (!container) return;
        const sd = App.state.config.OFFICERS.Special_Departments;
        container.innerHTML = '';
        Object.entries(sd).forEach(([dept, d]) => {
            const div = document.createElement('div');
            div.className = 'spec-item';
            div.innerHTML = `<div class="spec-dept">${dept}</div><div class="spec-officer">${d.officer}</div><div class="spec-role">${d.role}</div>`;
            container.appendChild(div);
        });
    },

    setupFilterTabs() {
        document.querySelectorAll('.ftab').forEach(btn => {
            btn.onclick = (e) => {
                const type = e.target.id.replace('f-', '');
                App.state.currentFilter = type;
                document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                App.MapManager.refreshGeoLayer();
                
                const labels = { all: 'all layers', comm: 'commissionerates', dist: 'districts' };
                const labelEl = document.getElementById('showing-label');
                if (labelEl) labelEl.innerHTML = `Showing: <b>${labels[type]}</b>`;
            };
        });
    }
};

// ────────────────────────────────────────────────────────────
// SEARCH ENGINE: Fuzzy search across all entities
// ────────────────────────────────────────────────────────────
App.SearchEngine = {
    index: [],

    init() {
        this.buildIndex();
        this.setupEvents();
    },

    buildIndex() {
        const { OFFICERS } = App.state.config;
        this.index = [];

        // Add Stations from dynamic policeData
        App.state.policeData.forEach(item => {
            const comm = App.DataManager.norm(item.commissionerate);
            this.index.push({ 
                type: 'ps', 
                label: item.police_station, 
                comm: comm, 
                sub: `${App.DataManager.dispName(comm)} / ${item.division || 'General'}` 
            });
        });

        // Add Officers from config
        Object.entries(OFFICERS).forEach(([commKey, info]) => {
            const normComm = App.DataManager.norm(commKey);
            const dispComm = App.DataManager.dispName(normComm);

            if (commKey === 'Special_Departments') {
                Object.entries(info).forEach(([dept, d]) => {
                    this.index.push({ type: 'dept', label: d.officer, comm: null, sub: dept });
                });
            } else {
                if (info.cp) this.index.push({ type: 'officer', label: info.cp, comm: normComm, sub: `CP, ${dispComm}` });
                if (info.zones) {
                    info.zones.forEach(z => {
                        this.index.push({ type: 'officer', label: z.officer, comm: normComm, sub: `${z.zone}, ${dispComm}` });
                    });
                }
            }
        });

        // Add Commissionerates
        const uniqueComms = new Set(App.state.policeData.map(d => App.DataManager.norm(d.commissionerate)));
        uniqueComms.forEach(comm => {
            if (comm === 'District_PS') return;
            this.index.push({ type: 'comm', label: App.DataManager.dispName(comm), comm: comm, sub: 'Commissionerate' });
        });
    },

    setupEvents() {
        const input = document.getElementById('searchbox');
        const results = document.getElementById('search-results');
        if (!input || !results) return;

        input.oninput = (e) => {
            const q = e.target.value.trim().toLowerCase();
            if (q.length < 2) { results.style.display = 'none'; return; }

            const matches = this.index.filter(i => 
                i.label.toLowerCase().includes(q) || 
                i.sub.toLowerCase().includes(q)
            ).slice(0, 8);

            if (!matches.length) {
                results.innerHTML = '<div class="sr-item" style="color:var(--muted)">No results</div>';
            } else {
                const icons = { ps: '🚔', officer: '👤', comm: '🗺️', dept: '⭐' };
                results.innerHTML = matches.map((m, idx) => `
                    <div class="sr-item" onclick="App.SearchEngine.handleSelect(${idx})" data-idx="${idx}">
                        <span class="sr-icon">${icons[m.type]}</span>
                        <div style="flex:1">
                            <div style="font-weight:600">${m.label}</div>
                            <div style="font-size:.6rem;color:var(--muted)">${m.sub}</div>
                        </div>
                    </div>
                `).join('');
                this._currentMatches = matches;
            }
            results.style.display = 'block';
        };

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target)) results.style.display = 'none';
        });
    },

    handleSelect(idx) {
        const m = this._currentMatches[idx];
        if (!m) return;

        if (m.type === 'ps') {
            App.UI.zoomToPS(m.label, m.comm);
        } else if (m.comm) {
            App.MapManager.zoomToComm(m.comm);
        }
        
        document.getElementById('search-results').style.display = 'none';
        document.getElementById('searchbox').value = '';
    }
};

// ────────────────────────────────────────────────────────────
// GLOBAL HELPERS
// ────────────────────────────────────────────────────────────
function toggleTheme() { App.ThemeManager.toggle(); }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('closed'); }

// ────────────────────────────────────────────────────────────
// START APP
// ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => App.init());
//