import { DatabaseState } from '../types/kmfri.ts';
import { syncDatabaseToSupabase } from './supabaseClient.ts';

const SW_CACHE_NAME = 'kmfri-offline-project-data-v1';
const SW_STATE_CACHE_URL = '/offline-cache/kmfri-db-state.json';
const OFFLINE_QUEUE_KEY = 'kmfri_offline_sync_queue_v1';
const LAST_SYNC_KEY = 'kmfri_last_supabase_sync_at';
const SIMULATED_OFFLINE_KEY = 'kmfri_simulated_offline_mode';

export interface OfflineMutationItem {
  id: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
}

export interface OfflineSyncSnapshot {
  isOnline: boolean;
  isSimulatedOffline: boolean;
  swRegistered: boolean;
  swCachedProjectsCount: number;
  pendingMutations: OfflineMutationItem[];
  syncStatus: 'idle' | 'syncing' | 'synced' | 'offline_queued' | 'error';
  lastSyncedAt: string | null;
}

type SyncListener = (snapshot: OfflineSyncSnapshot) => void;
const listeners = new Set<SyncListener>();

let isSyncingNow = false;
let currentSyncStatus: OfflineSyncSnapshot['syncStatus'] = 'idle';
let swIsRegistered = false;
let cachedProjectsCount = 0;

