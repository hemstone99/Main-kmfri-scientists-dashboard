/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  DatabaseState,
  User,
  RoleName,
} from './types/kmfri.ts';
import {
  loadDatabase,
  saveDatabase,
  primeServiceWorkerCache,
  getRoleById,
  getDirectorateById,
  appendAuditLog,
} from './services/database.ts';
import {
  fetchDatabaseFromSupabase,
  syncDatabaseToSupabase,
} from './services/supabaseClient.ts';
import {
  readStateFromServiceWorkerCache,
  getPendingMutations,
} from './services/offlineSyncService.ts';
import {
  PWAInstallButton,
  OfflineSyncIndicator,
} from './components/PWAAndOfflineStatus.tsx';
import {
  NavSectionId,
  canAccessNavSection,
  canViewResearcherProfile,
  filterDocumentsForUser,
  filterOutputsForUser,
  filterProjectsForUser,
} from './services/rbacPolicy.ts';
import { AuthGateway } from './components/AuthGateway.tsx';
import { KmfriLogo } from './components/KmfriLogo.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { ProjectsModule } from './components/ProjectsModule.tsx';
import { ScientistsAndProfilesModule } from './components/ScientistsAndProfilesModule.tsx';
import { OperationsAndFundingModules } from './components/OperationsAndFundingModules.tsx';
import { OutputsAndReportsModules } from './components/OutputsAndReportsModules.tsx';
import { SharePointCollaborationHub } from './components/SharePointCollaborationHub.tsx';
import { GisAndCollaboratorsModules } from './components/GisAndCollaboratorsModules.tsx';
import { GovernanceAndExportsModules } from './components/GovernanceAndExportsModules.tsx';
import { AdminAuditAndPhpModules } from './components/AdminAuditAndPhpModules.tsx';
import { CalendarTasksView, TrainingDevelopmentView } from './components/ScientistWorkspaceViews.tsx';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  FolderKanban,
  Activity,
  Landmark,
  FileText,
  BookOpen,
  MapPin,
  Handshake,
  CheckSquare,
  FolderLock,
  Bell,
  BarChart3,
  Settings,
  ShieldAlert,
  Code2,
  LogOut,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Share2,
  Menu,
  X,
  CalendarDays,
  GraduationCap,
  Database,
  ChevronDown,
} from 'lucide-react';

interface SidebarNavItem {
  id: NavSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SIDEBAR_ITEMS: SidebarNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scientists', label: 'Scientists', icon: Users },
  { id: 'profiles', label: 'Researcher Profiles', icon: UserCheck },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'activities', label: 'Research Activities', icon: Activity },
  { id: 'calendar', label: 'Calendar & Tasks', icon: CalendarDays },
  { id: 'training', label: 'Training & Development', icon: GraduationCap },
  { id: 'research_data', label: 'Research Data & Documents', icon: Database },
  { id: 'funding', label: 'Funding & Grants', icon: Landmark },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'outputs', label: 'Publications & Outputs', icon: BookOpen },
  { id: 'sharepoint_hub', label: 'SharePoint & Word Hub', icon: Share2 },
  { id: 'locations', label: 'Locations & Maps', icon: MapPin },
  { id: 'collaborators', label: 'Collaborators', icon: Handshake },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare },
  { id: 'documents', label: 'Documents', icon: FolderLock },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'analytics', label: 'Analytics & Exports', icon: BarChart3 },
  { id: 'administration', label: 'Administration', icon: Settings },
  { id: 'audit_logs', label: 'Audit Logs', icon: ShieldAlert },
];

interface SidebarGroupDefinition {
  label: string;
  items: { id: NavSectionId; label: string }[];
}

const SCIENTIST_NAV_GROUPS: SidebarGroupDefinition[] = [
  { label: 'My Workspace', items: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'profiles', label: 'My Profile' },
  ] },
  { label: 'Research Lifecycle', items: [
    { id: 'projects', label: 'Research & Projects' },
    { id: 'activities', label: 'Fieldwork & Sampling' },
    { id: 'calendar', label: 'Calendar & Tasks' },
    { id: 'training', label: 'Training & Professional Development' },
  ] },
  { label: 'Knowledge & Impact', items: [
    { id: 'research_data', label: 'Research Data & Documents' },
    { id: 'reports', label: 'Reports & Deliverables' },
    { id: 'outputs', label: 'Publications & Research Outputs' },
    { id: 'locations', label: 'Locations & Maps' },
    { id: 'sharepoint_hub', label: 'Collaboration & Knowledge Hub' },
    { id: 'notifications', label: 'Notifications & Approvals' },
  ] },
];

