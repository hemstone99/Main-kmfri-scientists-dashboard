import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import {
  DatabaseState,
  EnvironmentalObservation,
  FieldCoordinate,
  FieldMission,
  FieldMissionStatus,
  ResearchLocation,
  ResearchSpecimen,
  SpecimenTransfer,
  User,
} from '../types/kmfri.ts';
import {
  appendAuditLog,
  generateUuid,
  getDirectorateById,
  getUserById,
} from '../services/database.ts';
import {
  canManageFieldMission,
  canManageFieldStation,
  canReviewFieldMission,
  canReviewFieldStation,
  filterFieldMissionsForUser,
  filterFieldObservationsForUser,
  filterLocationsForUser,
  filterProjectsForUser,
  filterResearchSpecimensForUser,
  getUserRoleName,
} from '../services/rbacPolicy.ts';
import { addKenyaBordersOverlay } from '../services/kenyaGeoJson.ts';
import {
  flushOfflineQueueToSupabase,
  getOfflineSyncSnapshot,
  isEffectivelyOnline,
  subscribeToOfflineSync,
} from '../services/offlineSyncService.ts';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Compass,
  Crosshair,
  Database,
  Download,
  FlaskConical,
  MapPin,
  Navigation,
  Plus,
  Route,
  Search,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface AdvancedFieldResearchModuleProps {
  db: DatabaseState;
  currentUser: User;
  onUpdateDb: (next: DatabaseState) => void;
}

type FieldTab =
  | 'overview'
  | 'map'
  | 'stations'
  | 'missions'
  | 'gps'
  | 'observations'
  | 'specimens'
  | 'offline'
  | 'analytics'
  | 'reports';

const FIELD_TABS: { id: FieldTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'GIS Overview', icon: Compass },
  { id: 'map', label: 'Sampling Map', icon: MapPin },
  { id: 'stations', label: 'Research Stations', icon: CircleDot },
  { id: 'missions', label: 'Field Missions', icon: Route },
  { id: 'gps', label: 'GPS & Sampling', icon: Crosshair },
  { id: 'observations', label: 'Observations', icon: FlaskConical },
  { id: 'specimens', label: 'Specimen Tracking', icon: Database },
  { id: 'offline', label: 'Offline Fieldwork', icon: WifiOff },
  { id: 'analytics', label: 'Spatial Analytics', icon: Activity },
  { id: 'reports', label: 'Field Reports', icon: ClipboardList },
];

const TILE_LAYERS = {
  voyager: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  marine: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
};

const MEASUREMENT_FIELDS = [
  { key: 'water_temperature', label: 'Water temperature', unit: '°C', min: -5, max: 45 },
  { key: 'salinity', label: 'Salinity', unit: 'PSU', min: 0, max: 50 },
  { key: 'ph', label: 'pH', unit: '', min: 0, max: 14 },
  { key: 'dissolved_oxygen', label: 'Dissolved oxygen', unit: 'mg/L', min: 0, max: 30 },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', min: 0, max: 10000 },
  { key: 'depth', label: 'Depth', unit: 'm', min: 0, max: 12000 },
] as const;

const initialSyncStatus = (): 'Local Only' | 'Pending Sync' =>
  isEffectivelyOnline() ? 'Pending Sync' : 'Local Only';

const coordinateDistance = (first: FieldCoordinate, second: FieldCoordinate): number => {
  const radians = (degrees: number) => degrees * (Math.PI / 180);
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const arc = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
};

