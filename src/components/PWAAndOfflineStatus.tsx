import React, { useEffect, useState } from 'react';
import {
  OfflineSyncSnapshot,
  subscribeToOfflineSync,
  setSimulatedOffline,
  flushOfflineQueueToSupabase,
} from '../services/offlineSyncService.ts';
import { DatabaseState } from '../types/kmfri.ts';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  CloudOff,
  Download,
  Database,
  X,
} from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#173B75] hover:bg-[#3155A4] px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition cursor-pointer shrink-0"
        title="Install KMFRI Offline-Ready App"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Install KMFRI App on iPhone / iPad
              </h3>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in your Safari toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong> to enable offline access.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-[#173B75] py-2 text-xs font-semibold text-white hover:bg-[#3155A4] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

interface OfflineSyncIndicatorProps {
  db: DatabaseState;
}

export const OfflineSyncIndicator: React.FC<OfflineSyncIndicatorProps> = ({ db }) => {
  const [snap, setSnap] = useState<OfflineSyncSnapshot | null>(null);
  const [showQueueModal, setShowQueueModal] = useState(false);

  useEffect(() => {
    return subscribeToOfflineSync((next) => {
      setSnap(next);
    });
  }, []);

  if (!snap) return null;

  const pendingCount = snap.pendingMutations.length;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Connectivity & Auto-Sync Status Button */}
        <button
          type="button"
          onClick={() => setShowQueueModal(true)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
            !snap.isOnline
              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
              : snap.syncStatus === 'syncing'
              ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
              : pendingCount > 0
              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
              : 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-300'
          }`}
          title="View Offline Cache & Supabase Auto-Sync Queue"
        >
          {!snap.isOnline ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="hidden md:inline">Offline Mode</span>
              {pendingCount > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-amber-600 text-white font-mono text-[10px] font-bold">
                  {pendingCount} Queued
                </span>
              )}
            </>
          ) : snap.syncStatus === 'syncing' ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600 shrink-0" />
              <span className="hidden md:inline">Syncing to Supabase...</span>
            </>
          ) : pendingCount > 0 ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="hidden md:inline">{pendingCount} Pending Sync</span>
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="hidden xl:inline">Online · Auto-Sync Active</span>
            </>
          )}
        </button>
      </div>

      {/* Persistent Bottom Floating Banner when Offline or Syncing Queued Edits */}
      {(!snap.isOnline || snap.syncStatus === 'syncing' || pendingCount > 0) && (
        <div className="fixed bottom-16 lg:bottom-4 left-4 right-4 sm:right-auto z-40 max-w-lg rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/95 dark:bg-slate-900/95 backdrop-blur-md p-3.5 shadow-xl text-xs flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            {!snap.isOnline ? (
              <CloudOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <RefreshCw className="w-4 h-4 text-teal-600 dark:text-teal-400 animate-spin shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="font-bold text-slate-900 dark:text-white">
                {!snap.isOnline
                  ? 'Offline Field Mode Active — Service Worker Cache Serving Data'
                  : 'Reconnected — Auto-Syncing Queued Edits to Supabase'}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug mt-0.5">
                {!snap.isOnline
                  ? `You can view and edit all ${db.projects.length} project(s) and milestones offline. ${
                      pendingCount > 0
                        ? `${pendingCount} offline edit(s) queued for automatic Supabase sync.`
                        : 'Changes will auto-sync when connectivity returns.'
                    }`
                  : `Synchronizing ${pendingCount} queued offline edit(s) with Supabase PostgreSQL...`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {snap.isSimulatedOffline && (
              <button
                type="button"
                onClick={() => setSimulatedOffline(false)}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] cursor-pointer whitespace-nowrap"
              >
                Reconnect &amp; Auto-Sync
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowQueueModal(true)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-[11px] cursor-pointer"
            >
              Details
            </button>
          </div>
        </div>
      )}

      {/* Offline Cache & Supabase Auto-Sync Modal */}
      {showQueueModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-teal-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                  Service Worker Offline Cache &amp; Supabase Auto-Sync
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowQueueModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500 block">Connectivity Status</span>
                <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 mt-1">
                  {snap.isOnline ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Online (Auto-Sync Ready)</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                      <span>Offline (Caching Edits)</span>
                    </>
                  )}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500 block">Cached Offline Data</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white block mt-1">
                  {db.projects.length} Projects · {db.project_milestones.length} Milestones
                </span>
              </div>
            </div>

            {/* Field Offline Mode Toggle for Testing Offline Project Viewing & Editing */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">
                  Offline Field Mode (RV Mtafiti / Remote Station Mode)
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Work offline using the Service Worker cache. Edits queue locally and auto-sync to
                  Supabase as soon as connectivity is restored.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSimulatedOffline(!snap.isSimulatedOffline)}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer shrink-0 transition-colors ${
                  snap.isSimulatedOffline
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
              >
                {snap.isSimulatedOffline ? 'Go Online & Auto-Sync' : 'Work Offline'}
              </button>
            </div>

            {/* Queued Offline Mutations List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Queued Offline Edits ({pendingCount})
                </span>
                {snap.lastSyncedAt && (
                  <span className="text-[11px] font-mono text-slate-500">
                    Last Synced: {snap.lastSyncedAt.slice(11, 19)} UTC
                  </span>
                )}
              </div>

              {pendingCount === 0 ? (
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-center text-slate-500">
                  All project data and milestones are synchronized with Supabase.
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                  {snap.pendingMutations.map((m) => (
                    <div
                      key={m.id}
                      className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/30 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {m.summary}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {m.action} · {m.timestamp.slice(11, 19)} UTC
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-mono text-[10px] font-bold shrink-0">
                        {m.status === 'syncing' ? 'Syncing...' : 'Queued'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={!snap.isOnline || snap.syncStatus === 'syncing'}
                onClick={() => void flushOfflineQueueToSupabase(db)}
                className="px-3.5 py-2 rounded-lg bg-[#173B75] hover:bg-[#3155A4] disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${snap.syncStatus === 'syncing' ? 'animate-spin' : ''}`}
                />
                <span>Sync to Supabase Now</span>
              </button>
              <button
                type="button"
                onClick={() => setShowQueueModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
