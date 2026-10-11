import React, { useEffect, useRef, useState } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  DoughnutController,
  ArcElement,
  LineController,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import * as L from 'leaflet';
import {
  DatabaseState,
  User,
  ResearchLocation,
} from '../types/kmfri.ts';
import {
  getUserRoleName,
  filterProjectsForUser,
  filterOutputsForUser,
  filterReportsForUser,
  NavSectionId,
} from '../services/rbacPolicy.ts';
import { getDirectorateById, getUserById } from '../services/database.ts';
import { addKenyaBordersOverlay } from '../services/kenyaGeoJson.ts';
import { exportServerPdf } from '../services/exportService.ts';
import {
  computeProjectProductivityTrends,
  computeFundingAllocationTrends,
  computeDirectorateFundingBreakdown,
  TrendGranularity,
} from '../services/analyticsService.ts';
import {
  FolderKanban,
  Users,
  BookOpen,
  Landmark,
  CheckSquare,
  MapPin,
  Plus,
  Filter,
  ArrowUpRight,
  ShieldAlert,
  Activity,
  CheckCircle2,
  TrendingUp,
  Compass,
  Layers,
  RotateCcw,
  FileText,
} from 'lucide-react';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  DoughnutController,
  ArcElement,
  LineController,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend
);

interface DashboardViewProps {
  db: DatabaseState;
  currentUser: User;
  darkMode?: boolean;
  onNavigate: (section: NavSectionId) => void;
  onQuickCreateProject: () => void;
  onQuickCreateLocation: () => void;
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

const CircularCompletionRing: React.FC<{
  percent: number;
  label: string;
  sublabel: string;
}> = ({ percent, label, sublabel }) => {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
      <div className="relative inline-flex items-center justify-center w-16 h-16 shrink-0">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="5"
            className="text-slate-200 dark:text-slate-700"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="text-[#159A9C] dark:text-teal-400 transition-all duration-300"
          />
        </svg>
        <span className="absolute font-mono text-xs font-bold text-slate-900 dark:text-white">
          {clamped}%
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{label}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{sublabel}</div>
      </div>
    </div>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  db,
  currentUser,
  darkMode = false,
  onNavigate,
  onQuickCreateProject,
  onQuickCreateLocation,
}) => {
  const roleName = getUserRoleName(db, currentUser);
  const userDirectorate = getDirectorateById(db, currentUser.directorate_id);

  // Filters & interactive chart states
  const [filterDirectorate, setFilterDirectorate] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterYear, setFilterYear] = useState<string>('ALL');
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('quarterly');
  const [fundingChartView, setFundingChartView] = useState<'timeseries' | 'directorate'>(
    'timeseries'
  );
  const [basemapStyle, setBasemapStyle] = useState<BasemapStyle>('satellite');
  const [showKenyaBorders, setShowKenyaBorders] = useState<boolean>(true);
  const [activeStationId, setActiveStationId] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState<boolean>(false);

  const authorizedProjects = filterProjectsForUser(db, currentUser).filter((p) => {
    if (filterDirectorate !== 'ALL' && p.directorate_id !== filterDirectorate) return false;
    if (filterStatus !== 'ALL' && p.status !== filterStatus) return false;
    if (filterYear !== 'ALL' && !p.start_date.startsWith(filterYear)) return false;
    return true;
  });

  const authorizedOutputs = filterOutputsForUser(db, currentUser).filter((o) => {
    if (filterDirectorate !== 'ALL' && o.directorate_id !== filterDirectorate) return false;
    if (filterYear !== 'ALL' && !o.publication_date.startsWith(filterYear)) return false;
    return true;
  });

  const authorizedReports = filterReportsForUser(db, currentUser);

  const authorizedFunding = db.funding.filter((f) =>
    authorizedProjects.some((p) => p.id === f.project_id)
  );

  const authorizedTransactions = db.funding_transactions.filter((tx) =>
    authorizedFunding.some((f) => f.id === tx.funding_id)
  );

  const authorizedMilestones = db.project_milestones.filter((m) =>
    authorizedProjects.some((p) => p.id === m.project_id)
  );

  const authorizedActivities = db.research_activities.filter((a) =>
    authorizedProjects.some((p) => p.id === a.project_id)
  );

  // Real-time analytical calculations from analyticsService
  const productivityTrend = computeProjectProductivityTrends(
    authorizedProjects,
    authorizedOutputs,
    authorizedActivities,
    trendGranularity,
    authorizedMilestones
  );

  const fundingTrend = computeFundingAllocationTrends(
    authorizedFunding,
    trendGranularity,
    authorizedProjects,
    authorizedTransactions
  );

  const directorateFunding = computeDirectorateFundingBreakdown(
    db,
    authorizedProjects,
    authorizedFunding
  );

  const totalAwardedKes = fundingTrend.summary.totalAwardedKes;
  const totalAllocatedKes = fundingTrend.summary.totalAllocatedKes;
  const totalSpentKes = fundingTrend.summary.totalSpentKes;
  const remainingBalanceKes = fundingTrend.summary.totalRemainingKes;

  const pendingApprovalsCount =
    authorizedProjects.filter((p) =>
      ['Submitted', 'Under Review', 'Approved by Head of Directorate'].includes(p.status)
    ).length +
    authorizedOutputs.filter((o) =>
      ['Submitted', 'Under Review', 'Approved by Head of Directorate'].includes(o.status)
    ).length +
    authorizedReports.filter((r) => ['Submitted', 'Under Review'].includes(r.status)).length;

  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueReportsCount = authorizedReports.filter(
    (r) =>
      r.due_date < todayIso &&
      !['Approved by Head of Directorate', 'Approved by Director General'].includes(r.status)
  ).length;

  const avgProjectProgress =
    authorizedProjects.length > 0
      ? Math.round(
          authorizedProjects.reduce((sum, p) => sum + p.calculated_progress, 0) /
            authorizedProjects.length
        )
      : 0;

  const budgetAbsorptionRate = fundingTrend.summary.overallAbsorptionPct;

  const profileCompletionRate =
    db.users.length > 0
      ? Math.round(
          (db.researcher_profiles.filter((pr) => pr.orcid && pr.specialization).length /
            db.users.length) *
            100
        )
      : 0;

  // Chart Refs
  const productivityTrendRef = useRef<HTMLCanvasElement | null>(null);
  const productivityTrendInstance = useRef<Chart | null>(null);

  const fundingTrendRef = useRef<HTMLCanvasElement | null>(null);
  const fundingTrendInstance = useRef<Chart | null>(null);

  const dirChartRef = useRef<HTMLCanvasElement | null>(null);
  const dirChartInstance = useRef<Chart | null>(null);

  const statusChartRef = useRef<HTMLCanvasElement | null>(null);
  const statusChartInstance = useRef<Chart | null>(null);

  // Leaflet Map Refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  const bordersLayerRef = useRef<L.LayerGroup | null>(null);
  const markersMapRef = useRef<Record<string, L.Marker>>({});

  const axisTextColor = darkMode ? '#94A3B8' : '#475569';
  const gridLineColor = darkMode ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.22)';

  // 1. Interactive Project Productivity Trend Chart (Sourced via analyticsService)
  useEffect(() => {
    if (!productivityTrendRef.current) return;
    if (productivityTrendInstance.current) {
      productivityTrendInstance.current.destroy();
    }

    productivityTrendInstance.current = new Chart(productivityTrendRef.current, {
      type: 'line',
      data: {
        labels: productivityTrend.labels,
        datasets: [
          {
            label: 'Projects Initiated',
            data: productivityTrend.projectsStarted,
            borderColor: '#3155A4',
            backgroundColor: 'rgba(49, 85, 164, 0.14)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'Projects Completed',
            data: productivityTrend.projectsCompleted,
            borderColor: '#16866B',
            backgroundColor: 'rgba(22, 134, 107, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'Publications & Outputs',
            data: productivityTrend.outputsPublished,
            borderColor: '#159A9C',
            backgroundColor: 'rgba(21, 154, 156, 0.08)',
            fill: false,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'Milestones & Fieldwork',
            data: productivityTrend.activitiesLogged.map(
              (actCount, idx) => actCount + (productivityTrend.milestonesCompleted[idx] || 0)
            ),
            borderColor: '#0284C7',
            borderDash: [4, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 3.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: axisTextColor, boxWidth: 12, font: { size: 11 } },
          },
        },
        scales: {
          x: {
            ticks: { color: axisTextColor, font: { size: 10 } },
            grid: { color: gridLineColor },
          },
          y: {
            beginAtZero: true,
            ticks: { color: axisTextColor, stepSize: 1, font: { size: 10 } },
            grid: { color: gridLineColor },
          },
        },
      },
    });

    return () => {
      productivityTrendInstance.current?.destroy();
    };
  }, [productivityTrend, axisTextColor, gridLineColor]);

  // 2. Interactive Funding Allocation & Expenditure Trend Chart (Sourced via analyticsService)
  useEffect(() => {
    if (!fundingTrendRef.current) return;
    if (fundingTrendInstance.current) {
      fundingTrendInstance.current.destroy();
    }

    const isTimeSeries = fundingChartView === 'timeseries';
    const labels = isTimeSeries ? fundingTrend.labels : directorateFunding.codes;
    const allocatedData = isTimeSeries
      ? fundingTrend.allocatedAmounts
      : directorateFunding.allocatedByDirectorate;
    const spentData = isTimeSeries
      ? fundingTrend.spentAmounts
      : directorateFunding.spentByDirectorate;
    const remainingData = isTimeSeries
      ? fundingTrend.remainingBalances
      : directorateFunding.remainingByDirectorate;

    fundingTrendInstance.current = new Chart(fundingTrendRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Allocated Budget (KES)',
            data: allocatedData,
            backgroundColor: '#173B75',
            borderRadius: 5,
          },
          {
            label: 'Expended Funds (KES)',
            data: spentData,
            backgroundColor: '#159A9C',
            borderRadius: 5,
          },
          {
            label: 'Remaining Balance (KES)',
            data: remainingData,
            backgroundColor: '#16866B',
            borderRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: axisTextColor, boxWidth: 12, font: { size: 11 } },
          },
        },
        scales: {
          x: {
            ticks: { color: axisTextColor, font: { size: 10 } },
            grid: { color: gridLineColor },
          },
          y: {
            beginAtZero: true,
            ticks: { color: axisTextColor, font: { size: 10 } },
            grid: { color: gridLineColor },
          },
        },
      },
    });

    return () => {
      fundingTrendInstance.current?.destroy();
    };
  }, [fundingTrend, directorateFunding, fundingChartView, axisTextColor, gridLineColor]);

  // 3. Directorate Capacity Chart
  useEffect(() => {
    if (!dirChartRef.current) return;
    if (dirChartInstance.current) {
      dirChartInstance.current.destroy();
    }

    const labels = db.directorates.map((d) => d.code);
    const projectCounts = db.directorates.map(
      (d) => authorizedProjects.filter((p) => p.directorate_id === d.id).length
    );
    const scientistCounts = db.directorates.map(
      (d) => db.users.filter((u) => u.directorate_id === d.id).length
    );
    const stationCounts = db.directorates.map(
      (d) => db.locations.filter((l) => l.directorate_id === d.id).length
    );

    dirChartInstance.current = new Chart(dirChartRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Staff & Scientists',
            data: scientistCounts,
            backgroundColor: '#173B75',
            borderRadius: 4,
          },
          {
            label: 'Projects',
            data: projectCounts,
            backgroundColor: '#159A9C',
            borderRadius: 4,
          },
          {
            label: 'KMFRI Stations',
            data: stationCounts,
            backgroundColor: '#16866B',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: axisTextColor, boxWidth: 12, font: { size: 11 } },
          },
        },
        scales: {
          x: {
            ticks: { color: axisTextColor, font: { size: 10 } },
            grid: { color: gridLineColor },
          },
          y: {
            beginAtZero: true,
            ticks: { color: axisTextColor, stepSize: 1, font: { size: 10 } },
            grid: { color: gridLineColor },
          },
        },
      },
    });

    return () => {
      dirChartInstance.current?.destroy();
    };
  }, [db.directorates, db.users, db.locations, authorizedProjects, axisTextColor, gridLineColor]);

  // 4. Lifecycle Status Doughnut Chart
  useEffect(() => {
    if (!statusChartRef.current) return;
    if (statusChartInstance.current) {
      statusChartInstance.current.destroy();
    }

    const statuses = [
      'Draft',
      'Submitted',
      'Approved by Head of Directorate',
      'Approved by Director General',
      'In Progress',
      'Completed',
    ];
    const counts = statuses.map((s) => authorizedProjects.filter((p) => p.status === s).length);
    const total = counts.reduce((a, b) => a + b, 0);

    statusChartInstance.current = new Chart(statusChartRef.current, {
      type: 'doughnut',
      data: {
        labels: total > 0 ? statuses : ['No Projects Recorded (0)'],
        datasets: [
          {
            data: total > 0 ? counts : [1],
            backgroundColor:
              total > 0
                ? ['#64748B', '#D97706', '#0284C7', '#159A9C', '#3155A4', '#16866B']
                : [darkMode ? '#334155' : '#CBD5E1'],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: axisTextColor, boxWidth: 12, font: { size: 11 } },
          },
        },
      },
    });

    return () => {
      statusChartInstance.current?.destroy();
    };
  }, [authorizedProjects, axisTextColor, darkMode]);

  // 5. Modern Interactive Leaflet GIS Map with All 10 KMFRI Stations Pinned
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!leafletMapRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
      }).setView([-1.35, 37.65], 6);
      leafletMapRef.current = map;
    }

    const map = leafletMapRef.current;

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

    // Clear previous markers
    Object.values(markersMapRef.current).forEach((m) => map.removeLayer(m));
    markersMapRef.current = {};

    db.locations.forEach((loc: ResearchLocation) => {
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
        className: 'kmfri-custom-map-pin',
        html: `
          <div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
            <span style="position:absolute;width:26px;height:26px;border-radius:9999px;background:${pinColor};opacity:0.25;transform:scale(1.1);"></span>
            <span style="position:relative;width:16px;height:16px;border-radius:9999px;background:${pinColor};border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></span>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([loc.latitude, loc.longitude], { icon: customIcon }).addTo(map);
      marker.bindPopup(
        `<div style="font-family:'Public Sans',sans-serif;min-width:210px;padding:2px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${pinColor};color:#fff;font-family:monospace;">
              ${dir?.code || 'KMFRI'} STATION
            </span>
            <span style="font-size:10px;color:#64748B;font-family:monospace;">
              ${loc.county}
            </span>
          </div>
          <div style="font-size:12.5px;font-weight:700;color:#0F172A;margin-bottom:2px;">
            ${loc.name}
          </div>
          <div style="font-size:11px;color:#475569;margin-bottom:4px;">
            ${loc.site} · ${loc.ecosystem_type}
          </div>
          <div style="font-size:10.5px;font-family:monospace;color:#0F766E;background:#F1F5F9;padding:3px 6px;border-radius:4px;">
            GPS: ${loc.latitude.toFixed(4)}°, ${loc.longitude.toFixed(4)}°
          </div>
        </div>`
      );

      markersMapRef.current[loc.id] = marker;
    });
  }, [db.locations, basemapStyle, showKenyaBorders]);

  const handleFlyToStation = (loc: ResearchLocation) => {
    setActiveStationId(loc.id);
    const map = leafletMapRef.current;
    if (!map) return;
    map.flyTo([loc.latitude, loc.longitude], 10, { duration: 1.1 });
    const marker = markersMapRef.current[loc.id];
    if (marker) {
      marker.openPopup();
    }
  };

  const handleResetMapBounds = () => {
    setActiveStationId(null);
    const map = leafletMapRef.current;
    if (!map) return;
    map.flyTo([-1.35, 37.65], 6, { duration: 0.9 });
  };

  const roleHeaderTitle: Record<string, string> = {
    scientist: 'Scientist & Principal Investigator Research Workspace',
    head_of_directorate: `Head of Directorate Oversight — ${userDirectorate?.code || ''} (${userDirectorate?.name || ''})`,
    directorate_admin: `Directorate Operations & Administrative Command — ${userDirectorate?.code || ''}`,
    director_general: 'Director General Institution-Wide Executive Command',
    system_admin: 'System Administration, RBAC Governance & Platform Security',
  };

  return (
    <div className="space-y-6">
      {/* Executive Institutional Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0A2540] via-[#173B75] to-[#159A9C] text-white p-6 shadow-md border border-white/10">
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            background:
              'radial-gradient(circle at 88% 20%, rgba(255,255,255,0.35) 0%, transparent 50%)',
          }}
        />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-wider text-teal-200 font-semibold">
              <span>Welcome to KMFRI Research Management Portal</span>
              <span aria-hidden="true">·</span>
              <span>{currentUser.staff_number}</span>
              <span aria-hidden="true">·</span>
              <span>
                {userDirectorate
                  ? `${userDirectorate.code} — ${userDirectorate.name}`
                  : 'Mombasa National Headquarters'}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold font-display tracking-tight">
              Welcome back, {currentUser.full_name}
            </h1>
            <p className="text-xs sm:text-sm text-sky-100/90 max-w-3xl leading-relaxed">
              {roleHeaderTitle[roleName] || 'KMFRI Institutional Research Dashboard'} — Your
              session is protected by multi-round salted password hashing, 2FA email verification,
              and role-based access enforcement.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onQuickCreateProject}
              className="px-4 py-2.5 bg-white text-[#173B75] hover:bg-sky-50 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Research Project</span>
            </button>
            <button
              type="button"
              disabled={exportingPdf}
              onClick={async () => {
                try {
                  setExportingPdf(true);
                  await exportServerPdf({
                    type: 'projects_summary',
                    user: currentUser,
                    db,
                    filterDirectorate,
                    filterStatus,
                    filename: `KMFRI_Portfolio_Summary_${new Date().toISOString().slice(0, 10)}.pdf`,
                  });
                } catch (err) {
                  console.error(err);
                } finally {
                  setExportingPdf(false);
                }
              }}
              className="px-4 py-2.5 bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{exportingPdf ? 'Generating PDF...' : 'Export Portfolio PDF'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Role Personalized Filter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 font-medium">
          <span className="font-bold text-slate-900 dark:text-white">
            Portfolio Analytics Filters:
          </span>
          <span>Scope by Directorate, Lifecycle Status, and Fiscal Year</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={filterDirectorate}
              onChange={(e) => setFilterDirectorate(e.target.value)}
              aria-label="Filter by directorate"
              className="bg-transparent text-xs font-medium focus:outline-none"
            >
              <option value="ALL">All 4 Directorates</option>
              {db.directorates.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="Filter by project status"
            className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-200"
          >
            <option value="ALL">All Lifecycle Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Submitted">Submitted</option>
            <option value="Approved by Head of Directorate">Approved by HOD</option>
            <option value="Approved by Director General">Approved by DG</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
          </select>

          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            aria-label="Filter by year"
            className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-200 font-mono"
          >
            <option value="ALL">All Years</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
          </select>
        </div>
      </div>

      {/* Database-Derived Interactive KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('scientists')}
          className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#159A9C] rounded-xl p-4 transition-colors cursor-pointer group shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">Registered Staff &amp; Scientists</span>
            <Users className="w-4 h-4 text-[#159A9C] group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {db.users.length}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Active: {db.users.filter((u) => u.account_status === 'Active').length}</span>
            <span aria-hidden="true">·</span>
            <span>Stations: {db.locations.length}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('projects')}
          className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#159A9C] rounded-xl p-4 transition-colors cursor-pointer group shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">Authorized Projects</span>
            <FolderKanban className="w-4 h-4 text-[#159A9C] group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {authorizedProjects.length}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Ongoing: {authorizedProjects.filter((p) => p.status === 'In Progress').length}</span>
            <span aria-hidden="true">·</span>
            <span>Completed: {authorizedProjects.filter((p) => p.status === 'Completed').length}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('outputs')}
          className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#159A9C] rounded-xl p-4 transition-colors cursor-pointer group shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">Publications &amp; Outputs</span>
            <BookOpen className="w-4 h-4 text-[#159A9C] group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {authorizedOutputs.length}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              Approved:{' '}
              {
                authorizedOutputs.filter((o) =>
                  ['Approved by Head of Directorate', 'Approved by Director General'].includes(o.status)
                ).length
              }
            </span>
            <span aria-hidden="true">·</span>
            <span>Drafts: {authorizedOutputs.filter((o) => o.status === 'Draft').length}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('funding')}
          className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#159A9C] rounded-xl p-4 transition-colors cursor-pointer group shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">Remaining Grant Balance</span>
            <Landmark className="w-4 h-4 text-[#159A9C] group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums truncate">
            KES {remainingBalanceKes.toLocaleString()}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            <span>Awarded: {totalAwardedKes.toLocaleString()}</span>
            <span aria-hidden="true">·</span>
            <span>Spent: {totalSpentKes.toLocaleString()}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('approvals')}
          className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#159A9C] rounded-xl p-4 transition-colors cursor-pointer group shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">Approval Queue &amp; Deadlines</span>
            <CheckSquare className="w-4 h-4 text-amber-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {pendingApprovalsCount}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Pending Reviews: {pendingApprovalsCount}</span>
            <span aria-hidden="true">·</span>
            <span className={overdueReportsCount > 0 ? 'text-red-600 font-semibold' : ''}>
              Overdue Reports: {overdueReportsCount}
            </span>
          </div>
        </button>
      </div>

      {/* Scientist Personal Research, Publications Studio & SharePoint Summary Hub */}
      <div className="bg-gradient-to-r from-[#173B75]/95 via-[#1E3A8A]/95 to-[#159A9C]/95 text-white rounded-xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-teal-200 font-bold mb-1">
              Personal Scientist Summary · {currentUser.full_name} ({currentUser.staff_number})
            </div>
            <h2 className="text-base font-bold font-display">
              Your Research Portfolio, Authoring Studio &amp; SharePoint Co-Authoring Hub
            </h2>
            <p className="text-xs text-sky-100/90 mt-0.5">
              Track your milestone schedules on the Gantt timeline, write and ground manuscripts in
              the Publications Studio, or co-author documents in SharePoint Word Studio.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="px-3.5 py-2 rounded-lg bg-white text-[#173B75] hover:bg-sky-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Gantt &amp; Projects ({authorizedProjects.length})</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('outputs')}
              className="px-3.5 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white border border-white/25 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Publications Studio ({authorizedOutputs.length})</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('sharepoint_hub')}
              className="px-3.5 py-2 rounded-lg bg-teal-500/30 hover:bg-teal-500/45 text-white border border-teal-300/40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>SharePoint &amp; Word Hub ({db.documents.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Project Productivity & Funding Allocation Trend Charts (analyticsService) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#159A9C]" />
              <span>Interactive Project Productivity &amp; Grant Funding Allocation Trends</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real-time analytical time-series computed from stored projects, milestones, outputs, and grant allocations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setTrendGranularity('monthly')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                  trendGranularity === 'monthly'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setTrendGranularity('quarterly')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                  trendGranularity === 'quarterly'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Quarterly
              </button>
              <button
                type="button"
                onClick={() => setTrendGranularity('yearly')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                  trendGranularity === 'yearly'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Annual
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Chart 1: Project Productivity Trend */}
          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Research Productivity &amp; Output Velocity Trend
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Projects initiated ({productivityTrend.summary.totalInitiated}), completed (
                  {productivityTrend.summary.totalCompleted}), outputs (
                  {productivityTrend.summary.totalOutputs}), and field hours (
                  {productivityTrend.summary.totalFieldHours}h)
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#159A9C]/10 text-[#159A9C] dark:text-teal-300 font-mono text-[10px] font-bold shrink-0">
                {productivityTrend.summary.completionRatePct}% Completion
              </span>
            </div>
            <div className="h-64 relative">
              <canvas ref={productivityTrendRef} />
            </div>
          </div>

          {/* Chart 2: Funding Allocation & Expenditure Trend */}
          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Funding Allocation, Disbursement &amp; Balance Trend
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Allocated KES {totalAllocatedKes.toLocaleString()} · Spent KES{' '}
                  {totalSpentKes.toLocaleString()} ({budgetAbsorptionRate}% absorption)
                </p>
              </div>
              <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px]">
                <button
                  type="button"
                  onClick={() => setFundingChartView('timeseries')}
                  className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                    fundingChartView === 'timeseries'
                      ? 'bg-[#173B75] text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Time Series
                </button>
                <button
                  type="button"
                  onClick={() => setFundingChartView('directorate')}
                  className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                    fundingChartView === 'directorate'
                      ? 'bg-[#173B75] text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  By Directorate
                </button>
              </div>
            </div>
            <div className="h-64 relative">
              <canvas ref={fundingTrendRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Modern Interactive KMFRI National Stations GIS Map & Station Explorer */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
              <Compass className="w-4 h-4 text-[#159A9C]" />
              <span>
                KMFRI National Research Centres &amp; Field Stations GIS Map ({db.locations.length}{' '}
                Stations Pinned)
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any station marker or directory card below to fly directly to Mombasa HQ, Kisumu,
              Sagana, Gazi Bay, Shimoni, Malindi, Lamu, Kegati, Lake Turkana, or Lake Naivasha.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Basemap Style Switcher (Satellite Default + Kenya Borders Toggle) */}
            <button
              type="button"
              onClick={() => setShowKenyaBorders((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                showKenyaBorders
                  ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-400 text-sky-700 dark:text-sky-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span>Kenya Borders &amp; EEZ</span>
            </button>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
              <Layers className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-0.5" />
              <button
                type="button"
                onClick={() => setBasemapStyle('satellite')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
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
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  basemapStyle === 'voyager'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Modern Map
              </button>
              <button
                type="button"
                onClick={() => setBasemapStyle('dark')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
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
              onClick={handleResetMapBounds}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset View</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('locations')}
              className="px-3 py-1.5 rounded-lg bg-[#159A9C] hover:bg-teal-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Manage GIS Stations</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Interactive Map Canvas */}
          <div className="lg:col-span-8 relative min-h-[380px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-inner">
            <div ref={mapContainerRef} className="w-full h-full min-h-[380px]" />
          </div>

          {/* Interactive Station Quick-Jump List */}
          <div className="lg:col-span-4 flex flex-col justify-between bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 max-h-[380px] overflow-y-auto space-y-2">
            <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Pinned KMFRI Stations ({db.locations.length})
              </span>
              <span className="text-[10px] font-mono text-slate-500">Click to Focus</span>
            </div>
            <div className="space-y-2 overflow-y-auto pr-1">
              {db.locations.map((loc) => {
                const dir = getDirectorateById(db, loc.directorate_id);
                const isSelected = activeStationId === loc.id;
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => handleFlyToStation(loc)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#173B75] text-white border-[#173B75] shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-[#159A9C]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span
                        className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-teal-50 dark:bg-teal-950/60 text-[#159A9C] dark:text-teal-300'
                        }`}
                      >
                        {dir?.code || 'KMFRI'}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          isSelected ? 'text-sky-200' : 'text-slate-400'
                        }`}
                      >
                        {loc.latitude.toFixed(3)}°, {loc.longitude.toFixed(3)}°
                      </span>
                    </div>
                    <div
                      className={`text-xs font-bold truncate ${
                        isSelected ? 'text-white' : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {loc.name}
                    </div>
                    <div
                      className={`text-[11px] truncate ${
                        isSelected ? 'text-slate-200' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {loc.county} · {loc.site}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Rings & Directorate Capacity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                  Progress Rings &amp; Institutional Readiness
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Milestone completion, grant absorption, and ORCID coverage
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('projects')}
                className="text-xs font-semibold text-[#159A9C] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Gantt Schedule</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3 mt-4">
              <CircularCompletionRing
                percent={avgProjectProgress}
                label="Mean Milestone Completion"
                sublabel={`Across ${authorizedProjects.length} authorized project(s)`}
              />
              <CircularCompletionRing
                percent={budgetAbsorptionRate}
                label="Grant Budget Absorption Rate"
                sublabel={`KES ${totalSpentKes.toLocaleString()} spent of KES ${totalAllocatedKes.toLocaleString()}`}
              />
              <CircularCompletionRing
                percent={profileCompletionRate}
                label="ORCID & Profile Completeness"
                sublabel={`${db.researcher_profiles.filter((pr) => pr.orcid && pr.specialization).length} of ${db.users.length} researcher profile(s) completed`}
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Directorate Capacity &amp; Stations Comparison
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Distribution across OCS, FWS, ARD, and SED
            </p>
          </div>
          <div className="h-64 relative">
            <canvas ref={dirChartRef} />
          </div>
        </div>

        <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Projects by Lifecycle Status
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Draft through DG approval &amp; completion
            </p>
          </div>
          <div className="h-64 relative">
            <canvas ref={statusChartRef} />
          </div>
        </div>
      </div>

      {/* Role-Specific Contextual Panel for System Admin */}
      {roleName === 'system_admin' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#159A9C]" />
              <span>System Administrator Governance &amp; Security Overview</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('audit_logs')}
              className="text-xs font-semibold text-[#159A9C] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Inspect Append-Only Audit Logs ({db.audit_logs.length})</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">
                Protected Core Directorates
              </span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
                4 (OCS · FWS · ARD · SED)
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">
                National KMFRI Stations
              </span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
                {db.locations.length} Georeferenced Sites
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">
                Private Storage Documents
              </span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
                {db.documents.length} files
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">Audit Trail Events</span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
                {db.audit_logs.length} immutable records
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Live Activity Feed & Recent Approval Tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#159A9C]" />
              <span>Recent Workflow Approvals &amp; Decisions ({db.approvals.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="text-xs font-semibold text-[#159A9C] hover:underline cursor-pointer"
            >
              View Approval Queue
            </button>
          </div>
          {db.approvals.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
              No workflow transitions recorded yet. Submit a project or research output to track review
              stages.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {db.approvals.slice(0, 4).map((a) => (
                <div key={a.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-white truncate">
                      {a.entity_title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      {a.previous_state} → {a.new_state}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-[#159A9C] shrink-0">
                    {a.decision}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#159A9C]" />
              <span>Recent Fieldwork &amp; Scientific Activities ({db.research_activities.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('activities')}
              className="text-xs font-semibold text-[#159A9C] hover:underline cursor-pointer"
            >
              Log Activity
            </button>
          </div>
          {db.research_activities.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
              No research activities recorded yet. Log fieldwork, hydro-surveys, or laboratory analyses.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {db.research_activities.slice(0, 4).map((act) => {
                const sci = getUserById(db, act.scientist_id);
                return (
                  <div key={act.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {act.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {act.activity_category} · {sci?.full_name}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                      {act.activity_date} ({act.hours}h)
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Four Fixed Directorates Summary Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Institutional Performance Across the Four Fixed KMFRI Directorates
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All metrics are computed dynamically from stored relational records
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-800/50">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Directorate Name</th>
                <th className="py-3 px-4 text-right">Scientists</th>
                <th className="py-3 px-4 text-right">Projects</th>
                <th className="py-3 px-4 text-right">Approved Outputs</th>
                <th className="py-3 px-4 text-right">Allocated Funding (KES)</th>
                <th className="py-3 px-4 text-right">KMFRI Stations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {db.directorates.map((dir, idx) => {
                const sciCount = db.users.filter((u) => u.directorate_id === dir.id).length;
                const projList = db.projects.filter((p) => p.directorate_id === dir.id);
                const outCount = db.research_outputs.filter(
                  (o) =>
                    o.directorate_id === dir.id &&
                    ['Approved by Head of Directorate', 'Approved by Director General'].includes(
                      o.status
                    )
                ).length;
                const dirFunding = directorateFunding.allocatedByDirectorate[idx] || 0;
                const locCount = db.locations.filter((l) => l.directorate_id === dir.id).length;

                return (
                  <tr key={dir.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono font-bold text-[#159A9C]">
                      {dir.code}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{dir.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {dir.description}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{sciCount}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {projList.length}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{outCount}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {dirFunding.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{locCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
