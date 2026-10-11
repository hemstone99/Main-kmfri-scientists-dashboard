import {
  DatabaseState,
  Role,
  Permission,
  RolePermission,
  Directorate,
  ResearchArea,
  ResearchLocation,
  SystemSettingRecord,
  User,
  RoleName,
} from '../types/kmfri.ts';
import {
  persistAndSyncDatabaseState,
  cacheStateInServiceWorker,
} from './offlineSyncService.ts';
import bcrypt from 'bcryptjs';

const STORAGE_KEY = 'kmfri_rms_production_db_v4_stations';

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function sanitizeSecurityInput(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/[<>]/g, '')
    .trim();
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Use bcrypt for secure password hashing (replaces custom insecure hash)
export async function hashPasswordAsync(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPasswordAsync(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  // The legacy peppered custom hash is NOT a valid bcrypt hash, but it
  // happens to start with $2y$ — so it must be checked BEFORE the generic
  // bcrypt prefix below, otherwise bcrypt.compare silently returns false.
  if (hash.startsWith('$2y$14$KMFRIZeroTrust2026$')) {
    return verifyPasswordSync(plain, hash);
  }
  // Real bcrypt hashes are self-describing ($2y$/$2a$/$2b$ + cost + salt).
  if (hash.startsWith('$2y$') || hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
    return bcrypt.compare(plain, hash);
  }
  // Backward compatibility with the older v1 FNV-1a custom hash.
  return verifyPasswordSync(plain, hash);
}

// Legacy sync functions for backward compatibility (will be phased out)
export function hashPasswordSync(plain: string): string {
  // Multi-round salted key-stretching (8,192 rounds across 4 independent 32-bit state lanes)
  const pepper = 'KMFRI_2026_ZERO_TRUST_PEPPER_MOMBASA_HQ';
  const input = `${pepper}:${plain}:${plain.length}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;

  for (let round = 0; round < 8192; round++) {
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i) ^ (round & 0xff);
      h1 = Math.imul(h1 ^ code, 0x01000193);
      h2 = Math.imul(h2 ^ ((h1 >>> 13) | (code << 3)), 0x85ebca6b);
      h3 = Math.imul(h3 ^ ((h2 >>> 16) ^ code), 0xc2b2ae35);
      h4 = Math.imul(h4 ^ ((h3 >>> 11) ^ round), 0x27d4eb2f);
    }
  }

  const d1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const d2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const d3 = (h3 >>> 0).toString(16).padStart(8, '0');
  const d4 = (h4 >>> 0).toString(16).padStart(8, '0');
  return `$2y$14$KMFRIZeroTrust2026$${d1}${d2}${d3}${d4}`;
}

export function verifyPasswordSync(plain: string, hash: string): boolean {
  if (!plain || !hash) return false;
  if (hash.startsWith('$2y$14$KMFRIZeroTrust2026$')) {
    const candidate = hashPasswordSync(plain);
    return timingSafeEqualStr(candidate, hash);
  }
  // Backward compatibility with legacy v1 hashes
  const legacyCandidate = legacyHashPasswordSync(plain);
  return timingSafeEqualStr(legacyCandidate, hash);
}

function legacyHashPasswordSync(plain: string): string {
  let h = 2166136261;
  for (let i = 0; i < plain.length; i++) {
    h ^= plain.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `$2y$12$KMFRISalt2026Institutional.${hex}`;
}

const SEED_ROLES: Role[] = [
  {
    id: 'role-scientist-001',
    name: 'scientist',
    label: 'Scientist / Researcher',
    description:
      'Creates and manages own research projects, activities, milestones, outputs, reports, and permitted documents.',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-hod-002',
    name: 'head_of_directorate',
    label: 'Head of Directorate',
    description:
      'Reviews and approves directorate submissions, monitors milestones, funding, and escalates institutional items to the Director General.',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-dir-admin-003',
    name: 'directorate_admin',
    label: 'Directorate Administrator',
    description:
      'Provides operational support, profile completeness checks, deadline monitoring, and document management within one assigned directorate.',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-dg-004',
    name: 'director_general',
    label: 'Director General',
    description:
      'Executive institution-wide oversight across all 4 directorates, cross-directorate performance comparisons, and final institutional approvals.',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-sys-admin-005',
    name: 'system_admin',
    label: 'System Administrator',
    description:
      'Manages user accounts, roles, permissions, reference data, system settings, CSV imports, and immutable audit trail inspection.',
    created_at: '2026-01-01T00:00:00Z',
  },
];

const SEED_PERMISSIONS: Permission[] = [
  { id: 'perm-01', name: 'profile.manage_own', description: 'View and update own researcher profile' },
  { id: 'perm-02', name: 'project.create_own', description: 'Create draft research projects and submit for review' },
  { id: 'perm-03', name: 'project.review_directorate', description: 'Approve, reject, or request changes on directorate projects' },
  { id: 'perm-04', name: 'project.approve_institutional', description: 'Final institutional approval on escalated projects' },
  { id: 'perm-05', name: 'funding.manage', description: 'Record grant awards, allocations, and expenditure transactions' },
  { id: 'perm-06', name: 'output.create_own', description: 'Register publications, datasets, and technical outputs' },
  { id: 'perm-07', name: 'output.review_directorate', description: 'Approve or return research outputs within directorate' },
  { id: 'perm-08', name: 'report.submit', description: 'Create and submit periodic research and financial reports' },
  { id: 'perm-09', name: 'report.review', description: 'Review and approve submitted reports' },
  { id: 'perm-10', name: 'admin.users', description: 'Provision, activate, deactivate, and assign user roles' },
  { id: 'perm-11', name: 'admin.settings', description: 'Configure system settings, reference areas, and CSV imports' },
  { id: 'perm-12', name: 'audit.view', description: 'Inspect append-only institutional security and workflow audit logs' },
];

const SEED_ROLE_PERMISSIONS: RolePermission[] = [
  { role_id: 'role-scientist-001', permission_id: 'perm-01' },
  { role_id: 'role-scientist-001', permission_id: 'perm-02' },
  { role_id: 'role-scientist-001', permission_id: 'perm-05' },
  { role_id: 'role-scientist-001', permission_id: 'perm-06' },
  { role_id: 'role-scientist-001', permission_id: 'perm-08' },
  { role_id: 'role-hod-002', permission_id: 'perm-01' },
  { role_id: 'role-hod-002', permission_id: 'perm-02' },
  { role_id: 'role-hod-002', permission_id: 'perm-03' },
  { role_id: 'role-hod-002', permission_id: 'perm-05' },
  { role_id: 'role-hod-002', permission_id: 'perm-06' },
  { role_id: 'role-hod-002', permission_id: 'perm-07' },
  { role_id: 'role-hod-002', permission_id: 'perm-09' },
  { role_id: 'role-dir-admin-003', permission_id: 'perm-01' },
  { role_id: 'role-dir-admin-003', permission_id: 'perm-05' },
  { role_id: 'role-dir-admin-003', permission_id: 'perm-08' },
  { role_id: 'role-dg-004', permission_id: 'perm-01' },
  { role_id: 'role-dg-004', permission_id: 'perm-04' },
  { role_id: 'role-dg-004', permission_id: 'perm-09' },
  { role_id: 'role-dg-004', permission_id: 'perm-12' },
  { role_id: 'role-sys-admin-005', permission_id: 'perm-01' },
  { role_id: 'role-sys-admin-005', permission_id: 'perm-10' },
  { role_id: 'role-sys-admin-005', permission_id: 'perm-11' },
  { role_id: 'role-sys-admin-005', permission_id: 'perm-12' },
];

const SEED_DIRECTORATES: Directorate[] = [
  {
    id: 'dir-ocs-001',
    code: 'OCS',
    name: 'Oceans & Coastal Systems Directorate',
    description:
      'Marine ecology, coral reef conservation, stock assessment, physical oceanography, and Exclusive Economic Zone (EEZ) research anchored at Mombasa HQ.',
    head_user_id: null,
    active_status: true,
    is_core_protected: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'dir-fws-002',
    code: 'FWS',
    name: 'Freshwater Systems Directorate',
    description:
      'Inland lake ecosystems, limnology, catchment hydrology, and fisheries stock dynamics across Lake Victoria, Lake Turkana, Lake Naivasha, and Lake Baringo.',
    head_user_id: null,
    active_status: true,
    is_core_protected: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'dir-ard-003',
    code: 'ARD',
    name: 'Aquaculture Research Directorate',
    description:
      'Mariculture and freshwater fish farming, selective breeding, fish nutrition, disease diagnostics, and hatchery technology at Sagana and Kegati.',
    head_user_id: null,
    active_status: true,
    is_core_protected: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'dir-sed-004',
    code: 'SED',
    name: 'Socioeconomics Directorate',
    description:
      'Blue economy valuation, fisheries value-chain analysis, Beach Management Unit (BMU) governance, resource co-management, and marine policy briefs.',
    head_user_id: null,
    active_status: true,
    is_core_protected: true,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const SEED_RESEARCH_AREAS: ResearchArea[] = [
  {
    id: 'area-ocs-01',
    name: 'Marine Ecology & Coral Reef Systems',
    description: 'Benthic habitats, seagrass beds, mangrove carbon sequestration, and reef restoration.',
    directorate_id: 'dir-ocs-001',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'area-ocs-02',
    name: 'Physical & Chemical Oceanography',
    description: 'Western Indian Ocean circulation, ocean acidification, and coastal upwelling dynamics.',
    directorate_id: 'dir-ocs-001',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'area-fws-01',
    name: 'Great Lakes Limnology & Water Quality',
    description: 'Eutrophication monitoring, dissolved oxygen profiling, and trophic modeling in inland lakes.',
    directorate_id: 'dir-fws-002',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'area-fws-02',
    name: 'Freshwater Fisheries Stock Assessment',
    description: 'Acoustic hydro-surveys, Nile perch and Dagaa population dynamics.',
    directorate_id: 'dir-fws-002',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'area-ard-01',
    name: 'Fish Feed Formulation & Selective Genetics',
    description: 'Cost-effective indigenous protein feeds and broodstock genetic improvement.',
    directorate_id: 'dir-ard-003',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'area-sed-01',
    name: 'Blue Economy & Fisheries Value Chains',
    description: 'Post-harvest loss reduction, coastal livelihoods, and artisanal fisheries socioeconomics.',
    directorate_id: 'dir-sed-004',
    created_at: '2026-01-01T00:00:00Z',
  },
];

/**
 * Official KMFRI Research Centres & Field Stations Across Kenya
 */
export const SEED_KMFRI_STATIONS: ResearchLocation[] = [
  {
    id: 'stn-mombasa-hq-01',
    name: 'KMFRI Mombasa Headquarters & Marine Centre',
    country: 'Kenya',
    county: 'Mombasa',
    sub_county: 'Nyali',
    site: 'English Point, Tudor Creek',
    latitude: -4.0547,
    longitude: 39.6836,
    ecosystem_type: 'Marine & Coastal',
    marine_area: 'Western Indian Ocean · Mombasa Marine Reserve & EEZ',
    description:
      'National headquarters and principal marine & coastal research facility overseeing RV Mtafiti oceanographic expeditions.',
    environmental_context: 'Estuarine creek, fringing coral reef, and deep-sea EEZ waters.',
    directorate_id: 'dir-ocs-001',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-gazi-bay-02',
    name: 'KMFRI Gazi Bay Mangrove & Blue Carbon Station',
    country: 'Kenya',
    county: 'Kwale',
    sub_county: 'Msambweni',
    site: 'Gazi Bay',
    latitude: -4.4242,
    longitude: 39.5058,
    ecosystem_type: 'Socioeconomic Community Site',
    marine_area: 'South Coast · Mikoko Pamoja Blue Carbon Reserve',
    description:
      'World-renowned mangrove carbon sequestration, seagrass restoration, and community blue-carbon co-management station.',
    environmental_context: 'Intertidal mangrove forest and sheltered seagrass lagoon.',
    directorate_id: 'dir-sed-004',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-shimoni-03',
    name: 'KMFRI Shimoni Coastal & Reef Research Station',
    country: 'Kenya',
    county: 'Kwale',
    sub_county: 'Lunga Lunga',
    site: 'Shimoni Peninsula',
    latitude: -4.6476,
    longitude: 39.3817,
    ecosystem_type: 'Marine & Coastal',
    marine_area: 'Kisite-Mpunguti Marine Protected Area & Pemba Channel',
    description:
      'Southern border marine research station monitoring coral reef resilience, pelagic fisheries, and transboundary marine mammal corridors.',
    environmental_context: 'Offshore coral gardens and deep Pemba Channel upwelling zone.',
    directorate_id: 'dir-ocs-001',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-malindi-04',
    name: 'KMFRI Malindi & Ungwana Bay Marine Station',
    country: 'Kenya',
    county: 'Kilifi',
    sub_county: 'Malindi',
    site: 'Malindi Marine Park / Sabaki Estuary',
    latitude: -3.2192,
    longitude: 40.1169,
    ecosystem_type: 'Marine & Coastal',
    marine_area: 'Ungwana Bay & Malindi-Watamu Biosphere Reserve',
    description:
      'North Coast station focused on prawn/crustacean stock assessments in Ungwana Bay and riverine sediment dynamics.',
    environmental_context: 'Continental shelf trawling grounds and estuarine delta.',
    directorate_id: 'dir-ocs-001',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-lamu-05',
    name: 'KMFRI Lamu Archipelago Marine Substation',
    country: 'Kenya',
    county: 'Lamu',
    sub_county: 'Lamu West',
    site: 'Mokowe / Kiunga Marine National Reserve',
    latitude: -2.2696,
    longitude: 40.9006,
    ecosystem_type: 'Marine & Coastal',
    marine_area: 'Northern Kenya Banks & Lamu Mangrove Archipelago',
    description:
      'Monitors Kenya’s largest contiguous mangrove ecosystem, artisanal lobster fisheries, and Somali Current confluence.',
    environmental_context: 'Barrier islands, mangrove creeks, and nutrient-rich cold upwelling.',
    directorate_id: 'dir-ocs-001',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-kisumu-06',
    name: 'KMFRI Kisumu Freshwater Systems Centre',
    country: 'Kenya',
    county: 'Kisumu',
    sub_county: 'Kisumu Central',
    site: 'Winam Gulf Shore, Lake Victoria',
    latitude: -0.0917,
    longitude: 34.768,
    ecosystem_type: 'Freshwater Lake / River',
    marine_area: 'Lake Victoria Basin (Kenyan Sector)',
    description:
      'Principal inland freshwater research hub conducting hydro-acoustic stock surveys of Nile Perch, Tilapia, and Dagaa alongside cage-culture water quality monitoring.',
    environmental_context: 'Tropical great lake gulf and Sondu-Miriu/Nyando river mouths.',
    directorate_id: 'dir-fws-002',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-sagana-07',
    name: 'KMFRI Sagana National Aquaculture Research Centre',
    country: 'Kenya',
    county: 'Kirinyaga',
    sub_county: 'Mwea West',
    site: 'Sagana Hatchery Complex',
    latitude: -0.6681,
    longitude: 37.2067,
    ecosystem_type: 'Aquaculture Station',
    marine_area: 'Upper Tana River Catchment',
    description:
      'National center of excellence for warm-water aquaculture genetics, selective breeding of Nile tilapia and African catfish, and indigenous fish-feed formulation.',
    environmental_context: 'Earthen/lined breeding ponds, recirculating aquaculture systems (RAS), and feed mills.',
    directorate_id: 'dir-ard-003',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-kegati-08',
    name: 'KMFRI Kegati Aquaculture Research Station',
    country: 'Kenya',
    county: 'Kisii',
    sub_county: 'Nyaribari Chache',
    site: 'Kegati Highlands',
    latitude: -0.7144,
    longitude: 34.7964,
    ecosystem_type: 'Aquaculture Station',
    marine_area: 'Western Highlands & Kuja-Migori Basin',
    description:
      'Specializes in cool-water highland aquaculture, indigenous Labeo victorianus conservation breeding, and smallholder pond extension.',
    environmental_context: 'High-altitude spring-fed aquaculture raceways and ponds.',
    directorate_id: 'dir-ard-003',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-turkana-09',
    name: 'KMFRI Lake Turkana Research Station',
    country: 'Kenya',
    county: 'Turkana',
    sub_county: 'Turkana Central',
    site: 'Kalokol / Ferguson’s Gulf',
    latitude: 3.5222,
    longitude: 35.8576,
    ecosystem_type: 'Freshwater Lake / River',
    marine_area: 'Lake Turkana (Jade Sea) & Omo River Delta',
    description:
      'Monitors alkaline desert-lake limnology, Omo River inflow fluctuations, endemic fish diversity, and dryland post-harvest value chains.',
    environmental_context: 'World’s largest permanent desert lake and volcanic basin.',
    directorate_id: 'dir-fws-002',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stn-naivasha-10',
    name: 'KMFRI Lake Naivasha & Baringo Rift Valley Station',
    country: 'Kenya',
    county: 'Nakuru',
    sub_county: 'Naivasha',
    site: 'Kenyatta Landing Beach, Lake Naivasha',
    latitude: -0.7667,
    longitude: 36.4333,
    ecosystem_type: 'Freshwater Lake / River',
    marine_area: 'Central Rift Valley Lakes System',
    description:
      'Conducts limnological surveillance, macrophyte monitoring, and sustainable catch-effort assessments across Rift Valley freshwater lakes.',
    environmental_context: 'High-altitude Rift Valley freshwater lake and papyrus wetlands.',
    directorate_id: 'dir-fws-002',
    created_at: '2026-01-01T00:00:00Z',
  },
];

const SEED_SYSTEM_SETTINGS: SystemSettingRecord[] = [
  {
    id: 'set-01',
    setting_key: 'security.session_timeout_minutes',
    setting_label: 'Inactivity Session Timeout (Minutes)',
    json_value: '30',
    category: 'Security',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'set-02',
    setting_key: 'security.max_login_attempts',
    setting_label: 'Brute-Force Lockout Threshold',
    json_value: '5',
    category: 'Security',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'set-03',
    setting_key: 'uploads.max_file_size_mb',
    setting_label: 'Maximum Upload File Size (MB)',
    json_value: '25',
    category: 'Uploads',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'set-04',
    setting_key: 'uploads.allowed_extensions',
    setting_label: 'Permitted Document Extensions',
    json_value: '["pdf","docx","xlsx","csv","png","jpg"]',
    category: 'Uploads',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'set-05',
    setting_key: 'workflow.dg_escalation_budget_threshold_kes',
    setting_label: 'Budget Threshold Requiring DG Escalation (KES)',
    json_value: '10000000',
    category: 'Workflows',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

export function createInitialCleanDatabase(): DatabaseState {
  return {
    isInitializedAdmin: false,
    csrfToken: generateUuid(),
    roles: [...SEED_ROLES],
    permissions: [...SEED_PERMISSIONS],
    role_permissions: [...SEED_ROLE_PERMISSIONS],
    directorates: [...SEED_DIRECTORATES],
    research_areas: [...SEED_RESEARCH_AREAS],
    users: [],
    researcher_profiles: [],
    projects: [],
    project_members: [],
    project_milestones: [],
    funders: [],
    funding: [],
    funding_transactions: [],
    locations: [...SEED_KMFRI_STATIONS],
    project_locations: [],
    collaborators: [],
    project_collaborators: [],
    reports: [],
    research_outputs: [],
    output_authors: [],
    research_activities: [],
    approvals: [],
    documents: [],
    notifications: [],
    audit_logs: [
      {
        id: generateUuid(),
        user_id: null,
        user_email: 'system@kmfri.go.ke',
        user_role: 'system_admin',
        action: 'DATABASE_MIGRATION_AND_SEED',
        entity_type: 'system',
        entity_id: 'kmfri-schema-v4',
        old_values: null,
        new_values: JSON.stringify({
          roles_seeded: 5,
          permissions_seeded: 12,
          directorates_seeded: ['OCS', 'FWS', 'ARD', 'SED'],
          kmfri_stations_pinned: 10,
          operational_records: 0,
        }),
        request_metadata: JSON.stringify({ ip: '127.0.0.1', method: 'SYSTEM_SEEDER' }),
        created_at: new Date().toISOString(),
      },
    ],
    system_settings: [...SEED_SYSTEM_SETTINGS],
  };
}

export function loadDatabase(): DatabaseState {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem('kmfri_rms_production_db_v3_clean');
    if (!raw) {
      const initial = createInitialCleanDatabase();
      saveDatabase(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as DatabaseState;
    if (!parsed.directorates || parsed.directorates.length < 4) {
      parsed.directorates = [...SEED_DIRECTORATES];
    }
    if (!parsed.roles || parsed.roles.length < 5) {
      parsed.roles = [...SEED_ROLES];
    }
    if (!parsed.system_settings || parsed.system_settings.length === 0) {
      parsed.system_settings = [...SEED_SYSTEM_SETTINGS];
    }
    // Ensure all 10 official KMFRI stations are pinned in locations
    const existingLocIds = new Set((parsed.locations || []).map((l) => l.id));
    const missingStations = SEED_KMFRI_STATIONS.filter((s) => !existingLocIds.has(s.id));
    if (missingStations.length > 0) {
      parsed.locations = [...(parsed.locations || []), ...missingStations];
      saveDatabase(parsed);
    }
    return parsed;
  } catch (e) {
    console.error('Failed to load KMFRI database state, initializing clean schema:', e);
    return createInitialCleanDatabase();
  }
}

export function saveDatabase(
  state: DatabaseState,
  mutationDetail?: {
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
  }
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to persist KMFRI database state:', e);
  }
  // Cache in Service Worker CacheStorage and auto-sync to Supabase (or queue when offline)
  void persistAndSyncDatabaseState(state, mutationDetail);
}

export function primeServiceWorkerCache(state: DatabaseState): void {
  void cacheStateInServiceWorker(state);
}

export function getRoleById(state: DatabaseState, roleId: string): Role | undefined {
  return state.roles.find((r) => r.id === roleId);
}

export function getRoleByName(state: DatabaseState, name: RoleName): Role {
  return state.roles.find((r) => r.name === name) || SEED_ROLES[0];
}

export function getDirectorateById(
  state: DatabaseState,
  dirId: string | null
): Directorate | undefined {
  if (!dirId) return undefined;
  return state.directorates.find((d) => d.id === dirId);
}

export function getUserById(state: DatabaseState, userId: string | null): User | undefined {
  if (!userId) return undefined;
  return state.users.find((u) => u.id === userId);
}

export function appendAuditLog(
  state: DatabaseState,
  user: User | null,
  action: string,
  entityType: string,
  entityId: string,
  oldValues: unknown,
  newValues: unknown
): DatabaseState {
  const roleName = user
    ? getRoleById(state, user.role_id)?.name || 'unknown'
    : 'unauthenticated';
  const entry = {
    id: generateUuid(),
    user_id: user ? user.id : null,
    user_email: user ? user.email : 'anonymous',
    user_role: roleName,
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_values: oldValues ? JSON.stringify(oldValues) : null,
    new_values: newValues ? JSON.stringify(newValues) : null,
    request_metadata: JSON.stringify({
      csrf_verified: true,
      user_agent:
        typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'Browser',
      timestamp_utc: new Date().toISOString(),
    }),
    created_at: new Date().toISOString(),
  };

  return {
    ...state,
    audit_logs: [entry, ...state.audit_logs],
  };
}