const INSTITUTIONAL_NAV_GROUPS: SidebarGroupDefinition[] = [
  { label: 'Workspace', items: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'profiles', label: 'Researcher Profiles' },
    { id: 'scientists', label: 'Scientists & Teams' },
  ] },
  { label: 'Research Lifecycle', items: [
    { id: 'projects', label: 'Research & Projects' },
    { id: 'activities', label: 'Fieldwork & Sampling' },
    { id: 'calendar', label: 'Calendar & Tasks' },
    { id: 'training', label: 'Training & Professional Development' },
    { id: 'research_data', label: 'Research Data & Documents' },
    { id: 'reports', label: 'Reports & Deliverables' },
    { id: 'outputs', label: 'Publications & Research Outputs' },
  ] },
  { label: 'Collaboration & Places', items: [
    { id: 'sharepoint_hub', label: 'Collaboration & Knowledge Hub' },
    { id: 'locations', label: 'Locations & Maps' },
    { id: 'collaborators', label: 'Collaborators' },
  ] },
  { label: 'Governance & Insights', items: [
    { id: 'funding', label: 'Funding & Grants' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'documents', label: 'Secure Document Repository' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'analytics', label: 'Analytics & Exports' },
    { id: 'audit_logs', label: 'Audit Logs' },
  ] },
  { label: 'Administration', items: [
    { id: 'administration', label: 'Administration' },
  ] },
];

