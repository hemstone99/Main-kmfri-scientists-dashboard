import React, { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import {
  DatabaseState,
  User,
  ResearchLocation,
  Collaborator,
} from '../types/kmfri.ts';
import {
  generateUuid,
  getDirectorateById,
  appendAuditLog,
  SEED_KMFRI_STATIONS,
} from '../services/database.ts';
import { addKenyaBordersOverlay } from '../services/kenyaGeoJson.ts';
import { canManageLocations } from '../services/rbacPolicy.ts';
import {
  MapPin,
  CheckCircle2,
  AlertCircle,
  Compass,
  Layers,
  RotateCcw,
  Trash2,
  Lock,
} from 'lucide-react';
import { getUserRoleName } from '../services/rbacPolicy.ts';

interface GisAndCollaboratorsModulesProps {
  db: DatabaseState;
  currentUser: User;
  mode: 'locations' | 'collaborators';
  onUpdateDb: (next: DatabaseState) => void;
}

type BasemapStyle = 'voyager' | 'satellite' | 'dark';

const BASEMAP_TILES: Record<BasemapStyle, { url: string; attribution: string }> = {
  voyager: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO · KMFRI GIS',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics · KMFRI Marine GIS',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO Dark Matter · KMFRI GIS',
  },
};

const CORE_STATION_IDS = new Set(SEED_KMFRI_STATIONS.map((s) => s.id));