const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const downloadText = (filename: string, content: string, mimeType: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const AdvancedFieldResearchModule: React.FC<AdvancedFieldResearchModuleProps> = ({
  db,
  currentUser,
  onUpdateDb,
}) => {
  const [activeTab, setActiveTab] = useState<FieldTab>('overview');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [ecosystemFilter, setEcosystemFilter] = useState('ALL');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [mapStyle, setMapStyle] = useState<keyof typeof TILE_LAYERS>('marine');
  const [mapZoom, setMapZoom] = useState(6);
  const [showBorders, setShowBorders] = useState(true);
  const [drawRoute, setDrawRoute] = useState(false);
  const [routePoints, setRoutePoints] = useState<FieldCoordinate[]>([]);
  const [gps, setGps] = useState<FieldCoordinate | null>(null);
  const [gpsStatus, setGpsStatus] = useState('GPS not captured');
  const [showMissionForm, setShowMissionForm] = useState(false);
  const [showStationForm, setShowStationForm] = useState(false);
  const [missionProposal, setMissionProposal] = useState(false);
  const [missionTitle, setMissionTitle] = useState('');
  const [missionObjectives, setMissionObjectives] = useState('');
  const [missionProjectId, setMissionProjectId] = useState('');
  const [missionStationId, setMissionStationId] = useState('');
  const [missionStartAt, setMissionStartAt] = useState('');
  const [missionEndAt, setMissionEndAt] = useState('');
  const [missionSafety, setMissionSafety] = useState('');
  const [missionEquipment, setMissionEquipment] = useState('');
  const [missionTransport, setMissionTransport] = useState('');
  const [stationName, setStationName] = useState('');
  const [stationCode, setStationCode] = useState('');
  const [stationLat, setStationLat] = useState('');
  const [stationLng, setStationLng] = useState('');
  const [stationCounty, setStationCounty] = useState('');
  const [stationHabitat, setStationHabitat] = useState<ResearchLocation['ecosystem_type']>('Marine & Coastal');
  const [stationProjectId, setStationProjectId] = useState('');
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [stationProgram, setStationProgram] = useState('');
  const [stationPhoto, setStationPhoto] = useState('');
  const [observationProjectId, setObservationProjectId] = useState('');
  const [observationMissionId, setObservationMissionId] = useState('');
  const [observationStationId, setObservationStationId] = useState('');
  const [observationType, setObservationType] = useState('Water quality');
  const [samplingMethod, setSamplingMethod] = useState('Field instrument');
  const [measurements, setMeasurements] = useState<Record<string, string>>({});
  const [environmentNotes, setEnvironmentNotes] = useState('');
  const [weather, setWeather] = useState('');
  const [observationPhoto, setObservationPhoto] = useState('');
  const [specimenProjectId, setSpecimenProjectId] = useState('');
  const [specimenMissionId, setSpecimenMissionId] = useState('');
  const [specimenStationId, setSpecimenStationId] = useState('');
  const [specimenType, setSpecimenType] = useState('Water sample');
  const [speciesName, setSpeciesName] = useState('');
  const [preservationMethod, setPreservationMethod] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [specimenPhoto, setSpecimenPhoto] = useState('');
  const [selectedSpecimenId, setSelectedSpecimenId] = useState('');
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const borderLayerRef = useRef<L.LayerGroup | null>(null);
  const processedSyncAtRef = useRef<string | null>(null);

  const role = getUserRoleName(db, currentUser);
  const projectsVisibleToRole = filterProjectsForUser(db, currentUser);
  const projects = role === 'scientist'
    ? projectsVisibleToRole.filter((project) => project.principal_investigator_id === currentUser.id || project.created_by === currentUser.id || db.project_members.some((member) => member.project_id === project.id && member.user_id === currentUser.id))
    : projectsVisibleToRole;
  const projectIds = new Set(projects.map((project) => project.id));
  const locations = filterLocationsForUser(db, currentUser).filter((location) =>
    !location.project_id || projectIds.has(location.project_id) || ['head_of_directorate', 'directorate_admin', 'director_general', 'system_admin'].includes(role)
  );
  const missions = filterFieldMissionsForUser(db, currentUser);
  const observations = filterFieldObservationsForUser(db, currentUser);
  const specimens = filterResearchSpecimensForUser(db, currentUser);
  const currentDirectorateId = currentUser.directorate_id || db.directorates[0]?.id || '';
  const canApproveMissions = role === 'system_admin' || role === 'head_of_directorate';
  const [syncSnapshot, setSyncSnapshot] = useState(getOfflineSyncSnapshot);

  useEffect(() => subscribeToOfflineSync(setSyncSnapshot), []);

  useEffect(() => {
    const syncedAt = syncSnapshot.lastSyncedAt;
    if (!syncSnapshot.isOnline || syncSnapshot.syncStatus !== 'synced' || !syncedAt || processedSyncAtRef.current === syncedAt) return;
    const hasPendingFieldRecords = [
      ...db.field_missions,
      ...db.field_observations,
      ...db.research_specimens,
    ].some((record) => record.sync_status === 'Pending Sync' || record.sync_status === 'Local Only');
    processedSyncAtRef.current = syncedAt;
    if (!hasPendingFieldRecords) return;
    const syncedState: DatabaseState = {
      ...db,
      field_missions: db.field_missions.map((record) => ['Pending Sync', 'Local Only'].includes(record.sync_status) ? { ...record, sync_status: 'Synced' as const } : record),
      field_observations: db.field_observations.map((record) => ['Pending Sync', 'Local Only'].includes(record.sync_status) ? { ...record, sync_status: 'Synced' as const } : record),
      research_specimens: db.research_specimens.map((record) => ['Pending Sync', 'Local Only'].includes(record.sync_status) ? { ...record, sync_status: 'Synced' as const } : record),
    };
    onUpdateDb(appendAuditLog(syncedState, currentUser, 'FIELD_RECORDS_MARKED_SYNCED', 'field_data', 'batch', null, { synced_at: syncedAt }));
  }, [syncSnapshot, db, currentUser, onUpdateDb]);

  const filteredLocations = locations.filter((location) => {
    if (ecosystemFilter !== 'ALL' && location.ecosystem_type !== ecosystemFilter) return false;
    if (search.trim() && !`${location.name} ${location.site} ${location.county} ${location.station_code || ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const focusedProjectId = projectFilter === 'ALL' ? null : projectFilter;
  const visibleMissions = missions.filter((mission) => !focusedProjectId || mission.project_id === focusedProjectId);
  const visibleObservations = observations.filter((observation) => !focusedProjectId || observation.project_id === focusedProjectId);
  const visibleSpecimens = specimens.filter((specimen) => !focusedProjectId || specimen.project_id === focusedProjectId);
  const canManageSelectedStation = (projectId?: string | null) =>
    (role === 'scientist' && !projectId && projects.length > 0) ||
    canManageFieldStation(db, currentUser, currentDirectorateId, projectId);

  const commitState = (nextState: DatabaseState, action: string, entityType: string, entityId: string, oldValue: unknown, newValue: unknown) => {
    onUpdateDb(appendAuditLog(nextState, currentUser, action, entityType, entityId, oldValue, newValue));
  };

  const captureGps = () => {
    if (!navigator.geolocation) {
      setGpsStatus('Location services are unavailable in this browser. Enter coordinates manually.');
      return;
    }
    setGpsStatus('Requesting high-accuracy location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinate: FieldCoordinate = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          elevation_m: position.coords.altitude,
          captured_at: new Date(position.timestamp).toISOString(),
        };
        setGps(coordinate);
        setGpsStatus(coordinate.accuracy_m && coordinate.accuracy_m > 100
          ? `Captured with low accuracy (±${Math.round(coordinate.accuracy_m)} m). Confirm before saving.`
          : `Location confirmed (±${Math.round(coordinate.accuracy_m || 0)} m).`);
        setStationLat(String(coordinate.latitude));
        setStationLng(String(coordinate.longitude));
      },
      (error) => setGpsStatus(error.code === error.PERMISSION_DENIED
        ? 'Location permission denied. Coordinates can be entered manually.'
        : 'GPS could not be determined. Move to an open area and retry.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    if (activeTab !== 'map' || !mapElementRef.current) return;
    if (!mapRef.current) mapRef.current = L.map(mapElementRef.current).setView([-1.35, 37.65], 6);
    const map = mapRef.current;
    map.invalidateSize();
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    baseLayerRef.current = L.tileLayer(TILE_LAYERS[mapStyle].url, { attribution: TILE_LAYERS[mapStyle].attribution, maxZoom: 18 }).addTo(map);
    if (markerLayerRef.current) map.removeLayer(markerLayerRef.current);
    markerLayerRef.current = L.layerGroup().addTo(map);
    const clusterCell = mapZoom < 7 ? 0.8 : mapZoom < 9 ? 0.25 : mapZoom < 11 ? 0.08 : 0;
    const locationGroups = new Map<string, ResearchLocation[]>();
    filteredLocations.forEach((location) => {
      const groupKey = clusterCell
        ? `${Math.floor(location.latitude / clusterCell)}:${Math.floor(location.longitude / clusterCell)}`
        : location.id;
      locationGroups.set(groupKey, [...(locationGroups.get(groupKey) || []), location]);
    });
    locationGroups.forEach((group) => {
      if (group.length > 1) {
        const latitude = group.reduce((sum, item) => sum + item.latitude, 0) / group.length;
        const longitude = group.reduce((sum, item) => sum + item.longitude, 0) / group.length;
        const clusterIcon = L.divIcon({
          className: 'kmfri-field-cluster',
          html: `<span style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:#087969;color:#fff;border:2px solid #fff;font:700 12px sans-serif;box-shadow:0 2px 8px #0005">${group.length}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const clusterMarker = L.marker([latitude, longitude], { icon: clusterIcon }).addTo(markerLayerRef.current!);
        const popup = document.createElement('div');
        const heading = document.createElement('strong');
        heading.textContent = `${group.length} research stations`;
        const names = document.createElement('div');
        names.textContent = group.map((item) => item.station_code || item.name).join(', ');
        popup.append(heading, names);
        clusterMarker.bindPopup(popup);
        return;
      }
      const location = group[0];
      const marker = L.circleMarker([location.latitude, location.longitude], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#078779',
        fillOpacity: 0.95,
      }).addTo(markerLayerRef.current!);
      const popup = document.createElement('div');
      const stationHeading = document.createElement('strong');
      stationHeading.textContent = `${location.station_code || location.name} · ${location.name}`;
      const stationInfo = document.createElement('div');
      stationInfo.textContent = `${location.ecosystem_type} · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
      popup.append(stationHeading, stationInfo);
      marker.bindPopup(popup);
    });
    visibleObservations.forEach((observation) => {
      const marker = L.circleMarker([observation.coordinate.latitude, observation.coordinate.longitude], {
        radius: 5,
        color: '#fff',
        weight: 1.5,
        fillColor: observation.quality_status === 'Flagged' ? '#dc2626' : '#e99a22',
        fillOpacity: 0.9,
      }).addTo(markerLayerRef.current!);
      const popup = document.createElement('div');
      const observationHeading = document.createElement('strong');
      observationHeading.textContent = observation.observation_type;
      const observationInfo = document.createElement('div');
      observationInfo.textContent = `${new Date(observation.observed_at).toLocaleString()} · ${observation.quality_status}`;
      popup.append(observationHeading, observationInfo);
      marker.bindPopup(popup);
    });
    if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
    routeLayerRef.current = L.layerGroup().addTo(map);
    missions.filter((mission) => mission.status !== 'Cancelled' && mission.route_coordinates.length > 1).forEach((mission) => {
      L.polyline(mission.route_coordinates.map((point) => [point.latitude, point.longitude] as [number, number]), { color: '#057a67', weight: 3, opacity: 0.8 }).addTo(routeLayerRef.current!);
    });
    if (routePoints.length > 1) {
      L.polyline(routePoints.map((point) => [point.latitude, point.longitude] as [number, number]), { color: '#e99a22', dashArray: '6 6', weight: 3 }).addTo(routeLayerRef.current);
    }
    if (borderLayerRef.current) map.removeLayer(borderLayerRef.current);
    borderLayerRef.current = showBorders ? addKenyaBordersOverlay(map) : null;

    const clickHandler = (event: L.LeafletMouseEvent) => {
      if (!drawRoute) return;
      setRoutePoints((points) => [...points, {
        latitude: Number(event.latlng.lat.toFixed(6)),
        longitude: Number(event.latlng.lng.toFixed(6)),
        captured_at: new Date().toISOString(),
      }]);
    };
    const zoomHandler = () => setMapZoom(map.getZoom());
    map.on('click', clickHandler);
    map.on('zoomend', zoomHandler);
    return () => { map.off('click', clickHandler); map.off('zoomend', zoomHandler); };
  }, [activeTab, mapStyle, mapZoom, showBorders, filteredLocations, visibleObservations, missions, routePoints, drawRoute]);

  useEffect(() => () => { mapRef.current?.remove(); }, []);

  const createStation = (event: React.FormEvent) => {
    event.preventDefault();
    const latitude = Number(stationLat);
    const longitude = Number(stationLng);
    const project = projects.find((item) => item.id === stationProjectId);
    const existingStation = locations.find((location) => location.id === editingStationId);
    if (!stationName.trim() || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      setMessage({ type: 'error', text: 'Station name and valid WGS84 latitude/longitude are required.' });
      return;
    }
    if (!canManageFieldStation(db, currentUser, project?.directorate_id || existingStation?.directorate_id || currentDirectorateId, project?.id || existingStation?.project_id)) {
      setMessage({ type: 'error', text: 'Station creation requires an authorized project assignment or station-management role.' });
      return;
    }
    const nearDuplicate = locations.find((location) => location.id !== editingStationId && coordinateDistance({ latitude, longitude }, { latitude: location.latitude, longitude: location.longitude }) < 20);
    if (nearDuplicate) {
      setMessage({ type: 'error', text: `This coordinate is within 20 metres of ${nearDuplicate.station_code || nearDuplicate.name}. Review the existing station before adding a duplicate.` });
      return;
    }
    const now = new Date().toISOString();
    const station: ResearchLocation = {
      id: existingStation?.id || generateUuid(),
      station_code: stationCode.trim() || existingStation?.station_code || `KMFRI-${currentUser.directorate_id?.slice(-3).toUpperCase() || 'SITE'}-${Date.now().toString().slice(-6)}`,
      name: stationName.trim(),
      country: 'Kenya',
      county: stationCounty.trim(),
      sub_county: stationCounty.trim(),
      site: existingStation?.site || stationName.trim(),
      latitude,
      longitude,
      ecosystem_type: stationHabitat,
      marine_area: stationProgram.trim() || stationHabitat,
      description: stationProgram.trim() || 'Research sampling and monitoring point.',
      environmental_context: stationHabitat,
      directorate_id: project?.directorate_id || existingStation?.directorate_id || currentDirectorateId,
      project_id: project?.id || existingStation?.project_id || null,
      research_program: stationProgram.trim(),
      responsible_user_id: existingStation?.responsible_user_id || currentUser.id,
      operational_status: existingStation?.operational_status || 'Active',
        approval_status: existingStation?.approval_status || (role === 'scientist' ? 'Pending Approval' : 'Approved'),
        submitted_by: existingStation?.submitted_by || currentUser.id,
        approved_by: existingStation?.approved_by || (role === 'scientist' ? null : currentUser.id),
        approved_at: existingStation?.approved_at || (role === 'scientist' ? null : now),
      photo_data_url: stationPhoto || existingStation?.photo_data_url || '',
      created_by: currentUser.id,
      created_at: existingStation?.created_at || now,
      updated_at: now,
    };
    const nextLocations = existingStation
      ? db.locations.map((location) => location.id === existingStation.id ? station : location)
      : [station, ...db.locations];
    commitState({ ...db, locations: nextLocations }, existingStation ? 'FIELD_STATION_UPDATED' : 'FIELD_STATION_CREATED', 'locations', station.id, existingStation || null, station);
    setStationName(''); setStationCode(''); setStationLat(''); setStationLng(''); setStationCounty(''); setStationProgram(''); setStationPhoto(''); setStationProjectId(''); setEditingStationId(null);
    setMessage({ type: 'success', text: `${station.station_code} ${existingStation ? 'updated' : 'added'}. The change is saved locally and queued for synchronization.` });
    setShowStationForm(false);
  };

  const archiveStation = (station: ResearchLocation) => {
    if (!canManageFieldStation(db, currentUser, station.directorate_id, station.project_id)) {
      setMessage({ type: 'error', text: 'You do not have permission to archive this station.' });
      return;
    }
    const now = new Date().toISOString();
    const updated = { ...station, operational_status: 'Archived' as const, archived_at: now, updated_at: now };
    commitState({ ...db, locations: db.locations.map((location) => location.id === station.id ? updated : location) }, 'FIELD_STATION_ARCHIVED', 'locations', station.id, station, updated);
    setMessage({ type: 'success', text: `${station.station_code || station.name} archived.` });
  };

  const editStation = (station: ResearchLocation) => {
    if (!canManageFieldStation(db, currentUser, station.directorate_id, station.project_id)) return;
    setEditingStationId(station.id);
    setStationName(station.name);
    setStationCode(station.station_code || '');
    setStationLat(String(station.latitude));
    setStationLng(String(station.longitude));
    setStationCounty(station.county);
    setStationHabitat(station.ecosystem_type);
    setStationProjectId(station.project_id || '');
    setStationProgram(station.research_program || '');
    setStationPhoto(station.photo_data_url || '');
    setShowStationForm(true);
  };
  
  const reviewStation = (station: ResearchLocation, approved: boolean) => {
    if (!canReviewFieldStation(db, currentUser, station)) {
      setMessage({ type: 'error', text: 'Only a non-submitting Head of Directorate or System Administrator may decide this station proposal.' });
      return;
    }
    const now = new Date().toISOString();
    const updated = { ...station, approval_status: approved ? 'Approved' as const : 'Rejected' as const, approved_by: approved ? currentUser.id : null, approved_at: approved ? now : null, updated_at: now };
    commitState({ ...db, locations: db.locations.map((location) => location.id === station.id ? updated : location) }, approved ? 'FIELD_STATION_APPROVED' : 'FIELD_STATION_REJECTED', 'locations', station.id, station.approval_status, updated.approval_status);
    setMessage({ type: 'success', text: `Station proposal ${approved ? 'approved' : 'rejected'}.` });
  };

  const createMission = (event: React.FormEvent) => {
    event.preventDefault();
    const project = projects.find((item) => item.id === missionProjectId);
    if (!project || !missionTitle.trim() || !missionStartAt || !missionEndAt || new Date(missionEndAt) < new Date(missionStartAt)) {
      setMessage({ type: 'error', text: 'Select an assigned project and enter a valid title and mission schedule.' });
      return;
    }
    const selectedStation = locations.find((location) => location.id === missionStationId);
    if (selectedStation?.project_id && selectedStation.project_id !== project.id) {
      setMessage({ type: 'error', text: 'The selected station is linked to a different research project.' });
      return;
    }
    const now = new Date().toISOString();
    const status: FieldMissionStatus = missionProposal ? 'Pending Approval' : 'Draft';
    const mission: FieldMission = {
      id: generateUuid(),
      mission_code: `FM-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: missionTitle.trim(),
      objectives: missionObjectives.trim(),
      project_id: project.id,
      directorate_id: project.directorate_id,
      requested_by: currentUser.id,
      mission_lead_id: currentUser.id,
      team_member_ids: db.project_members.filter((member) => member.project_id === project.id).map((member) => member.user_id),
      station_ids: missionStationId ? [missionStationId] : [],
      start_at: new Date(missionStartAt).toISOString(),
      end_at: new Date(missionEndAt).toISOString(),
      status,
      route_coordinates: routePoints,
      equipment_notes: missionEquipment.trim(),
      transport_requirements: missionTransport.trim(),
      safety_notes: missionSafety.trim(),
      checklist: [
        { id: generateUuid(), label: 'Safety briefing complete', complete: false },
        { id: generateUuid(), label: 'Equipment checked', complete: false },
        { id: generateUuid(), label: 'Samples labelled', complete: false },
      ],
      progress: 0,
      approved_by: null,
      approved_at: null,
      completion_notes: '',
      created_at: now,
      updated_at: now,
      sync_status: initialSyncStatus(),
    };
    commitState({ ...db, field_missions: [mission, ...db.field_missions] }, status === 'Draft' ? 'FIELD_MISSION_DRAFT_CREATED' : 'FIELD_MISSION_SUBMITTED', 'field_missions', mission.id, null, mission);
    setMessage({ type: 'success', text: `Mission ${mission.mission_code} ${status === 'Draft' ? 'saved as draft' : 'submitted for directorate approval'}.` });
    setMissionTitle(''); setMissionObjectives(''); setMissionEquipment(''); setMissionSafety(''); setMissionTransport(''); setRoutePoints([]); setShowMissionForm(false); setActiveTab('missions');
  };

  const reviewMission = (mission: FieldMission, approved: boolean) => {
    if (!canReviewFieldMission(db, currentUser, mission)) {
      setMessage({ type: 'error', text: 'Only an authorized, non-submitting reviewer for this directorate may decide this mission.' });
      return;
    }
    const now = new Date().toISOString();
    const updated: FieldMission = { ...mission, status: approved ? 'Approved' : 'Cancelled', approved_by: approved ? currentUser.id : null, approved_at: approved ? now : null, updated_at: now };
    commitState({ ...db, field_missions: db.field_missions.map((item) => item.id === mission.id ? updated : item) }, approved ? 'FIELD_MISSION_APPROVED' : 'FIELD_MISSION_REJECTED', 'field_missions', mission.id, mission.status, updated.status);
    setMessage({ type: 'success', text: `Mission ${approved ? 'approved' : 'returned/cancelled'}.` });
  };

  const updateMissionStatus = (mission: FieldMission, status: FieldMissionStatus) => {
    if (!canManageFieldMission(db, currentUser, mission)) {
      setMessage({ type: 'error', text: 'You do not have permission to update this mission.' });
      return;
    }
    const completionNotes = status === 'Completed' ? window.prompt('Mission debrief / completion notes:', mission.completion_notes) : mission.completion_notes;
    if (status === 'Completed' && completionNotes === null) return;
    const updated = { ...mission, status, completion_notes: completionNotes || '', progress: status === 'Completed' ? 100 : mission.progress, updated_at: new Date().toISOString() };
    commitState({ ...db, field_missions: db.field_missions.map((item) => item.id === mission.id ? updated : item) }, 'FIELD_MISSION_STATUS_CHANGED', 'field_missions', mission.id, mission.status, status);
  };

  const createObservation = (event: React.FormEvent) => {
    event.preventDefault();
    const project = projects.find((item) => item.id === observationProjectId);
    if (!project || !gps || !observationType.trim()) {
      setMessage({ type: 'error', text: 'Choose an assigned project, observation type, and capture or enter GPS coordinates.' });
      return;
    }
    const values: Record<string, number | string> = {};
    const units: Record<string, string> = {};
    const flags: string[] = [];
    MEASUREMENT_FIELDS.forEach((field) => {
      const raw = measurements[field.key];
      if (!raw) return;
      const number = Number(raw);
      values[field.key] = number;
      units[field.key] = field.unit;
      if (!Number.isFinite(number) || number < field.min || number > field.max) flags.push(`${field.label} outside configured range (${field.min}–${field.max} ${field.unit})`);
    });
    const selectedStation = locations.find((location) => location.id === observationStationId);
    const selectedMission = missions.find((mission) => mission.id === observationMissionId);
    if (selectedStation?.project_id && selectedStation.project_id !== project.id) {
      setMessage({ type: 'error', text: 'The selected station is linked to a different research project.' });
      return;
    }
    if (selectedMission && selectedMission.project_id !== project.id) {
      setMessage({ type: 'error', text: 'The selected mission is linked to a different research project.' });
      return;
    }
    if (Object.keys(values).length === 0 && !environmentNotes.trim()) {
      setMessage({ type: 'error', text: 'Record at least one validated measurement or a scientific observation note.' });
      return;
    }
    const now = new Date().toISOString();
    const observation: EnvironmentalObservation = {
      id: generateUuid(),
      project_id: project.id,
      mission_id: observationMissionId || null,
      station_id: observationStationId || null,
      directorate_id: project.directorate_id,
      observer_id: currentUser.id,
      observed_at: gps.captured_at || now,
      coordinate: { ...gps },
      observation_type: observationType.trim(),
      sampling_method: samplingMethod,
      measurements: values,
      measurement_units: units,
      habitat_condition: '',
      weather_conditions: weather.trim(),
      notes: environmentNotes.trim(),
      photo_data_urls: observationPhoto ? [{ name: 'field-observation.jpg', data_url: observationPhoto }] : [],
      quality_flags: flags,
      quality_status: flags.length ? 'Flagged' : 'Unreviewed',
      correction_history: [],
      created_at: now,
      updated_at: now,
      sync_status: initialSyncStatus(),
    };
    commitState({ ...db, field_observations: [observation, ...db.field_observations] }, 'FIELD_OBSERVATION_CREATED', 'field_observations', observation.id, null, observation);
    setMessage({ type: flags.length ? 'error' : 'success', text: flags.length ? `Observation saved with ${flags.length} quality flag(s); review the measurements before analysis.` : 'Environmental observation saved and queued for sync.' });
    setMeasurements({}); setEnvironmentNotes(''); setWeather('');
    setObservationPhoto('');
  };

  const createSpecimen = (event: React.FormEvent) => {
    event.preventDefault();
    const project = projects.find((item) => item.id === specimenProjectId);
    if (!project || !gps || !specimenType.trim()) {
      setMessage({ type: 'error', text: 'Choose an assigned project, sample type, and capture or enter GPS coordinates.' });
      return;
    }
    const selectedStation = locations.find((location) => location.id === specimenStationId);
    const selectedMission = missions.find((mission) => mission.id === specimenMissionId);
    if (selectedStation?.project_id && selectedStation.project_id !== project.id) {
      setMessage({ type: 'error', text: 'The selected station is linked to a different research project.' });
      return;
    }
    if (selectedMission && selectedMission.project_id !== project.id) {
      setMessage({ type: 'error', text: 'The selected mission is linked to a different research project.' });
      return;
    }
    const now = new Date().toISOString();
    const sampleCode = `KMFRI-${new Date().getFullYear()}-${generateUuid().slice(0, 8).toUpperCase()}`;
    const specimen: ResearchSpecimen = {
      id: generateUuid(),
      sample_code: sampleCode,
      qr_payload: `kmfri://specimen/${sampleCode}`,
      project_id: project.id,
      mission_id: specimenMissionId || null,
      station_id: specimenStationId || null,
      observation_id: observations.find((observation) =>
        observation.project_id === project.id &&
        (!specimenMissionId || observation.mission_id === specimenMissionId) &&
        (!specimenStationId || observation.station_id === specimenStationId)
      )?.id || null,
      directorate_id: project.directorate_id,
      collected_by: currentUser.id,
      specimen_type: specimenType.trim(),
      species_name: speciesName.trim(),
      identification_status: speciesName.trim() ? 'Provisional' : 'Unidentified',
      coordinate: { ...gps },
      collected_at: gps.captured_at || now,
      preservation_method: preservationMethod.trim(),
      storage_location: storageLocation.trim(),
      status: 'Collected',
      disposition_notes: '',
      photo_data_url: specimenPhoto,
      created_at: now,
      updated_at: now,
      sync_status: initialSyncStatus(),
    };
    commitState({ ...db, research_specimens: [specimen, ...db.research_specimens] }, 'SPECIMEN_COLLECTED', 'research_specimens', specimen.id, null, specimen);
    setSelectedSpecimenId(specimen.id);
    setMessage({ type: 'success', text: `Specimen ${sampleCode} registered with collector, project, location, and coordinate metadata.` });
    setSpeciesName(''); setPreservationMethod(''); setStorageLocation(''); setSpecimenPhoto('');
  };

  const createTransfer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const specimen = visibleSpecimens.find((item) => item.id === selectedSpecimenId);
    if (!specimen) return;
    const now = new Date().toISOString();
    const transfer: SpecimenTransfer = {
      id: generateUuid(),
      specimen_id: specimen.id,
      from_location: String(formData.get('from_location') || '').trim(),
      to_location: String(formData.get('to_location') || '').trim(),
      transferred_by: currentUser.id,
      received_by: null,
      transferred_at: now,
      received_at: null,
      purpose: String(formData.get('purpose') || '').trim(),
      status: 'Awaiting Receipt',
      notes: '',
      created_at: now,
    };
    const updatedSpecimen = { ...specimen, status: 'In Transit' as const, updated_at: now };
    commitState({
      ...db,
      research_specimens: db.research_specimens.map((item) => item.id === specimen.id ? updatedSpecimen : item),
      specimen_transfers: [transfer, ...db.specimen_transfers],
    }, 'SPECIMEN_TRANSFER_STARTED', 'specimen_transfers', transfer.id, specimen.status, transfer);
    event.currentTarget.reset();
    setMessage({ type: 'success', text: `Custody transfer opened for ${specimen.sample_code}.` });
  };

  const receiveTransfer = (transfer: SpecimenTransfer) => {
    const specimen = db.research_specimens.find((item) => item.id === transfer.specimen_id);
    if (!specimen || (specimen.collected_by !== currentUser.id && !canManageFieldStation(db, currentUser, specimen.directorate_id, specimen.project_id))) {
      setMessage({ type: 'error', text: 'Only the collector or authorized directorate manager may confirm receipt in the current role model.' });
      return;
    }
    const now = new Date().toISOString();
    const updatedTransfer = { ...transfer, status: 'Received' as const, received_by: currentUser.id, received_at: now };
    const updatedSpecimen = { ...specimen, status: 'Received by Lab' as const, storage_location: transfer.to_location, updated_at: now };
    commitState({
      ...db,
      specimen_transfers: db.specimen_transfers.map((item) => item.id === transfer.id ? updatedTransfer : item),
      research_specimens: db.research_specimens.map((item) => item.id === specimen.id ? updatedSpecimen : item),
    }, 'SPECIMEN_CUSTODY_CONFIRMED', 'specimen_transfers', transfer.id, transfer.status, { ...updatedTransfer, specimen_status: updatedSpecimen.status });
  };

  const advanceSpecimen = (specimen: ResearchSpecimen, status: ResearchSpecimen['status']) => {
    const permitted = specimen.collected_by === currentUser.id || canManageFieldStation(db, currentUser, specimen.directorate_id, specimen.project_id);
    if (!permitted) {
      setMessage({ type: 'error', text: 'Only the collector or an authorized directorate manager may update this specimen.' });
      return;
    }
    const notes = status === 'Disposed' ? window.prompt('Disposition reason (required):', '') : specimen.disposition_notes;
    if (status === 'Disposed' && (!notes || !notes.trim())) return;
    const updated = { ...specimen, status, disposition_notes: notes || '', updated_at: new Date().toISOString(), sync_status: initialSyncStatus() };
    commitState({ ...db, research_specimens: db.research_specimens.map((item) => item.id === specimen.id ? updated : item) }, 'SPECIMEN_STATUS_CHANGED', 'research_specimens', specimen.id, specimen.status, updated);
    setMessage({ type: 'success', text: `${specimen.sample_code} moved to ${status}.` });
  };

  const captureRouteFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      let points: FieldCoordinate[] = [];
      if (file.name.toLowerCase().endsWith('.geojson') || file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(content);
        const features = parsed.type === 'FeatureCollection' ? parsed.features : [parsed];
        points = features.flatMap((feature: { geometry?: { type?: string; coordinates?: unknown } }) => {
          if (feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
            const [longitude, latitude] = feature.geometry.coordinates as number[];
            if (Number.isFinite(latitude) && Number.isFinite(longitude)) return [{ latitude, longitude }];
          }
          if (feature.geometry?.type === 'LineString' && Array.isArray(feature.geometry.coordinates)) {
            return (feature.geometry.coordinates as number[][]).map(([longitude, latitude]) => ({ latitude, longitude }));
          }
          return [];
        });
      } else if (file.name.toLowerCase().endsWith('.gpx')) {
        const xml = new DOMParser().parseFromString(content, 'application/xml');
        points = [...Array.from(xml.querySelectorAll('trkpt, rtept, wpt'))].map((point) => ({ latitude: Number(point.getAttribute('lat')), longitude: Number(point.getAttribute('lon')) })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
      } else {
        const lines = content.trim().split(/\r?\n/);
        const header = lines.shift()?.split(',').map((name) => name.trim().toLowerCase()) || [];
        const latitudeIndex = header.findIndex((name) => ['lat', 'latitude', 'y'].includes(name));
        const longitudeIndex = header.findIndex((name) => ['lon', 'lng', 'longitude', 'x'].includes(name));
        if (latitudeIndex < 0 || longitudeIndex < 0) throw new Error('CSV must include latitude and longitude columns.');
        points = lines.map((line) => line.split(',')).map((columns) => ({ latitude: Number(columns[latitudeIndex]), longitude: Number(columns[longitudeIndex]) })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
      }
      if (!points.length) throw new Error('No valid WGS84 points were found in this file.');
      if (points.some((point) => Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)) {
        throw new Error('Spatial file contains coordinates outside WGS84 latitude/longitude bounds.');
      }
      setRoutePoints(points);
      setActiveTab('map');
      setMessage({ type: 'success', text: `${points.length} coordinate(s) loaded into the route workspace. Review before saving to a mission.` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to read spatial file.' });
    } finally {
      event.target.value = '';
    }
  };

  const exportStationsGeoJson = () => {
    const featureCollection = {
      type: 'FeatureCollection',
      name: 'KMFRI authorized research stations',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: locations.map((location) => ({
        type: 'Feature',
        id: location.id,
        geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] },
        properties: { name: location.name, station_code: location.station_code || '', ecosystem: location.ecosystem_type, directorate_id: location.directorate_id, project_id: location.project_id || null },
      })),
    };
    downloadText('kmfri-authorized-stations.geojson', JSON.stringify(featureCollection, null, 2), 'application/geo+json');
    const first = locations[0];
    if (first) onUpdateDb(appendAuditLog(db, currentUser, 'FIELD_SPATIAL_DATA_EXPORTED', 'locations', first.id, null, { format: 'GeoJSON', record_count: locations.length }));
  };

  const exportObservationsCsv = () => {
    const headers = ['observation_id', 'observed_at', 'observer_id', 'project_id', 'mission_id', 'station_id', 'latitude', 'longitude', 'accuracy_m', 'observation_type', 'sampling_method', ...MEASUREMENT_FIELDS.map((field) => field.key), 'quality_status', 'quality_flags', 'notes'];
    const rows = visibleObservations.map((item) => [item.id, item.observed_at, item.observer_id, item.project_id, item.mission_id, item.station_id, item.coordinate.latitude, item.coordinate.longitude, item.coordinate.accuracy_m, item.observation_type, item.sampling_method, ...MEASUREMENT_FIELDS.map((field) => item.measurements[field.key] ?? ''), item.quality_status, item.quality_flags.join('; '), item.notes]);
    downloadText('kmfri-field-observations.csv', [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    const first = visibleObservations[0];
    if (first) onUpdateDb(appendAuditLog(db, currentUser, 'FIELD_SPATIAL_DATA_EXPORTED', 'field_observations', first.id, null, { format: 'CSV', record_count: visibleObservations.length }));
  };

  const exportMissionGpx = (mission: FieldMission) => {
    const trackPoints = mission.route_coordinates.map((point) => `<trkpt lat="${point.latitude}" lon="${point.longitude}">${point.elevation_m != null ? `<ele>${point.elevation_m}</ele>` : ''}</trkpt>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="KMFRI Research Workspace" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${mission.title.replace(/[<&>]/g, '')}</name><trkseg>${trackPoints}</trkseg></trk></gpx>`;
    downloadText(`${mission.mission_code.toLowerCase()}.gpx`, xml, 'application/gpx+xml');
    onUpdateDb(appendAuditLog(db, currentUser, 'FIELD_ROUTE_EXPORTED', 'field_missions', mission.id, null, { format: 'GPX' }));
  };

  const syncFieldData = async () => {
    setMessage({ type: 'success', text: 'Synchronizing the current field dataset…' });
    const synced = await flushOfflineQueueToSupabase(db);
    if (!synced) {
      setMessage({ type: 'error', text: 'Sync did not complete. Local records remain available and queued for retry.' });
      return;
    }
    const next: DatabaseState = {
      ...db,
      field_missions: db.field_missions.map((item) => ['Pending Sync', 'Local Only', 'Failed'].includes(item.sync_status) ? { ...item, sync_status: 'Synced' as const } : item),
      field_observations: db.field_observations.map((item) => ['Pending Sync', 'Local Only', 'Failed'].includes(item.sync_status) ? { ...item, sync_status: 'Synced' as const } : item),
      research_specimens: db.research_specimens.map((item) => ['Pending Sync', 'Local Only', 'Failed'].includes(item.sync_status) ? { ...item, sync_status: 'Synced' as const } : item),
    };
    onUpdateDb(appendAuditLog(next, currentUser, 'FIELDWORK_SYNC_COMPLETED', 'field_data', 'batch', null, { mission_count: next.field_missions.length, observation_count: next.field_observations.length, specimen_count: next.research_specimens.length }));
    setMessage({ type: 'success', text: 'Field data sync completed. The service stores a device cache and syncs the application snapshot.' });
  };

  const saveManualGps = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const latitude = Number(form.get('latitude'));
    const longitude = Number(form.get('longitude'));
    const rawAccuracy = form.get('accuracy');
    const accuracy = rawAccuracy === null || String(rawAccuracy).trim() === '' ? null : Number(rawAccuracy);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      setMessage({ type: 'error', text: 'Coordinates must be valid WGS84 latitude (−90 to 90) and longitude (−180 to 180).' });
      return;
    }
    const point = { latitude, longitude, accuracy_m: accuracy !== null && Number.isFinite(accuracy) ? accuracy : null, captured_at: new Date().toISOString() };
    setGps(point);
    setGpsStatus('Manual WGS84 coordinate validated. Confirm accuracy and site before recording.');
    setMessage({ type: 'success', text: 'Manual coordinate validated.' });
  };

  const editObservation = (observation: EnvironmentalObservation) => {
    if (observation.observer_id !== currentUser.id && role !== 'head_of_directorate' && role !== 'system_admin') {
      setMessage({ type: 'error', text: 'You cannot correct another observer’s record.' });
      return;
    }
    const availableMeasurements = MEASUREMENT_FIELDS.filter((field) => observation.measurements[field.key] !== undefined);
    const correctionTarget = window.prompt(
      `Correct one field: ${[...availableMeasurements.map((field) => field.key), 'notes'].join(', ')}`,
      availableMeasurements[0]?.key || 'notes'
    );
    if (!correctionTarget) return;
    const reason = window.prompt('Correction reason (required for traceability):', '');
    if (reason === null || !reason.trim()) return;
    const previousValues = { measurements: observation.measurements, notes: observation.notes };
    let nextMeasurements = observation.measurements;
    let nextNotes = observation.notes;
    let qualityStatus: EnvironmentalObservation['quality_status'] = 'Corrected';
    let qualityFlags = observation.quality_flags;
    if (correctionTarget === 'notes') {
      const correctedNotes = window.prompt('Corrected field notes:', observation.notes);
      if (correctedNotes === null) return;
      nextNotes = correctedNotes.trim();
    } else {
      const field = availableMeasurements.find((item) => item.key === correctionTarget);
      if (!field) {
        setMessage({ type: 'error', text: 'Select a measurement present on this observation.' });
        return;
      }
      const rawValue = window.prompt(`Correct ${field.label} (${field.unit})`, String(observation.measurements[field.key]));
      if (rawValue === null || rawValue.trim() === '') return;
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) {
        setMessage({ type: 'error', text: 'Corrected reading must be numeric.' });
        return;
      }
      nextMeasurements = { ...observation.measurements, [field.key]: numericValue };
      qualityFlags = numericValue < field.min || numericValue > field.max
        ? [`${field.label} outside configured range (${field.min}–${field.max} ${field.unit})`]
        : observation.quality_flags.filter((flag) => !flag.includes(field.label));
      if (qualityFlags.length === 0) qualityStatus = 'Passed';
    }
    const now = new Date().toISOString();
    const updated = {
      ...observation,
      measurements: nextMeasurements,
      notes: nextNotes,
      quality_flags: qualityFlags,
      quality_status: qualityStatus,
      correction_history: [...observation.correction_history, { corrected_by: currentUser.id, corrected_at: now, reason: reason.trim(), previous_values: JSON.stringify(previousValues) }],
      updated_at: now,
      sync_status: initialSyncStatus(),
    };
    commitState({ ...db, field_observations: db.field_observations.map((item) => item.id === observation.id ? updated : item) }, 'FIELD_OBSERVATION_CORRECTION_RECORDED', 'field_observations', observation.id, previousValues, { measurements: nextMeasurements, notes: nextNotes, quality_status: updated.quality_status, correction_reason: reason.trim() });
    setMessage({ type: 'success', text: 'Corrected values saved with the previous readings, reason, actor, and timestamp in the audit history.' });
  };

  const readFieldPhoto = (event: React.ChangeEvent<HTMLInputElement>, setPhoto: (value: string) => void) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 700 * 1024) {
      setMessage({ type: 'error', text: 'Choose an image under 700 KB to avoid exhausting offline device storage.' });
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const distanceMeters = routePoints.slice(1).reduce((sum, point, index) => sum + coordinateDistance(routePoints[index], point), 0);
  const polygonAreaSqMeters = (() => {
    if (routePoints.length < 3) return 0;
    const meanLatitude = routePoints.reduce((sum, point) => sum + point.latitude, 0) / routePoints.length;
    const metersPerLatitude = 111320;
    const metersPerLongitude = 111320 * Math.cos(meanLatitude * Math.PI / 180);
    let twiceArea = 0;
    routePoints.forEach((point, index) => {
      const next = routePoints[(index + 1) % routePoints.length];
      const x1 = point.longitude * metersPerLongitude;
      const y1 = point.latitude * metersPerLatitude;
      const x2 = next.longitude * metersPerLongitude;
      const y2 = next.latitude * metersPerLatitude;
      twiceArea += x1 * y2 - x2 * y1;
    });
    return Math.abs(twiceArea / 2);
  })();

  const missionStats = {
    planned: missions.filter((mission) => ['Draft', 'Pending Approval', 'Approved'].includes(mission.status)).length,
    inProgress: missions.filter((mission) => mission.status === 'In Progress').length,
    completed: missions.filter((mission) => mission.status === 'Completed').length,
    flagged: observations.filter((observation) => observation.quality_status === 'Flagged').length,
  };

  const confirmMissionChecklist = (mission: FieldMission, checklistId: string) => {
    if (!canManageFieldMission(db, currentUser, mission)) return;
    const now = new Date().toISOString();
    const updated = {
      ...mission,
      checklist: mission.checklist.map((item) => item.id === checklistId ? { ...item, complete: !item.complete } : item),
      progress: mission.checklist.length ? Math.round((mission.checklist.filter((item) => item.id === checklistId ? !item.complete : item.complete).length / mission.checklist.length) * 100) : 0,
      updated_at: now,
    };
    commitState({ ...db, field_missions: db.field_missions.map((item) => item.id === mission.id ? updated : item) }, 'FIELD_MISSION_CHECKLIST_UPDATED', 'field_missions', mission.id, mission.checklist, updated.checklist);
  };

  const createStationPhoto = (event: React.ChangeEvent<HTMLInputElement>) => readFieldPhoto(event, setStationPhoto);

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase text-teal-800 dark:text-teal-300">KMFRI · {getDirectorateById(db, currentUser.directorate_id)?.code || 'HQ'}</p><h1 className="mt-1 text-2xl font-bold">GIS &amp; Field Research</h1><p className="mt-1 text-sm text-slate-500">Authorized station atlas, missions, sampling, specimens, and offline field records.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setShowMissionForm((shown) => !shown); setMissionProposal(false); }} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold hover:border-teal-500 dark:border-slate-700"><Plus className="h-4 w-4" />Plan mission</button><button type="button" onClick={captureGps} className="inline-flex items-center gap-2 rounded-md bg-[#087969] px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"><Crosshair className="h-4 w-4" />Capture GPS</button></div>
      </header>

      {message && <div role="status" className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-xs ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'}`}><span>{message.text}</span><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div>}

      <nav aria-label="GIS and field research views" className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-1 dark:border-slate-800">
        {FIELD_TABS.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex shrink-0 items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-semibold ${activeTab === tab.id ? 'border-b-2 border-teal-700 text-teal-900 dark:text-teal-200' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}><Icon className="h-3.5 w-3.5" />{tab.label}</button>; })}
      </nav>

      {showMissionForm && <form onSubmit={createMission} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-3">
        <div className="lg:col-span-3 flex items-center justify-between"><h2 className="font-semibold">Plan field mission</h2><button type="button" onClick={() => setShowMissionForm(false)} className="text-xs text-slate-500">Close</button></div>
        <label className="space-y-1 text-xs"><span className="font-semibold">Mission name</span><input required value={missionTitle} onChange={(event) => setMissionTitle(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">Linked assigned project</span><select required value={missionProjectId} onChange={(event) => setMissionProjectId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><option value="">Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.title}</option>)}</select></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">Target station</span><select value={missionStationId} onChange={(event) => setMissionStationId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><option value="">Select station</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.station_code || location.name} · {location.name}</option>)}</select></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">Objectives</span><textarea rows={3} value={missionObjectives} onChange={(event) => setMissionObjectives(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">Start</span><input type="datetime-local" required value={missionStartAt} onChange={(event) => setMissionStartAt(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">End</span><input type="datetime-local" required value={missionEndAt} onChange={(event) => setMissionEndAt(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">Equipment requirements</span><textarea rows={2} value={missionEquipment} onChange={(event) => setMissionEquipment(event.target.value)} placeholder="Instruments, PPE, sampling containers" className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">Transport requirements</span><textarea rows={2} value={missionTransport} onChange={(event) => setMissionTransport(event.target.value)} placeholder="Vessel, vehicle, launch time, fuel" className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></label>
        <label className="space-y-1 text-xs"><span className="font-semibold">Safety notes</span><textarea rows={2} value={missionSafety} onChange={(event) => setMissionSafety(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></label>
        <div className="flex flex-wrap items-end gap-2"><button type="submit" onClick={() => setMissionProposal(false)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">Save draft</button><button type="submit" onClick={() => setMissionProposal(true)} className="rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white">Submit for approval</button></div>
        <p className="lg:col-span-3 text-[11px] text-slate-500">Route currently has {routePoints.length} point(s). Draw or import coordinates on the map before saving if needed.</p>
      </form>}

      {activeTab === 'overview' && <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
          { label: 'Authorized stations', value: locations.filter((location) => location.operational_status !== 'Archived').length, icon: MapPin },
          { label: 'Planned / awaiting approval', value: missionStats.planned, icon: Route },
          { label: 'Missions in progress', value: missionStats.inProgress, icon: Navigation },
          { label: 'Observation quality flags', value: missionStats.flagged, icon: AlertCircle },
        ].map((metric) => { const Icon = metric.icon; return <div key={metric.label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{metric.label}</span><Icon className="h-4 w-4 text-teal-700" /></div><div className="mt-3 text-2xl font-bold tabular-nums">{metric.value}</div></div>; })}</div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800"><div><h2 className="text-sm font-semibold">Field coverage</h2><p className="mt-1 text-xs text-slate-500">Authorized locations with recorded observation history</p></div><button type="button" onClick={() => setActiveTab('map')} className="text-xs font-semibold text-teal-800">Open map <ChevronRight className="inline h-3 w-3" /></button></div><div className="grid grid-cols-2 gap-4 p-4"><div><div className="text-[11px] text-slate-500">Sites with observations</div><div className="mt-1 text-xl font-bold">{new Set(observations.map((item) => item.station_id).filter(Boolean)).size}</div></div><div><div className="text-[11px] text-slate-500">Specimens registered</div><div className="mt-1 text-xl font-bold">{specimens.length}</div></div></div></section>
          <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800"><div><h2 className="text-sm font-semibold">Next field activity</h2><p className="mt-1 text-xs text-slate-500">Upcoming authorized missions</p></div><button type="button" onClick={() => setActiveTab('missions')} className="text-xs font-semibold text-teal-800">All missions</button></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{missions.filter((mission) => mission.start_at >= new Date().toISOString() && mission.status !== 'Cancelled').sort((a, b) => a.start_at.localeCompare(b.start_at)).slice(0, 3).map((mission) => <div key={mission.id} className="flex items-center justify-between gap-3 p-3"><div className="min-w-0"><div className="truncate text-xs font-semibold">{mission.title}</div><div className="text-[10px] text-slate-500">{mission.mission_code} · {mission.status}</div></div><time className="shrink-0 font-mono text-xs">{new Date(mission.start_at).toLocaleDateString()}</time></div>)}{missions.filter((mission) => mission.start_at >= new Date().toISOString() && mission.status !== 'Cancelled').length === 0 && <p className="p-6 text-center text-xs text-slate-500">No upcoming field missions in your authorized projects.</p>}</div></section>
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setActiveTab('observations')} className="rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white">Record observation</button><button type="button" onClick={() => setActiveTab('specimens')} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">Register specimen</button><button type="button" onClick={() => setActiveTab('offline')} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">Offline status</button></div>
      </>}

      {activeTab === 'map' && <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 dark:border-slate-800 xl:flex-row xl:items-center xl:justify-between"><div className="flex flex-wrap gap-2"><select value={ecosystemFilter} onChange={(event) => setEcosystemFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="ALL">All habitats</option>{['Marine & Coastal', 'Freshwater Lake / River', 'Aquaculture Station', 'Socioeconomic Community Site'].map((value) => <option key={value}>{value}</option>)}</select><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="ALL">All assigned projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.title}</option>)}</select><select value={mapStyle} onChange={(event) => setMapStyle(event.target.value as keyof typeof TILE_LAYERS)} className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="marine">Satellite marine</option><option value="voyager">Coastal streets</option><option value="dark">Dark marine</option></select><button type="button" onClick={() => setShowBorders((visible) => !visible)} className={`rounded-md border px-2.5 py-2 text-xs ${showBorders ? 'border-teal-600 text-teal-800' : 'border-slate-300 text-slate-500'}`}>Kenya boundaries</button></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDrawRoute((active) => !active)} className={`rounded-md px-2.5 py-2 text-xs font-semibold ${drawRoute ? 'bg-amber-500 text-slate-950' : 'border border-slate-300 dark:border-slate-700'}`}>{drawRoute ? 'Drawing route: click map' : 'Draw route'}</button><button type="button" onClick={() => setRoutePoints([])} className="rounded-md border border-slate-300 px-2.5 py-2 text-xs dark:border-slate-700">Clear route</button><label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-2 text-xs dark:border-slate-700"><Upload className="h-3.5 w-3.5" />Import GPX/CSV/GeoJSON<input type="file" accept=".gpx,.csv,.json,.geojson" onChange={captureRouteFile} className="hidden" /></label><button type="button" onClick={exportStationsGeoJson} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-2 text-xs dark:border-slate-700"><Download className="h-3.5 w-3.5" />GeoJSON</button></div></div>
        <div ref={mapElementRef} className="h-[55vh] min-h-[360px] w-full" />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-3 text-xs dark:border-slate-800"><span>{filteredLocations.length} authorized stations · {visibleObservations.length} observations · {routePoints.length} route points</span><span>{routePoints.length > 1 ? `Route ${distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(2)} km` : `${distanceMeters.toFixed(0)} m`}${polygonAreaSqMeters ? ` · Area ${(polygonAreaSqMeters / 1000000).toFixed(3)} km²` : ''}` : 'Map coordinates use WGS84 / EPSG:4326'}</span></div>
      </section>}

      {activeTab === 'stations' && <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><h2 className="font-semibold">Research station registry</h2><p className="mt-1 text-xs text-slate-500">{locations.length} stations in your permitted map scope.</p></div><div className="flex gap-2"><label className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a station" className="w-44 rounded-md border border-slate-300 py-1.5 pl-8 pr-2 text-xs dark:border-slate-700 dark:bg-slate-900" /></label>{canManageSelectedStation() && <button type="button" onClick={() => setShowStationForm((shown) => !shown)} className="inline-flex items-center gap-1 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />New station</button>}</div></div>
        {showStationForm && <form onSubmit={createStation} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3"><label className="space-y-1 text-xs"><span className="font-semibold">Station name</span><input required value={stationName} onChange={(event) => setStationName(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span className="font-semibold">Station ID</span><input value={stationCode} onChange={(event) => setStationCode(event.target.value)} placeholder="Generated if empty" className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span className="font-semibold">County</span><input value={stationCounty} onChange={(event) => setStationCounty(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span className="font-semibold">Latitude</span><input required type="number" step="any" value={stationLat} onChange={(event) => setStationLat(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span className="font-semibold">Longitude</span><input required type="number" step="any" value={stationLng} onChange={(event) => setStationLng(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span className="font-semibold">Ecosystem</span><select value={stationHabitat} onChange={(event) => setStationHabitat(event.target.value as ResearchLocation['ecosystem_type'])} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">{['Marine & Coastal', 'Freshwater Lake / River', 'Aquaculture Station', 'Socioeconomic Community Site'].map((item) => <option key={item}>{item}</option>)}</select></label><label className="space-y-1 text-xs"><span className="font-semibold">Associated project</span><select value={stationProjectId} onChange={(event) => setStationProjectId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="">Directorate station</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.title}</option>)}</select></label><label className="space-y-1 text-xs"><span className="font-semibold">Programme / habitat</span><input value={stationProgram} onChange={(event) => setStationProgram(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span className="font-semibold">Site photograph (max 700 KB)</span><input type="file" accept="image/*" onChange={createStationPhoto} className="block w-full text-[10px]" /></label><div className="flex items-end gap-2"><button type="button" onClick={captureGps} className="rounded-md border border-slate-300 px-3 py-2 text-xs dark:border-slate-700">Use GPS</button><button type="submit" className="rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white">Save station</button></div></form>}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60"><tr>{['ID / Station', 'Habitat & program', 'Coordinates', 'Lead / status', ''].map((label) => <th key={label} className="px-3 py-2.5 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filteredLocations.map((station) => <tr key={station.id}><td className="px-3 py-3"><div className="font-semibold">{station.station_code || station.name}</div><div className="text-[10px] text-slate-500">{station.county} · {station.site}</div></td><td className="px-3 py-3"><div>{station.ecosystem_type}</div><div className="text-[10px] text-slate-500">{station.research_program || station.marine_area}</div></td><td className="px-3 py-3 font-mono">{station.latitude.toFixed(5)}, {station.longitude.toFixed(5)}</td><td className="px-3 py-3"><div>{getUserById(db, station.responsible_user_id || null)?.full_name || 'KMFRI station'}</div><div className="text-[10px] text-slate-500">{station.operational_status || 'Active'} · {station.approval_status || 'Approved'}</div></td><td className="px-3 py-3 text-right"><button type="button" onClick={() => { setActiveTab('map'); setGps({ latitude: station.latitude, longitude: station.longitude, captured_at: new Date().toISOString() }); }} className="rounded border border-slate-200 px-2 py-1 text-[10px] dark:border-slate-700">Map</button>{canReviewFieldStation(db, currentUser, station) && <button type="button" onClick={() => reviewStation(station, true)} className="ml-1 rounded bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white">Approve</button>}{canManageFieldStation(db, currentUser, station.directorate_id, station.project_id) && station.operational_status !== 'Archived' && <><button type="button" onClick={() => editStation(station)} className="ml-1 rounded border border-teal-200 px-2 py-1 text-[10px] text-teal-800">Edit</button><button type="button" onClick={() => archiveStation(station)} className="ml-1 rounded border border-amber-200 px-2 py-1 text-[10px] text-amber-800">Archive</button></>}</td></tr>)}{filteredLocations.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No authorized stations match your filters.</td></tr>}</tbody></table></div>
      </section>}

      {activeTab === 'missions' && <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Field missions</h2><p className="mt-1 text-xs text-slate-500">Draft, schedule, approve, and track project-linked fieldwork.</p></div><button type="button" onClick={() => { setShowMissionForm(true); setMissionProposal(false); }} className="rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white">Plan mission</button></div>
        {visibleMissions.length ? visibleMissions.map((mission) => <article key={mission.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-bold text-teal-800">{mission.mission_code}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] dark:bg-slate-800">{mission.status}</span></div><h3 className="mt-1 text-sm font-semibold">{mission.title}</h3><p className="mt-1 text-xs text-slate-500">{mission.objectives || 'No objectives entered.'}</p></div><div className="text-right text-xs text-slate-500">{new Date(mission.start_at).toLocaleString()}<br />to {new Date(mission.end_at).toLocaleString()}</div></div><div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-[10px] dark:border-slate-800"><span>{mission.route_coordinates.length} route points</span><span>·</span><span>{mission.station_ids.length} target stations</span><span>·</span><span>Lead: {getUserById(db, mission.mission_lead_id)?.full_name || 'Researcher'}</span><span className="ml-auto rounded bg-slate-50 px-2 py-1 dark:bg-slate-800">{mission.sync_status}</span></div>{mission.checklist.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{mission.checklist.map((item) => <button key={item.id} type="button" onClick={() => confirmMissionChecklist(mission, item.id)} className={`rounded border px-2 py-1 text-[10px] ${item.complete ? 'border-emerald-300 text-emerald-800' : 'border-slate-200'}`}>{item.complete ? '✓ ' : ''}{item.label}</button>)}</div>}<div className="mt-3 flex flex-wrap gap-2">{canReviewFieldMission(db, currentUser, mission) && <><button type="button" onClick={() => reviewMission(mission, true)} className="rounded bg-emerald-700 px-2.5 py-1.5 text-[10px] font-semibold text-white">Approve</button><button type="button" onClick={() => reviewMission(mission, false)} className="rounded border border-red-300 px-2.5 py-1.5 text-[10px] text-red-700">Reject</button></>}{mission.status === 'Approved' && canManageFieldMission(db, currentUser, mission) && <button type="button" onClick={() => updateMissionStatus(mission, 'In Progress')} className="rounded bg-teal-800 px-2.5 py-1.5 text-[10px] font-semibold text-white">Start mission</button>}{mission.status === 'In Progress' && canManageFieldMission(db, currentUser, mission) && <button type="button" onClick={() => updateMissionStatus(mission, 'Completed')} className="rounded bg-emerald-700 px-2.5 py-1.5 text-[10px] font-semibold text-white">Complete mission</button>}{mission.route_coordinates.length > 1 && <button type="button" onClick={() => exportMissionGpx(mission)} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-[10px] dark:border-slate-700"><Download className="h-3 w-3" />GPX route</button>}</div></article>) : <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700"><Route className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-semibold">No field missions</p><p className="mt-1 text-xs text-slate-500">Create a draft or submit a mission for directorate review.</p></div>}
      </section>}

      {activeTab === 'gps' && <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <form onSubmit={saveManualGps} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><h2 className="font-semibold">GPS &amp; sampling position</h2><p className="mt-1 text-xs text-slate-500">Browser GPS requires HTTPS and device permission. Coordinates are stored as WGS84 / EPSG:4326.</p></div><div className={`rounded-md px-3 py-2 text-xs ${gpsStatus.includes('low accuracy') ? 'bg-amber-50 text-amber-800' : gps ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}`}>{gpsStatus}</div><div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs"><span>Latitude</span><input name="latitude" required type="number" step="any" defaultValue={gps?.latitude ?? ''} key={`lat-${gps?.latitude ?? 'empty'}`} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span>Longitude</span><input name="longitude" required type="number" step="any" defaultValue={gps?.longitude ?? ''} key={`lon-${gps?.longitude ?? 'empty'}`} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label></div><label className="block space-y-1 text-xs"><span>GPS accuracy (metres)</span><input name="accuracy" type="number" min="0" step="any" defaultValue={gps?.accuracy_m ?? ''} key={`acc-${gps?.accuracy_m ?? 'empty'}`} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><div className="flex flex-wrap gap-2"><button type="button" onClick={captureGps} className="rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white">Capture device GPS</button><button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">Validate manual coordinate</button></div>{gps && <div className="text-[11px] text-slate-500">Captured: {gps.captured_at ? new Date(gps.captured_at).toLocaleString() : 'manual'} · Elevation {gps.elevation_m == null ? 'not available' : `${gps.elevation_m.toFixed(1)} m`}</div>}</form>
        <form onSubmit={createObservation} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 sm:grid-cols-2"><div className="sm:col-span-2"><h2 className="font-semibold">Record sample or observation</h2></div><label className="space-y-1 text-xs"><span>Assigned project</span><select required value={observationProjectId} onChange={(event) => setObservationProjectId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="">Select</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.title}</option>)}</select></label><label className="space-y-1 text-xs"><span>Station</span><select value={observationStationId} onChange={(event) => setObservationStationId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="">Unspecified</option>{locations.map((station) => <option key={station.id} value={station.id}>{station.station_code || station.name}</option>)}</select></label><label className="space-y-1 text-xs"><span>Mission</span><select value={observationMissionId} onChange={(event) => setObservationMissionId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="">Unspecified</option>{missions.filter((mission) => !observationProjectId || mission.project_id === observationProjectId).map((mission) => <option key={mission.id} value={mission.id}>{mission.mission_code} · {mission.title}</option>)}</select></label><label className="space-y-1 text-xs"><span>Observation type</span><select value={observationType} onChange={(event) => setObservationType(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">{['Water quality', 'Marine biodiversity', 'Fisheries survey', 'Coastal habitat', 'Freshwater ecology', 'Weather / tide'].map((type) => <option key={type}>{type}</option>)}</select></label><label className="space-y-1 text-xs"><span>Sampling method</span><input value={samplingMethod} onChange={(event) => setSamplingMethod(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label>{MEASUREMENT_FIELDS.map((field) => <label key={field.key} className="space-y-1 text-xs"><span>{field.label} {field.unit && `(${field.unit})`}</span><input type="number" step="any" value={measurements[field.key] || ''} onChange={(event) => setMeasurements((current) => ({ ...current, [field.key]: event.target.value }))} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label>)}<label className="space-y-1 text-xs"><span>Weather / conditions</span><input value={weather} onChange={(event) => setWeather(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span>Notes</span><input value={environmentNotes} onChange={(event) => setEnvironmentNotes(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><button type="submit" className="sm:col-span-2 rounded-md bg-[#087969] px-3 py-2 text-xs font-semibold text-white">Save observation</button></form>
      </section>}

      {activeTab === 'observations' && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><div className="text-xs"><div className="font-semibold">Observation field photo</div><div className="text-[10px] text-slate-500">{observationPhoto ? 'Photo attached for the next observation' : 'Optional image, limited to 700 KB for offline storage'}</div></div><input type="file" accept="image/*" onChange={(event) => readFieldPhoto(event, setObservationPhoto)} className="max-w-56 text-[10px]" /></div>}
      {activeTab === 'observations' && <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Environmental observations</h2><p className="mt-1 text-xs text-slate-500">Original readings and traceable correction records.</p></div><div className="flex gap-2"><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="ALL">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code}</option>)}</select><button type="button" onClick={exportObservationsCsv} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-700"><Download className="h-3.5 w-3.5" />Export CSV</button></div></div><div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60"><tr>{['Type / recorded', 'Position', 'Measurements', 'Quality', ''].map((label) => <th key={label} className="px-3 py-2.5 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{visibleObservations.map((observation) => <tr key={observation.id}><td className="px-3 py-3"><div className="font-semibold">{observation.observation_type}</div><div className="text-[10px] text-slate-500">{new Date(observation.observed_at).toLocaleString()} · {getUserById(db, observation.observer_id)?.full_name}</div></td><td className="px-3 py-3 font-mono">{observation.coordinate.latitude.toFixed(5)}, {observation.coordinate.longitude.toFixed(5)}<div className="text-[10px] text-slate-500">±{observation.coordinate.accuracy_m ?? '—'} m</div></td><td className="px-3 py-3">{MEASUREMENT_FIELDS.filter((field) => observation.measurements[field.key] !== undefined).map((field) => `${field.label} ${observation.measurements[field.key]} ${observation.measurement_units[field.key]}`).join(' · ') || 'No measurements'}</td><td className="px-3 py-3"><span className={observation.quality_status === 'Flagged' ? 'font-semibold text-red-700' : observation.quality_status === 'Passed' ? 'text-emerald-700' : 'text-slate-500'}>{observation.quality_status}</span>{observation.quality_flags.length > 0 && <div className="max-w-52 text-[10px] text-red-700">{observation.quality_flags.join('; ')}</div>}</td><td className="px-3 py-3 text-right">{(observation.observer_id === currentUser.id || role === 'head_of_directorate' || role === 'system_admin') && <button type="button" onClick={() => editObservation(observation)} className="rounded border border-slate-300 px-2 py-1 text-[10px] dark:border-slate-700">Record correction</button>}</td></tr>)}{visibleObservations.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No observations recorded in this project scope.</td></tr>}</tbody></table></div></section>}

      {activeTab === 'specimens' && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><div className="text-xs"><div className="font-semibold">Specimen field photo</div><div className="text-[10px] text-slate-500">{specimenPhoto ? 'Photo attached for the next specimen' : 'Optional image, limited to 700 KB for offline storage'}</div></div><input type="file" accept="image/*" onChange={(event) => readFieldPhoto(event, setSpecimenPhoto)} className="max-w-56 text-[10px]" /></div>}
      {activeTab === 'specimens' && <section className="space-y-4"><form onSubmit={createSpecimen} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3"><div className="md:col-span-3"><h2 className="font-semibold">Register specimen / sample</h2><p className="mt-1 text-xs text-slate-500">A unique KMFRI identifier and custody history will be attached.</p></div><label className="space-y-1 text-xs"><span>Project</span><select required value={specimenProjectId} onChange={(event) => setSpecimenProjectId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="">Select assigned project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.title}</option>)}</select></label><label className="space-y-1 text-xs"><span>Mission</span><select value={specimenMissionId} onChange={(event) => setSpecimenMissionId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="">Unspecified</option>{missions.filter((mission) => !specimenProjectId || mission.project_id === specimenProjectId).map((mission) => <option key={mission.id} value={mission.id}>{mission.mission_code} · {mission.title}</option>)}</select></label><label className="space-y-1 text-xs"><span>Station</span><select value={specimenStationId} onChange={(event) => setSpecimenStationId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="">Unspecified</option>{locations.map((station) => <option key={station.id} value={station.id}>{station.station_code || station.name}</option>)}</select></label><label className="space-y-1 text-xs"><span>Sample type</span><select value={specimenType} onChange={(event) => setSpecimenType(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">{['Water sample', 'Sediment', 'Tissue', 'Fin clip', 'Plankton', 'Invertebrate', 'Fish specimen', 'Other'].map((type) => <option key={type}>{type}</option>)}</select></label><label className="space-y-1 text-xs"><span>Species (if known)</span><input value={speciesName} onChange={(event) => setSpeciesName(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span>Preservation</span><input value={preservationMethod} onChange={(event) => setPreservationMethod(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="space-y-1 text-xs"><span>Storage location</span><input value={storageLocation} onChange={(event) => setStorageLocation(event.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><div className="flex items-end gap-2"><button type="button" onClick={captureGps} className="rounded-md border border-slate-300 px-3 py-2 text-xs dark:border-slate-700">Capture GPS</button><button type="submit" className="rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white">Register sample</button></div></form>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60"><tr>{['Sample ID', 'Type / species', 'Collected', 'Location', 'Status', 'Custody'].map((label) => <th key={label} className="px-3 py-2.5 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{visibleSpecimens.map((specimen) => { const transfer = db.specimen_transfers.find((item) => item.specimen_id === specimen.id && item.status === 'Awaiting Receipt'); return <tr key={specimen.id}><td className="px-3 py-3"><div className="font-mono font-bold text-teal-800">{specimen.sample_code}</div><div className="text-[10px] text-slate-500">{specimen.qr_payload}</div></td><td className="px-3 py-3">{specimen.specimen_type}<div className="text-[10px] text-slate-500">{specimen.species_name || specimen.identification_status}</div></td><td className="px-3 py-3">{new Date(specimen.collected_at).toLocaleString()}<div className="text-[10px] text-slate-500">{getUserById(db, specimen.collected_by)?.full_name}</div></td><td className="px-3 py-3 font-mono">{specimen.coordinate.latitude.toFixed(4)}, {specimen.coordinate.longitude.toFixed(4)}</td><td className="px-3 py-3">{specimen.status}</td><td className="px-3 py-3">{transfer ? <button type="button" onClick={() => receiveTransfer(transfer)} className="rounded bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">Confirm receipt</button> : <button type="button" onClick={() => setSelectedSpecimenId(specimen.id)} className="rounded border border-slate-300 px-2 py-1 text-[10px] dark:border-slate-700">Transfer</button>}</td></tr>; })}{visibleSpecimens.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No specimens recorded yet.</td></tr>}</tbody></table></div>
        {selectedSpecimenId && <form onSubmit={createTransfer} className="grid grid-cols-1 gap-3 rounded-lg border border-teal-200 bg-teal-50 p-4 dark:border-teal-900 dark:bg-teal-950/30 sm:grid-cols-4"><div className="sm:col-span-4 text-xs font-semibold">Transfer {visibleSpecimens.find((item) => item.id === selectedSpecimenId)?.sample_code}</div><label className="space-y-1 text-xs"><span>From location</span><input required name="from_location" className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 dark:bg-slate-900" /></label><label className="space-y-1 text-xs"><span>To location / lab</span><input required name="to_location" className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 dark:bg-slate-900" /></label><label className="space-y-1 text-xs"><span>Purpose / analysis</span><input name="purpose" className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 dark:bg-slate-900" /></label><button type="submit" className="self-end rounded bg-teal-800 px-3 py-2 text-xs font-semibold text-white">Start custody transfer</button></form>}</section>}

      {activeTab === 'offline' && <section className="grid grid-cols-1 gap-4 xl:grid-cols-2"><div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2">{syncSnapshot.isOnline ? <Wifi className="h-5 w-5 text-emerald-700" /> : <WifiOff className="h-5 w-5 text-amber-700" />}<h2 className="font-semibold">Field device connectivity</h2></div><p className="mt-2 text-sm">{syncSnapshot.isOnline ? 'Online; new records are saved locally and sent through the existing application sync.' : 'Offline; records are kept in the device cache and queued for retry.'}</p><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="rounded bg-slate-50 p-3 dark:bg-slate-800"><div className="text-slate-500">Pending queue</div><div className="mt-1 text-lg font-bold">{syncSnapshot.pendingMutations.length}</div></div><div className="rounded bg-slate-50 p-3 dark:bg-slate-800"><div className="text-slate-500">Last sync</div><div className="mt-1 font-semibold">{syncSnapshot.lastSyncedAt ? new Date(syncSnapshot.lastSyncedAt).toLocaleString() : 'Not recorded'}</div></div></div><button type="button" onClick={syncFieldData} disabled={!syncSnapshot.isOnline} className="mt-4 inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><ArrowDownToLine className="h-4 w-4" />Sync Now</button></div><div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><h2 className="font-semibold">Offline storage and conflict handling</h2><p className="mt-2">The existing app stores a full state snapshot in browser storage and the service-worker cache, then syncs that snapshot through Supabase. It does not use isolated IndexedDB records or detect concurrent revisions. Concurrent edits from multiple devices may overwrite newer server state. Sync one device at a time and export important field records before reconnecting until server-side revision checks and conflict review are added.</p><p className="mt-3">Before departure, open assigned project and station records once so they are available in the device cache. Keep attached images under 700 KB to reduce browser storage pressure.</p></div><div className="xl:col-span-2 overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60"><tr><th className="px-3 py-2">Record</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Sync state</th><th className="px-3 py-2">Updated</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{[...missions.map((item) => ({ id: item.id, name: item.mission_code, type: 'Mission', status: item.sync_status, date: item.updated_at })), ...observations.map((item) => ({ id: item.id, name: item.observation_type, type: 'Observation', status: item.sync_status, date: item.updated_at })), ...specimens.map((item) => ({ id: item.id, name: item.sample_code, type: 'Specimen', status: item.sync_status, date: item.updated_at }))].slice(0, 20).map((record) => <tr key={record.id}><td className="px-3 py-2">{record.name}</td><td className="px-3 py-2">{record.type}</td><td className="px-3 py-2">{record.status}</td><td className="px-3 py-2">{new Date(record.date).toLocaleString()}</td></tr>)}{missions.length + observations.length + specimens.length === 0 && <tr><td colSpan={4} className="px-3 py-7 text-center text-slate-500">No field records in the current authorized scope.</td></tr>}</tbody></table></div></section>}

      {activeTab === 'analytics' && <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Spatial coverage &amp; data quality</h2><p className="mt-1 text-xs text-slate-500">Counts are computed from authorized observed records; no inferred readings are displayed.</p></div><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="ALL">All assigned projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.title}</option>)}</select></div><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[{ label: 'Stations in scope', value: locations.filter((location) => !focusedProjectId || location.project_id === focusedProjectId || !location.project_id).length }, { label: 'Sampling missions', value: visibleMissions.length }, { label: 'Field observations', value: visibleObservations.length }, { label: 'Specimens', value: visibleSpecimens.length }].map((metric) => <div key={metric.label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="text-xs text-slate-500">{metric.label}</div><div className="mt-2 text-2xl font-bold">{metric.value}</div></div>)}</div><div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h3 className="text-sm font-semibold">Observation measurements</h3><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{MEASUREMENT_FIELDS.map((field) => { const values = visibleObservations.map((observation) => Number(observation.measurements[field.key])).filter(Number.isFinite); const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; return <div key={field.key} className="rounded-md bg-slate-50 p-3 dark:bg-slate-800"><div className="text-xs text-slate-500">{field.label}</div><div className="mt-1 text-lg font-semibold">{average == null ? 'No readings' : `${average.toFixed(2)} ${field.unit}`}</div><div className="text-[10px] text-slate-500">{values.length} observed record(s); arithmetic mean, no imputation.</div></div>; })}</div></div></section>}

      {activeTab === 'reports' && <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Field reports</h2><p className="mt-1 text-xs text-slate-500">Export authorized field observations and mission records.</p></div><div className="flex gap-2"><button type="button" onClick={exportStationsGeoJson} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs dark:border-slate-700"><Download className="h-3.5 w-3.5" />Stations GeoJSON</button><button type="button" onClick={exportObservationsCsv} className="inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-3 py-2 text-xs font-semibold text-white"><Download className="h-3.5 w-3.5" />Observations CSV</button></div></div><div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-semibold">Mission completion reports</h3><div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{missions.filter((mission) => mission.status === 'Completed').map((mission) => <div key={mission.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><div className="text-xs font-semibold">{mission.mission_code} · {mission.title}</div><div className="mt-1 text-[10px] text-slate-500">{mission.completion_notes || 'No debrief added.'} · {mission.route_coordinates.length} route points</div></div><button type="button" onClick={() => downloadText(`${mission.mission_code}-report.json`, JSON.stringify({ mission, observations: observations.filter((item) => item.mission_id === mission.id), specimens: specimens.filter((item) => item.mission_id === mission.id) }, null, 2), 'application/json')} className="rounded border border-slate-300 px-2.5 py-1.5 text-[10px] dark:border-slate-700">Download JSON</button></div>)}{missions.filter((mission) => mission.status === 'Completed').length === 0 && <p className="py-5 text-center text-xs text-slate-500">Completed missions will appear here for reporting.</p>}</div></div></section>}
    </div>
  );
};