export default function App() {
  const [db, setDb] = useState<DatabaseState>(() => loadDatabase());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeSection, setActiveSection] = useState<NavSectionId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedNavGroups, setCollapsedNavGroups] = useState<Record<string, boolean>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kmfri_theme_dark') === 'true';
    } catch {
      return false;
    }
  });
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [triggerNewProjectModal, setTriggerNewProjectModal] = useState(false);
  const [pendingChatShare, setPendingChatShare] = useState<{
    type: 'document' | 'publication';
    id: string;
    title: string;
    subtitle: string;
  } | null>(null);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('kmfri_theme_dark', String(darkMode));
    } catch {
      // ignore storage errors
    }
  }, [darkMode]);

  // Hydrate database state from Supabase PostgreSQL (or Service Worker cache when offline)
  useEffect(() => {
    let active = true;
    const localInitial = loadDatabase();
    primeServiceWorkerCache(localInitial);

    // Do not overwrite pending offline edits before they auto-sync to Supabase
    if (getPendingMutations().length > 0) {
      return () => {
        active = false;
      };
    }

    fetchDatabaseFromSupabase().then(async (remoteState) => {
      if (!active) return;
      if (remoteState && Array.isArray(remoteState.directorates)) {
        setDb(remoteState);
        primeServiceWorkerCache(remoteState);
        try {
          localStorage.setItem('kmfri_rms_production_db_v4_stations', JSON.stringify(remoteState));
        } catch {
          // ignore localStorage write errors
        }
      } else {
        const swCachedState = await readStateFromServiceWorkerCache();
        if (active && swCachedState && Array.isArray(swCachedState.directorates)) {
          setDb(swCachedState);
        } else {
          // Seed initial state to Supabase if empty
          void syncDatabaseToSupabase(localInitial);
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleUpdateDb = (nextState: DatabaseState) => {
    setDb(nextState);
    saveDatabase(nextState);
    if (currentUser) {
      const refreshed = nextState.users.find((u) => u.id === currentUser.id);
      if (!refreshed || refreshed.account_status !== 'Active') {
        setCurrentUser(null);
      } else {
        setCurrentUser(refreshed);
      }
    }
  };

  // Zero-Trust Session Inactivity Guard (Auto-locks session after 30 minutes of inactivity)
  useEffect(() => {
    if (!currentUser) return;
    let inactivityTimer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        setCurrentUser(null);
      }, 30 * 60 * 1000);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(inactivityTimer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [currentUser]);

  if (!currentUser) {
    return (
      <AuthGateway
        db={db}
        onUpdateDb={handleUpdateDb}
        onAuthenticated={(user) => {
          setCurrentUser(user);
          setActiveSection('dashboard');
        }}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
      />
    );
  }

  // Route-level RBAC check for the active application section
  const isAuthorizedSection = canAccessNavSection(db, currentUser, activeSection);
  const currentRole = getRoleById(db, currentUser.role_id);
  const currentDirectorate = getDirectorateById(db, currentUser.directorate_id);
  const searchableProjects = filterProjectsForUser(db, currentUser);
  const searchableOutputs = filterOutputsForUser(db, currentUser);
  const searchableDocuments = filterDocumentsForUser(db, currentUser);
  const searchableUsers = db.users.filter((user) =>
    canViewResearcherProfile(db, currentUser, user)
  );
  const unreadNotificationsCount = db.notifications.filter(
    (n) => n.user_id === currentUser.id && !n.read_at
  ).length;

  const roleName: RoleName = currentRole?.name || 'scientist';
  const navGroups = roleName === 'scientist' ? SCIENTIST_NAV_GROUPS : INSTITUTIONAL_NAV_GROUPS;
  const visibleNavGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessNavSection(db, currentUser, item.id)),
    }))
    .filter((group) => group.items.length > 0);
  const activeNavLabel = visibleNavGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === activeSection)?.label || 'Workspace';

  const handleSignOut = () => {
    const next = appendAuditLog(
      db,
      currentUser,
      'AUTH_LOGOUT',
      'users',
      currentUser.id,
      null,
      { signed_out_at: new Date().toISOString() }
    );
    handleUpdateDb(next);
    setCurrentUser(null);
  };

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen w-full flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200 overflow-x-hidden">
        {/* Mobile Slide-Over Sidebar Backdrop */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs lg:hidden"
            aria-hidden="true"
          />
        )}

        {/* Permission-Aware Collapsible Sidebar (Slide-over Drawer on Mobile/Tablet, Fixed Flex on Desktop) */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 lg:static lg:z-auto ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          } ${
            sidebarCollapsed ? 'lg:w-18 w-72' : 'w-72 lg:w-64'
          } shrink-0 bg-[#0A2540] dark:bg-[#061527] text-slate-200 border-r border-slate-800 flex flex-col justify-between transition-all duration-200 shadow-2xl lg:shadow-none`}
        >
          <div>
            {/* Sidebar Brand Header with Official KMFRI Logo */}
            <div className="h-16 px-3.5 flex items-center justify-between border-b border-white/10">
              <button
                type="button"
                onClick={() => {
                  setActiveSection('dashboard');
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-2.5 overflow-hidden text-left cursor-pointer focus:outline-none"
                title="KMFRI Dashboard"
              >
                {sidebarCollapsed ? (
                  <>
                    <div className="hidden lg:block">
                      <KmfriLogo compact={true} iconOnly={true} />
                    </div>
                    <div className="lg:hidden">
                      <KmfriLogo compact={true} showSubtitle={true} variant="dark" />
                    </div>
                  </>
                ) : (
                  <KmfriLogo compact={true} showSubtitle={true} variant="dark" />
                )}
              </button>

              {/* Desktop Collapse Toggle */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                aria-label="Toggle sidebar"
                className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>

              {/* Mobile Close Drawer Button */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="p-2.5 space-y-1 max-h-[calc(100vh-140px)] overflow-y-auto">
              {visibleNavGroups.map((group) => {
                const isGroupCollapsed = collapsedNavGroups[group.label] || false;
                return (
                  <div key={group.label} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setCollapsedNavGroups((previous) => ({
                        ...previous,
                        [group.label]: !previous[group.label],
                      }))}
                      aria-expanded={!isGroupCollapsed}
                      title={group.label}
                      className={`w-full flex items-center justify-between px-3 pt-3 pb-1 text-[9px] font-mono font-bold uppercase text-slate-400 hover:text-white ${sidebarCollapsed ? 'lg:hidden' : ''}`}
                    >
                      <span>{group.label}</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${isGroupCollapsed ? '-rotate-90' : ''}`} />
                    </button>
                    {(!isGroupCollapsed || sidebarCollapsed) && group.items.map((entry) => {
                      const item = SIDEBAR_ITEMS.find((navItem) => navItem.id === entry.id);
                      if (!item) return null;
                      const Icon = item.icon;
                      const isActive = activeSection === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActiveSection(item.id);
                            setMobileMenuOpen(false);
                          }}
                          title={entry.label}
                          className={`w-full flex items-center ${
                            sidebarCollapsed
                              ? 'justify-between px-3 lg:justify-center lg:px-2'
                              : 'justify-between px-3'
                          } py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-teal-600 text-white font-semibold shadow-xs'
                              : 'text-slate-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className={sidebarCollapsed ? 'truncate lg:hidden' : 'truncate'}>{entry.label}</span>
                          </div>
                          {item.id === 'notifications' && unreadNotificationsCount > 0 && (
                            <span className={`px-1.5 py-0.5 rounded-md bg-teal-500/20 font-mono text-[10px] font-bold text-teal-200 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                              {unreadNotificationsCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
          </div>

          <div className="p-3 border-t border-white/10">
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-red-600/20 text-xs font-semibold text-slate-200 hover:text-red-200 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Sign Out Securely</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 w-full">
          {/* Top Navigation Bar */}
          <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-6 py-2.5 sm:py-0 sm:h-16 flex flex-wrap items-center justify-between gap-2 sm:gap-4 transition-colors duration-200">
            {/* Zone 1: Mobile Menu Trigger + Brand Emblem & Breadcrumb Trail */}
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer shrink-0"
              >
                <Menu className="w-4 h-4" />
              </button>

              <KmfriLogo compact={true} iconOnly={true} className="scale-90 shrink-0 hidden xs:flex" />
              <span className="font-bold text-[#2E4B9E] dark:text-sky-400 font-display tracking-wide hidden sm:inline">
                KMFRI
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 hidden md:inline">
                {currentDirectorate?.code || 'HQ'}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700 hidden md:inline">/</span>
              <span className="font-semibold text-teal-700 dark:text-teal-400 truncate max-w-[140px] sm:max-w-none">
                {activeNavLabel}
              </span>
            </div>

            {/* Zone 3 (Right-aligned on mobile top row): Offline Sync, Install PWA, Notifications, Light/Dark Mode Toggle & Profile */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 order-2 sm:order-3">
              <OfflineSyncIndicator db={db} />
              <PWAInstallButton />

              <button
                type="button"
                onClick={() => setActiveSection('notifications')}
                className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer transition-colors"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-teal-600 text-white text-[10px] font-mono font-bold rounded">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setDarkMode((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {darkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden md:inline">Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-600" />
                    <span className="hidden md:inline">Dark</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('profiles')}
                className="text-left px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 text-xs cursor-pointer whitespace-nowrap transition-colors max-w-[145px] sm:max-w-[210px] truncate"
              >
                <span className="font-bold text-slate-900 dark:text-white block leading-tight truncate">
                  {currentUser.full_name}
                </span>
                <span className="text-[10px] sm:text-[11px] font-mono text-teal-700 dark:text-teal-400 block truncate">
                  {currentUser.staff_number} · {currentRole?.name}
                </span>
              </button>
            </div>

            {/* Zone 2: Functional Global Search Input + Search Button + Live Results Palette */}
            <div className="w-full sm:w-auto order-3 sm:order-2 flex-1 sm:flex-initial max-w-full sm:max-w-md">
              <div className="relative w-full">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = globalSearch.trim().toLowerCase();
                    if (!q) return;
                    setSearchDropdownOpen(true);
                    if (
                      searchableOutputs.some(
                        (o) =>
                          o.title.toLowerCase().includes(q) ||
                          o.doi.toLowerCase().includes(q)
                      )
                    ) {
                      setActiveSection('outputs');
                    } else if (
                      searchableDocuments.some((d) => d.title.toLowerCase().includes(q))
                    ) {
                      setActiveSection('sharepoint_hub');
                    } else if (
                      searchableUsers.some(
                        (u) =>
                          u.full_name.toLowerCase().includes(q) ||
                          u.staff_number.toLowerCase().includes(q)
                      )
                    ) {
                      setActiveSection(currentRole?.name === 'scientist' ? 'profiles' : 'scientists');
                    } else {
                      setActiveSection('projects');
                    }
                  }}
                  className="flex items-center gap-1.5 w-full"
                >
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search projects, publications, docs, staff..."
                      value={globalSearch}
                      onFocus={() => setSearchDropdownOpen(true)}
                      onChange={(e) => {
                        setGlobalSearch(e.target.value);
                        setSearchDropdownOpen(true);
                      }}
                      className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 w-full sm:w-56 md:w-64 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <button
                    type="submit"
                    onClick={() => setSearchDropdownOpen(true)}
                    className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#173B75] hover:bg-[#3155A4] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                  >
                    <Search className="w-3 h-3" />
                    <span>Search</span>
                  </button>
                </form>

                {/* Live Universal Search Results Dropdown */}
                {searchDropdownOpen && globalSearch.trim().length > 0 && (
                  <div className="absolute left-0 right-0 sm:right-auto top-10 z-50 w-full sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-3 space-y-2.5 text-xs max-h-96 overflow-y-auto">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800 gap-2">
                      <span className="font-mono text-[10px] uppercase font-bold text-[#159A9C] truncate">
                        Universal Search Results for &ldquo;{globalSearch.trim()}&rdquo;
                      </span>
                      <button
                        type="button"
                        onClick={() => setSearchDropdownOpen(false)}
                        className="text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
                      >
                        Close
                      </button>
                    </div>

                    {(() => {
                      const q = globalSearch.trim().toLowerCase();
                      const matchedProjects = searchableProjects
                        .filter(
                          (p) =>
                            p.title.toLowerCase().includes(q) ||
                            p.project_code.toLowerCase().includes(q)
                        )
                        .slice(0, 3);
                      const matchedOutputs = searchableOutputs
                        .filter(
                          (o) =>
                            o.title.toLowerCase().includes(q) ||
                            o.doi.toLowerCase().includes(q)
                        )
                        .slice(0, 3);
                      const matchedDocs = searchableDocuments
                        .filter(
                          (d) =>
                            d.title.toLowerCase().includes(q) ||
                            d.file_name.toLowerCase().includes(q)
                        )
                        .slice(0, 3);
                      const matchedUsers = searchableUsers
                        .filter(
                          (u) =>
                            u.full_name.toLowerCase().includes(q) ||
                            u.staff_number.toLowerCase().includes(q) ||
                            u.email.toLowerCase().includes(q)
                        )
                        .slice(0, 3);

                      const totalMatches =
                        matchedProjects.length +
                        matchedOutputs.length +
                        matchedDocs.length +
                        matchedUsers.length;

                      if (totalMatches === 0) {
                        return (
                          <div className="py-4 text-center text-slate-500">
                            No matching projects, publications, SharePoint documents, or scientists.
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-2">
                          {matchedProjects.length > 0 && (
                            <div>
                              <div className="text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">
                                Projects &amp; Gantt
                              </div>
                              {matchedProjects.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveSection('projects');
                                    setSearchDropdownOpen(false);
                                  }}
                                  className="w-full text-left p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                                >
                                  <span className="font-semibold truncate">{p.title}</span>
                                  <span className="font-mono text-[10px] text-teal-600 shrink-0">
                                    {p.project_code}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {matchedOutputs.length > 0 && (
                            <div>
                              <div className="text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">
                                Publications &amp; Manuscripts
                              </div>
                              {matchedOutputs.map((o) => (
                                <button
                                  key={o.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveSection('outputs');
                                    setSearchDropdownOpen(false);
                                  }}
                                  className="w-full text-left p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                                >
                                  <span className="font-semibold truncate">{o.title}</span>
                                  <span className="font-mono text-[10px] text-teal-600 shrink-0">
                                    {o.output_type}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {matchedDocs.length > 0 && (
                            <div>
                              <div className="text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">
                                SharePoint &amp; Word Hub
                              </div>
                              {matchedDocs.map((d) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveSection('sharepoint_hub');
                                    setSearchDropdownOpen(false);
                                  }}
                                  className="w-full text-left p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                                >
                                  <span className="font-semibold truncate">{d.title}</span>
                                  <span className="font-mono text-[10px] text-teal-600 shrink-0">
                                    v{d.version_label || `${d.version}.0`}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {matchedUsers.length > 0 && (
                            <div>
                              <div className="text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">
                                Scientists &amp; Staff
                              </div>
                              {matchedUsers.map((u) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveSection(currentRole?.name === 'scientist' ? 'profiles' : 'scientists');
                                    setSearchDropdownOpen(false);
                                  }}
                                  className="w-full text-left p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                                >
                                  <span className="font-semibold truncate">{u.full_name}</span>
                                  <span className="font-mono text-[10px] text-teal-600 shrink-0">
                                    {u.staff_number}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Main Viewport Canvas */}
          <main className="flex-1 p-3 sm:p-5 lg:p-6 pb-20 lg:pb-6 max-w-[1440px] w-full mx-auto overflow-x-hidden">
            {!isAuthorizedSection ? (
              <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/40 rounded-xl p-6 sm:p-8 text-center">
                <h2 className="text-base font-bold text-red-700 dark:text-red-400 mb-1">
                  403 Forbidden — Role Permission Check
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Your current role ({currentRole?.label}) is not authorized to access this administrative or
                  audit module.
                </p>
              </div>
            ) : (
              <>
                {activeSection === 'dashboard' && (
                  <DashboardView
                    db={db}
                    currentUser={currentUser}
                    darkMode={darkMode}
                    onNavigate={(sec) => setActiveSection(sec)}
                    onQuickCreateProject={() => {
                      setTriggerNewProjectModal(true);
                      setActiveSection('projects');
                    }}
                    onQuickCreateLocation={() => setActiveSection('locations')}
                  />
                )}

                {(activeSection === 'scientists' || activeSection === 'profiles') && (
                  <ScientistsAndProfilesModule
                    db={db}
                    currentUser={currentUser}
                    mode={activeSection}
                    onUpdateDb={handleUpdateDb}
                  />
                )}

                {activeSection === 'projects' && (
                  <ProjectsModule
                    db={db}
                    currentUser={currentUser}
                    onUpdateDb={handleUpdateDb}
                    openCreateModalInitially={triggerNewProjectModal}
                    onClearInitialModal={() => setTriggerNewProjectModal(false)}
                  />
                )}

                {(activeSection === 'calendar' || activeSection === 'training') && (
                  activeSection === 'calendar' ? (
                    <CalendarTasksView
                      db={db}
                      currentUser={currentUser}
                      onUpdateDb={handleUpdateDb}
                      onNavigate={setActiveSection}
                    />
                  ) : (
                    <TrainingDevelopmentView
                      db={db}
                      currentUser={currentUser}
                      onUpdateDb={handleUpdateDb}
                      onNavigate={setActiveSection}
                    />
                  )
                )}

                {(activeSection === 'activities' || activeSection === 'funding') && (
                  <OperationsAndFundingModules
                    db={db}
                    currentUser={currentUser}
                    mode={activeSection}
                    onUpdateDb={handleUpdateDb}
                  />
                )}

                {(activeSection === 'outputs' || activeSection === 'reports') && (
                  <OutputsAndReportsModules
                    db={db}
                    currentUser={currentUser}
                    mode={activeSection}
                    onUpdateDb={handleUpdateDb}
                    onShareToChat={(attachment) => {
                      setPendingChatShare(attachment);
                    }}
                  />
                )}

                {(activeSection === 'sharepoint_hub' || activeSection === 'research_data') && (
                  <SharePointCollaborationHub
                    db={db}
                    currentUser={currentUser}
                    onUpdateDb={handleUpdateDb}
                    initialSharedAttachment={pendingChatShare}
                    onClearSharedAttachment={() => setPendingChatShare(null)}
                    initialTab={activeSection === 'research_data' ? 'drive' : 'word_studio'}
                  />
                )}

                {(activeSection === 'locations' || activeSection === 'collaborators') && (
                  <GisAndCollaboratorsModules
                    db={db}
                    currentUser={currentUser}
                    mode={activeSection}
                    onUpdateDb={handleUpdateDb}
                  />
                )}

                {(activeSection === 'approvals' ||
                  activeSection === 'documents' ||
                  activeSection === 'notifications' ||
                  activeSection === 'analytics') && (
                  <GovernanceAndExportsModules
                    db={db}
                    currentUser={currentUser}
                    mode={activeSection}
                    onUpdateDb={handleUpdateDb}
                  />
                )}

                {(activeSection === 'administration' ||
                  activeSection === 'audit_logs') && (
                  <AdminAuditAndPhpModules
                    db={db}
                    currentUser={currentUser}
                    mode={activeSection}
                    onUpdateDb={handleUpdateDb}
                  />
                )}
              </>
            )}
          </main>

          {/* Mobile Bottom Quick-Access Navigation Bar (Visible on Mobile/Tablet < 1024px) */}
          <nav
            aria-label="Mobile quick navigation"
            className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 grid grid-cols-5 gap-1"
          >
            {visibleNavGroups.flatMap((group) => group.items).slice(0, 4).map((tab) => {
              const Icon = SIDEBAR_ITEMS.find((item) => item.id === tab.id)?.icon || LayoutDashboard;
              const isActive = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSection(tab.id)}
                  className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer ${
                    isActive
                      ? 'text-[#173B75] dark:text-teal-400 bg-slate-100 dark:bg-slate-800'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 mb-0.5" />
                  <span className="truncate max-w-full">{tab.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 cursor-pointer"
            >
              <Menu className="w-4 h-4 mb-0.5" />
              <span>All Modules</span>
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