export function isSimulatedOffline(): boolean {
  try {
    return localStorage.getItem(SIMULATED_OFFLINE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSimulatedOffline(enabled: boolean): void {
  try {
    localStorage.setItem(SIMULATED_OFFLINE_KEY, String(enabled));
  } catch {
    // ignore storage error
  }
  if (!enabled) {
    // Connectivity restored from simulated offline mode -> trigger auto-sync
    void flushOfflineQueueToSupabase();
  } else {
    currentSyncStatus = getPendingMutations().length > 0 ? 'offline_queued' : 'idle';
    notifySyncListeners();
  }
}

export function isEffectivelyOnline(): boolean {
  const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  return browserOnline && !isSimulatedOffline();
}

export function getPendingMutations(): OfflineMutationItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingMutations(items: OfflineMutationItem[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage errors
  }
}

export function getLastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

function setLastSyncedAt(iso: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso);
  } catch {
    // ignore
  }
}

export function getOfflineSyncSnapshot(): OfflineSyncSnapshot {
  const pending = getPendingMutations();
  const online = isEffectivelyOnline();
  return {
    isOnline: online,
    isSimulatedOffline: isSimulatedOffline(),
    swRegistered: swIsRegistered,
    swCachedProjectsCount: cachedProjectsCount,
    pendingMutations: pending,
    syncStatus: !online && pending.length > 0 ? 'offline_queued' : currentSyncStatus,
    lastSyncedAt: getLastSyncedAt(),
  };
}

export function subscribeToOfflineSync(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(getOfflineSyncSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

function notifySyncListeners(): void {
  const snap = getOfflineSyncSnapshot();
  listeners.forEach((fn) => fn(snap));
}

export function markServiceWorkerRegistered(registered: boolean): void {
  swIsRegistered = registered;
  notifySyncListeners();
}

/**
 * Stores the full KMFRI DatabaseState inside the Service Worker CacheStorage API
 * (`kmfri-offline-project-data-v1` and `kmfri-supabase-state-cache`) so that scientists
 * can view and edit projects, milestones, and research outputs even with zero connectivity.
 */
export async function cacheStateInServiceWorker(state: DatabaseState): Promise<void> {
  cachedProjectsCount = Array.isArray(state.projects) ? state.projects.length : 0;
  if (typeof window === 'undefined' || !('caches' in window)) {
    notifySyncListeners();
    return;
  }

  try {
    const cache = await window.caches.open(SW_CACHE_NAME);
    const jsonPayload = JSON.stringify({
      state,
      cachedAt: new Date().toISOString(),
    });

    const response = new Response(jsonPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-KMFRI-Offline-Cache': 'true',
      },
    });

    await cache.put(SW_STATE_CACHE_URL, response.clone());

    // Also update the Workbox runtime cache entry for /api/db/state so raw fetches work offline
    const apiCache = await window.caches.open('kmfri-supabase-state-cache');
    await apiCache.put(
      '/api/db/state',
      new Response(JSON.stringify({ state, source: 'service-worker-cache' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch (err) {
    console.warn('Service Worker CacheStorage write warning:', err);
  } finally {
    notifySyncListeners();
  }
}

/**
 * Reads the cached KMFRI DatabaseState from the Service Worker CacheStorage API
 * when offline or when hydrating.
 */
export async function readStateFromServiceWorkerCache(): Promise<DatabaseState | null> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return null;
  }
  try {
    const cache = await window.caches.open(SW_CACHE_NAME);
    const matched = await cache.match(SW_STATE_CACHE_URL);
    if (!matched) return null;
    const json = await matched.json();
    if (json && json.state && Array.isArray(json.state.projects)) {
      cachedProjectsCount = json.state.projects.length;
      return json.state as DatabaseState;
    }
  } catch {
    // ignore cache read error
  }
  return null;
}

/**
 * Enqueues a mutation performed while offline (or when network fails) so it will
 * auto-sync to Supabase as soon as connectivity returns.
 */
export function enqueueOfflineMutation(
  action: string,
  entityType: string,
  entityId: string,
  summary: string
): void {
  const queue = getPendingMutations();
  const item: OfflineMutationItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    action,
    entityType,
    entityId,
    summary,
    status: 'pending',
  };
  const updated = [item, ...queue].slice(0, 100);
  savePendingMutations(updated);
  currentSyncStatus = 'offline_queued';
  notifySyncListeners();
}

/**
 * Persists state to Service Worker CacheStorage and attempts to synchronize with
 * Supabase if online. If offline or unreachable, queues the change for auto-sync.
 */
export async function persistAndSyncDatabaseState(
  state: DatabaseState,
  mutationDetail?: {
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
  }
): Promise<void> {
  // 1. Always write immediately to Service Worker CacheStorage for offline resilience
  await cacheStateInServiceWorker(state);

  // 2. Check latest audit log if no explicit mutationDetail was passed
  const latestAudit = state.audit_logs?.[0];
  const resolvedAction = mutationDetail?.action || latestAudit?.action || 'PROJECT_DATA_UPDATED';
  const resolvedEntity = mutationDetail?.entityType || latestAudit?.entity_type || 'projects';
  const resolvedId = mutationDetail?.entityId || latestAudit?.entity_id || 'state';
  const resolvedSummary =
    mutationDetail?.summary ||
    `${resolvedAction.replace(/_/g, ' ')} (${resolvedEntity})`;

  if (!isEffectivelyOnline()) {
    enqueueOfflineMutation(resolvedAction, resolvedEntity, resolvedId, resolvedSummary);
    return;
  }

  // 3. Online: sync directly to Supabase and flush any queued offline mutations
  currentSyncStatus = 'syncing';
  notifySyncListeners();

  const ok = await syncDatabaseToSupabase(state);
  if (ok) {
    savePendingMutations([]);
    setLastSyncedAt(new Date().toISOString());
    currentSyncStatus = 'synced';
    notifySyncListeners();
  } else {
    enqueueOfflineMutation(resolvedAction, resolvedEntity, resolvedId, resolvedSummary);
  }
}

/**
 * Flushes all queued offline edits to Supabase once connectivity is restored.
 */
export async function flushOfflineQueueToSupabase(latestState?: DatabaseState): Promise<boolean> {
  if (isSyncingNow || !isEffectivelyOnline()) {
    notifySyncListeners();
    return false;
  }

  const queue = getPendingMutations();
  let stateToSync: DatabaseState | null = latestState || null;

  if (!stateToSync) {
    stateToSync = await readStateFromServiceWorkerCache();
  }
  if (!stateToSync) {
    try {
      const raw = localStorage.getItem('kmfri_rms_production_db_v4_stations');
      if (raw) stateToSync = JSON.parse(raw) as DatabaseState;
    } catch {
      // ignore
    }
  }

  if (!stateToSync) return false;

  isSyncingNow = true;
  currentSyncStatus = 'syncing';
  if (queue.length > 0) {
    savePendingMutations(queue.map((item) => ({ ...item, status: 'syncing' })));
  }
  notifySyncListeners();

  try {
    const ok = await syncDatabaseToSupabase(stateToSync);
    if (ok) {
      savePendingMutations([]);
      setLastSyncedAt(new Date().toISOString());
      currentSyncStatus = 'synced';
      isSyncingNow = false;
      notifySyncListeners();
      return true;
    } else {
      if (queue.length > 0) {
        savePendingMutations(queue.map((item) => ({ ...item, status: 'pending' })));
      }
      currentSyncStatus = queue.length > 0 ? 'offline_queued' : 'error';
      isSyncingNow = false;
      notifySyncListeners();
      return false;
    }
  } catch {
    if (queue.length > 0) {
      savePendingMutations(queue.map((item) => ({ ...item, status: 'pending' })));
    }
    currentSyncStatus = queue.length > 0 ? 'offline_queued' : 'error';
    isSyncingNow = false;
    notifySyncListeners();
    return false;
  }
}

// Attach global browser connectivity listeners for automatic background sync on reconnect
// These are only attached once when the module loads
let connectivityListenersAttached = false;

export function attachConnectivityListeners(): void {
  if (typeof window === 'undefined' || connectivityListenersAttached) {
    return;
  }
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  connectivityListenersAttached = true;
}

export function detachConnectivityListeners(): void {
  if (typeof window === 'undefined' || !connectivityListenersAttached) {
    return;
  }
  
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  connectivityListenersAttached = false;
}

function handleOnline(): void {
  if (!isSimulatedOffline()) {
    void flushOfflineQueueToSupabase();
  } else {
    notifySyncListeners();
  }
}

function handleOffline(): void {
  currentSyncStatus = getPendingMutations().length > 0 ? 'offline_queued' : 'idle';
  notifySyncListeners();
}

// Auto-attach on module load for convenience
if (typeof window !== 'undefined') {
  attachConnectivityListeners();
}