export const GisAndCollaboratorsModules: React.FC<GisAndCollaboratorsModulesProps> = ({
  db,
  currentUser,
  mode,
  onUpdateDb,
}) => {
  const [alertMsg, setAlertMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [basemapStyle, setBasemapStyle] = useState<BasemapStyle>('satellite');
  const [showKenyaBorders, setShowKenyaBorders] = useState<boolean>(true);
  const [dirFilter, setDirFilter] = useState<string>('ALL');
  const [ecoFilter, setEcoFilter] = useState<string>('ALL');
  const [focusedStationId, setFocusedStationId] = useState<string | null>(null);
  // Scientists may view the atlas but may not add, edit, or delete stations.
  const roleName = getUserRoleName(db, currentUser);
  const canManageLocationsState = canManageLocations(db, currentUser);

  // Location form
  const [locName, setLocName] = useState('');
  const [locCounty, setLocCounty] = useState('');
  const [locSubCounty, setLocSubCounty] = useState('');
  const [locSite, setLocSite] = useState('');
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locEco, setLocEco] = useState<ResearchLocation['ecosystem_type']>('Marine & Coastal');
  const [locMarineArea, setLocMarineArea] = useState('');
  const [locDirId, setLocDirId] = useState(currentUser.directorate_id || db.directorates[0].id);

  // Collaborator form
  const [orgName, setOrgName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [orgCountry, setOrgCountry] = useState('');
  const [orgType, setOrgType] = useState<Collaborator['organization_type']>('University / Academic');
  const [collabType, setCollabType] = useState<Collaborator['collaboration_type']>('Joint Research');
  const [mouStatus, setMouStatus] = useState<Collaborator['mou_status']>('Active MOU');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  const bordersLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  const filteredLocations = db.locations.filter((loc) => {
    if (dirFilter !== 'ALL' && loc.directorate_id !== dirFilter) return false;
    if (ecoFilter !== 'ALL' && loc.ecosystem_type !== ecoFilter) return false;
    return true;
  });

  useEffect(() => {
    if (mode !== 'locations' || !mapContainerRef.current) return;

    if (!leafletRef.current) {
      const map = L.map(mapContainerRef.current, { zoomControl: true }).setView(
        [-1.35, 37.65],
        6
      );
      leafletRef.current = map;
    }

    const map = leafletRef.current;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    if (labelLayerRef.current) {
      map.removeLayer(labelLayerRef.current);
      labelLayerRef.current = null;
    }
    if (bordersLayerRef.current) {
      map.removeLayer(bordersLayerRef.current);
      bordersLayerRef.current = null;
    }

    const selectedTile = BASEMAP_TILES[basemapStyle];
    tileLayerRef.current = L.tileLayer(selectedTile.url, {
      attribution: selectedTile.attribution,
      maxZoom: 18,
    }).addTo(map);

    if (basemapStyle === 'satellite') {
      labelLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 18,
          opacity: 0.9,
        }
      ).addTo(map);
    }

    if (showKenyaBorders) {
      bordersLayerRef.current = addKenyaBordersOverlay(map);
    }

    Object.values(markersRef.current).forEach((m) => map.removeLayer(m));
    markersRef.current = {};

    filteredLocations.forEach((loc) => {
      const dir = getDirectorateById(db, loc.directorate_id);
      const pinColor =
        dir?.code === 'OCS'
          ? '#0284C7'
          : dir?.code === 'FWS'
          ? '#159A9C'
          : dir?.code === 'ARD'
          ? '#16866B'
          : '#3155A4';

      const customIcon = L.divIcon({
        className: 'kmfri-station-pin',
        html: `
          <div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
            <span style="position:absolute;width:28px;height:28px;border-radius:9999px;background:${pinColor};opacity:0.26;"></span>
            <span style="position:relative;width:17px;height:17px;border-radius:9999px;background:${pinColor};border:2.5px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.4);"></span>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([loc.latitude, loc.longitude], { icon: customIcon }).addTo(map);
      marker.bindPopup(
        `<div style="font-family:'Public Sans',sans-serif;min-width:220px;padding:2px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${pinColor};color:#fff;font-family:monospace;">
              ${dir?.code || 'KMFRI'} · ${loc.ecosystem_type}
            </span>
          </div>
          <div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:2px;">
            ${loc.name}
          </div>
          <div style="font-size:11px;color:#475569;margin-bottom:4px;">
            ${loc.county} County · ${loc.site}
          </div>
          <div style="font-size:11px;color:#334155;margin-bottom:5px;line-height:1.35;">
            ${loc.description || loc.marine_area}
          </div>
          <div style="font-size:10.5px;font-family:monospace;color:#0F766E;background:#F1F5F9;padding:3px 6px;border-radius:4px;">
            Lat: ${loc.latitude.toFixed(4)}° · Lng: ${loc.longitude.toFixed(4)}°
          </div>
        </div>`
      );
      markersRef.current[loc.id] = marker;
    });
  }, [mode, filteredLocations, basemapStyle, showKenyaBorders]);

  const handleFlyToLocation = (loc: ResearchLocation) => {
    setFocusedStationId(loc.id);
    const map = leafletRef.current;
    if (!map) return;
    map.flyTo([loc.latitude, loc.longitude], 11, { duration: 1.1 });
    const marker = markersRef.current[loc.id];
    if (marker) {
      marker.openPopup();
    }
  };

  const handleCreateLocation = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);

    const lat = Number(locLat);
    const lng = Number(locLng);

    if (
      Number.isNaN(lat) ||
      lat < -90 ||
      lat > 90 ||
      Number.isNaN(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      setAlertMsg({
        type: 'err',
        text: 'Coordinate validation failed: Latitude must be between -90 and +90, and Longitude between -180 and +180.',
      });
      return;
    }

    const newLoc: ResearchLocation = {
      id: generateUuid(),
      name: locName.trim(),
      country: 'Kenya',
      county: locCounty.trim(),
      sub_county: locSubCounty.trim() || locCounty.trim(),
      site: locSite.trim() || locName.trim(),
      latitude: lat,
      longitude: lng,
      ecosystem_type: locEco,
      marine_area: locMarineArea.trim() || locEco,
      description: `${locEco} research station at ${locSite.trim() || locCounty.trim()}, ${locCounty.trim()} County.`,
      environmental_context: locEco,
      directorate_id: locDirId,
      created_at: new Date().toISOString(),
    };

    let nextState: DatabaseState = {
      ...db,
      locations: [newLoc, ...db.locations],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'GIS_LOCATION_REGISTERED',
      'locations',
      newLoc.id,
      null,
      { name: newLoc.name, latitude: newLoc.latitude, longitude: newLoc.longitude }
    );

    onUpdateDb(nextState);
    setLocName('');
    setLocCounty('');
    setLocSubCounty('');
    setLocSite('');
    setLocLat('');
    setLocLng('');
    setLocMarineArea('');
    setAlertMsg({
      type: 'ok',
      text: `GIS Station "${newLoc.name}" (${newLoc.latitude.toFixed(4)}, ${newLoc.longitude.toFixed(4)}) plotted on map.`,
    });
  };

  const handleDeleteCustomLocation = (loc: ResearchLocation) => {
    if (CORE_STATION_IDS.has(loc.id)) {
      setAlertMsg({
        type: 'err',
        text: `Core KMFRI Research Centre "${loc.name}" is protected and cannot be deleted.`,
      });
      return;
    }

    let nextState: DatabaseState = {
      ...db,
      locations: db.locations.filter((l) => l.id !== loc.id),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'GIS_LOCATION_DELETED',
      'locations',
      loc.id,
      { name: loc.name },
      null
    );

    onUpdateDb(nextState);
    setAlertMsg({ type: 'ok', text: `Custom sampling site "${loc.name}" removed.` });
  };

  const handleCreateCollaborator = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);
    const collab: Collaborator = {
      id: generateUuid(),
      organization_name: orgName.trim(),
      contact_person: contactPerson.trim() || 'Institutional Liaison',
      email: orgEmail.trim(),
      phone: '',
      country: orgCountry.trim() || 'Kenya',
      organization_type: orgType,
      collaboration_type: collabType,
      directorate_id: currentUser.directorate_id || db.directorates[0].id,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: '2028-12-31',
      mou_status: mouStatus,
      notes: 'Institutional research partnership agreement.',
      created_at: new Date().toISOString(),
    };

    let nextState = {
      ...db,
      collaborators: [collab, ...db.collaborators],
    };
    nextState = appendAuditLog(
      nextState,
      currentUser,
      'COLLABORATOR_PARTNERSHIP_REGISTERED',
      'collaborators',
      collab.id,
      null,
      { organization_name: collab.organization_name, mou_status: collab.mou_status }
    );
    onUpdateDb(nextState);
    setOrgName('');
    setContactPerson('');
    setOrgEmail('');
    setOrgCountry('');
    setAlertMsg({
      type: 'ok',
      text: `Partner organization "${collab.organization_name}" registered.`,
    });
  };

  if (mode === 'locations') {
    return (
      <div className="space-y-6">
        {/* Top GIS Header & Basemap/Filter Bar */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
              <Compass className="w-5 h-5 text-[#159A9C]" />
              <span>
                KMFRI National Research Centres &amp; Interactive GIS Atlas ({filteredLocations.length}{' '}
                Stations)
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All 10 official KMFRI stations across the Indian Ocean coast, Lake Victoria, Lake Turkana,
              Rift Valley lakes, and Sagana/Kegati aquaculture centres are pinned and georeferenced.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={dirFilter}
              onChange={(e) => setDirFilter(e.target.value)}
              className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800"
            >
              <option value="ALL">All 4 Directorates</option>
              {db.directorates.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>

            <select
              value={ecoFilter}
              onChange={(e) => setEcoFilter(e.target.value)}
              className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800"
            >
              <option value="ALL">All Ecosystems</option>
              <option value="Marine & Coastal">Marine &amp; Coastal</option>
              <option value="Freshwater Lake / River">Freshwater Lake / River</option>
              <option value="Aquaculture Station">Aquaculture Station</option>
              <option value="Socioeconomic Community Site">Socioeconomic Community Site</option>
            </select>

            <button
              type="button"
              onClick={() => setShowKenyaBorders((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                showKenyaBorders
                  ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-400 text-sky-700 dark:text-sky-300'
                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span>Kenya Borders &amp; EEZ</span>
            </button>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
              <Layers className="w-3.5 h-3.5 text-slate-500 ml-1" />
              <button
                type="button"
                onClick={() => setBasemapStyle('satellite')}
                className={`px-2 py-1 rounded font-medium cursor-pointer ${
                  basemapStyle === 'satellite'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Satellite
              </button>
              <button
                type="button"
                onClick={() => setBasemapStyle('voyager')}
                className={`px-2 py-1 rounded font-medium cursor-pointer ${
                  basemapStyle === 'voyager'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Modern
              </button>
              <button
                type="button"
                onClick={() => setBasemapStyle('dark')}
                className={`px-2 py-1 rounded font-medium cursor-pointer ${
                  basemapStyle === 'dark'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Dark Marine
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setFocusedStationId(null);
                leafletRef.current?.flyTo([-1.35, 37.65], 6, { duration: 0.9 });
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset View</span>
            </button>
          </div>
        </div>

        {alertMsg && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
              alertMsg.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
            }`}
          >
            {alertMsg.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{alertMsg.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Register New Field Sampling Station Form */}
          {canManageLocationsState ? (
            <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Add Field Sampling Site / Buoy Coordinate
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Validates GPS bounds (-90° to +90° Lat, -180° to +180° Lng) and plots a live marker.
                </p>
              </div>

              <form onSubmit={handleCreateLocation} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Station / Sampling Site Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter station or sampling site name"
                    value={locName}
                    onChange={(e) => setLocName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Latitude (-90 to +90)</label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="-4.0547"
                      value={locLat}
                      onChange={(e) => setLocLat(e.target.value)}
                      className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Longitude (-180 to +180)</label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="39.6836"
                      value={locLng}
                      onChange={(e) => setLocLng(e.target.value)}
                      className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">County</label>
                    <input
                      type="text"
                      required
                      placeholder="County name"
                      value={locCounty}
                      onChange={(e) => setLocCounty(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Specific Site / Beach</label>
                    <input
                      type="text"
                      placeholder="Landing beach or reef"
                      value={locSite}
                      onChange={(e) => setLocSite(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Directorate</label>
                    <select
                      value={locDirId}
                      onChange={(e) => setLocDirId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      {db.directorates.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Ecosystem Context</label>
                    <select
                      value={locEco}
                      onChange={(e) =>
                        setLocEco(e.target.value as ResearchLocation['ecosystem_type'])
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      <option value="Marine & Coastal">Marine &amp; Coastal</option>
                      <option value="Freshwater Lake / River">Freshwater Lake / River</option>
                      <option value="Aquaculture Station">Aquaculture Station</option>
                      <option value="Socioeconomic Community Site">
                        Socioeconomic Community Site
                      </option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Water Body / Marine Area</label>
                  <input
                    type="text"
                    placeholder="e.g. Western Indian Ocean EEZ or Lake Victoria"
                    value={locMarineArea}
                    onChange={(e) => setLocMarineArea(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 px-4 bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold rounded-lg cursor-pointer transition-colors"
                >
                  Validate Coordinates &amp; Pin Station
                </button>
              </form>
            </div>
          ) : (
            <div className="lg:col-span-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <Lock className="w-4 h-4 shrink-0" />
                <h2 className="text-sm font-bold">Read-Only Research Atlas</h2>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Your role (<span className="font-semibold">{roleName}</span>) may view the KMFRI
                national stations map and browse georeferenced sites, but only the Head of
                Directorate (for your own directorate), Directorate Administrator, Director
                General, or System Administrator may register new sampling stations.
              </p>
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                To propose a new station coordinate, contact your Directorate Head or the
                System Administrator.
              </p>
            </div>
          )}

          {/* Right: Interactive Leaflet Map Canvas */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Interactive Cartographic Station View
              </h2>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0284C7]" />
                  <span>OCS</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#159A9C]" />
                  <span>FWS</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#16866B]" />
                  <span>ARD</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#3155A4]" />
                  <span>SED</span>
                </span>
              </div>
            </div>
            <div className="relative flex-1 min-h-[420px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
              <div ref={mapContainerRef} className="w-full h-full min-h-[420px]" />
            </div>
          </div>
        </div>

        {/* Interactive KMFRI Stations Directory Table */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 dark:text-white">
              Georeferenced KMFRI Research Centres &amp; Field Stations Directory
            </h2>
            <span className="text-[11px] text-slate-500">
              Click any station row to focus on the map
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                  <th className="py-2.5 px-4">Directorate</th>
                  <th className="py-2.5 px-4">Station Name</th>
                  <th className="py-2.5 px-4">County &amp; Site</th>
                  <th className="py-2.5 px-4">Ecosystem &amp; Basin</th>
                  <th className="py-2.5 px-4">Coordinates (Lat, Lng)</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredLocations.map((loc) => {
                  const dir = getDirectorateById(db, loc.directorate_id);
                  const isCore = CORE_STATION_IDS.has(loc.id);
                  const isFocused = focusedStationId === loc.id;
                  return (
                    <tr
                      key={loc.id}
                      onClick={() => handleFlyToLocation(loc)}
                      className={`cursor-pointer transition-colors ${
                        isFocused
                          ? 'bg-teal-50/80 dark:bg-teal-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-[#159A9C]">
                        {dir?.code || 'HQ'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                        {loc.name}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {loc.county} · {loc.site}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <div>{loc.ecosystem_type}</div>
                        <div className="text-[11px] text-slate-400">{loc.marine_area}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                        {loc.latitude.toFixed(4)}°, {loc.longitude.toFixed(4)}°
                      </td>
                      <td
                        className="py-3 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleFlyToLocation(loc)}
                            className="px-2.5 py-1 rounded bg-[#173B75]/10 hover:bg-[#173B75]/20 text-[#173B75] dark:text-sky-300 font-semibold text-[11px] cursor-pointer"
                          >
                            Focus Map
                          </button>
                          {!isCore && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomLocation(loc)}
                              title="Remove custom station"
                              className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
          Collaborators, Partner Institutions &amp; MOUs ({db.collaborators.length})
        </h1>
        <p className="text-xs text-slate-500">
          Manage bilateral research institutions, universities, BMUs, and partnership agreements.
        </p>
      </div>

      {alertMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            alertMsg.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {alertMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{alertMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
            Register Partner Institution / MOU
          </h2>
          <form onSubmit={handleCreateCollaborator} className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Partner Organization Name</label>
              <input
                type="text"
                required
                placeholder="Enter partner organization name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Contact Person</label>
                <input
                  type="text"
                  placeholder="Lead liaison name"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Contact Email</label>
                <input
                  type="email"
                  placeholder="partner@org.org"
                  value={orgEmail}
                  onChange={(e) => setOrgEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Organization Type</label>
                <select
                  value={orgType}
                  onChange={(e) => setOrgType(e.target.value as Collaborator['organization_type'])}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="University / Academic">University / Academic</option>
                  <option value="National Research Institute">National Research Institute</option>
                  <option value="International NGO">International NGO</option>
                  <option value="Government Ministry">Government Ministry</option>
                  <option value="Community BMU">Community BMU</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Collaboration Type</label>
                <select
                  value={collabType}
                  onChange={(e) =>
                    setCollabType(e.target.value as Collaborator['collaboration_type'])
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="Joint Research">Joint Research</option>
                  <option value="Capacity Building & Training">Capacity Building &amp; Training</option>
                  <option value="Data & Equipment Sharing">Data &amp; Equipment Sharing</option>
                  <option value="Funding & Co-Sponsorship">Funding &amp; Co-Sponsorship</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Country</label>
                <input
                  type="text"
                  placeholder="Country"
                  value={orgCountry}
                  onChange={(e) => setOrgCountry(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">MOU Status</label>
                <select
                  value={mouStatus}
                  onChange={(e) => setMouStatus(e.target.value as Collaborator['mou_status'])}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="Active MOU">Active MOU</option>
                  <option value="Drafting">Drafting</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold rounded-lg cursor-pointer transition-colors"
            >
              Register Collaborator
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xs font-bold text-slate-900 dark:text-white">
              Registered Research Collaborations ({db.collaborators.length})
            </h2>
          </div>
          {db.collaborators.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No collaborator records registered yet. Use the form on the left to add partner institutions.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Organization</th>
                    <th className="py-2.5 px-4">Liaison</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4">Country</th>
                    <th className="py-2.5 px-4">MOU Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {db.collaborators.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                        {c.organization_name}
                      </td>
                      <td className="py-2.5 px-4">
                        <div>{c.contact_person}</div>
                        <div className="text-[11px] font-mono text-slate-400">{c.email}</div>
                      </td>
                      <td className="py-2.5 px-4">{c.collaboration_type}</td>
                      <td className="py-2.5 px-4">{c.country}</td>
                      <td className="py-2.5 px-4 font-mono text-[#159A9C] font-semibold">
                        {c.mou_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
