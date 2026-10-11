import React, { useState } from 'react';
import {
  Project,
  ProjectMilestone,
  DatabaseState,
  User,
} from '../types/kmfri.ts';
import { getDirectorateById, getUserById, appendAuditLog } from '../services/database.ts';
import {
  Calendar,
  Flag,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

interface ProjectGanttChartProps {
  db: DatabaseState;
  currentUser?: User;
  projects: Project[];
  milestones: ProjectMilestone[];
  selectedProject?: Project | null;
  onSelectProject?: (projectId: string) => void;
  onUpdateDb?: (next: DatabaseState) => void;
}

export const ProjectGanttChart: React.FC<ProjectGanttChartProps> = ({
  db,
  currentUser,
  projects,
  milestones,
  selectedProject,
  onSelectProject,
  onUpdateDb,
}) => {
  const [zoomScale, setZoomScale] = useState<'weeks' | 'months' | 'quarters'>('months');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dirFilter, setDirFilter] = useState<string>('ALL');
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  const targetProjects = selectedProject ? [selectedProject] : projects;
  const filteredProjects = targetProjects.filter((p) => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (dirFilter !== 'ALL' && p.directorate_id !== dirFilter) return false;
    return true;
  });

  const todayStr = new Date().toISOString().slice(0, 10);

  const visibleProjectIds = new Set(filteredProjects.map((p) => p.id));
  const visibleMilestones = milestones.filter((m) => visibleProjectIds.has(m.project_id));
  const completedMsCount = visibleMilestones.filter((m) => m.status === 'Completed').length;
  const overdueMsCount = visibleMilestones.filter(
    (m) => m.due_date < todayStr && m.status !== 'Completed'
  ).length;
  const onTrackProjectsCount = filteredProjects.filter(
    (p) => !(p.expected_end_date < todayStr && p.status !== 'Completed')
  ).length;

  const handleInlineMilestoneProgress = (
    project: Project,
    milestone: ProjectMilestone,
    nextProgress: number
  ) => {
    if (!onUpdateDb) return;
    const clamped = Math.min(100, Math.max(0, nextProgress));
    const nextStatus: ProjectMilestone['status'] =
      clamped === 100
        ? 'Completed'
        : milestone.due_date < todayStr
        ? 'Overdue'
        : clamped > 0
        ? 'In Progress'
        : 'Pending';

    const updatedMs: ProjectMilestone = {
      ...milestone,
      progress: clamped,
      status: nextStatus,
      completion_date: clamped === 100 ? todayStr : null,
    };

    const nextMilestones = db.project_milestones.map((m) =>
      m.id === milestone.id ? updatedMs : m
    );
    const projMs = nextMilestones.filter((m) => m.project_id === project.id);
    const recalculated =
      projMs.length > 0
        ? Math.round(projMs.reduce((s, m) => s + m.progress, 0) / projMs.length)
        : project.calculated_progress;

    let nextState: DatabaseState = {
      ...db,
      project_milestones: nextMilestones,
      projects: db.projects.map((p) =>
        p.id === project.id
          ? {
              ...p,
              calculated_progress: recalculated,
              status: recalculated === 100 ? 'Completed' : p.status,
              actual_completion_date: recalculated === 100 ? todayStr : p.actual_completion_date,
              updated_at: new Date().toISOString(),
            }
          : p
      ),
    };

    if (currentUser) {
      nextState = appendAuditLog(
        nextState,
        currentUser,
        'GANTT_MILESTONE_PROGRESS_UPDATED',
        'project_milestones',
        milestone.id,
        { progress: milestone.progress, status: milestone.status },
        { progress: clamped, status: nextStatus, project_calculated_progress: recalculated }
      );
    }

    onUpdateDb(nextState);
  };

  if (filteredProjects.length === 0) {
    return (
      <div className="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-center">
        <Calendar className="w-6 h-6 text-teal-600 mx-auto mb-2" />
        <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">
          No Scheduled Projects or Milestones to Plot on Gantt Timeline
        </p>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Create a project with valid start/end dates or add deliverables in the Milestones tab to
          visualize schedules and deadline progression against planned baselines.
        </p>
      </div>
    );
  }

  // Compute global timeline bounds across displayed projects & milestones
  const allDates: number[] = [new Date(todayStr).getTime()];

  filteredProjects.forEach((p) => {
    const s = new Date(p.start_date).getTime();
    const e = new Date(p.expected_end_date).getTime();
    if (!Number.isNaN(s)) allDates.push(s);
    if (!Number.isNaN(e)) allDates.push(e);
  });

  visibleMilestones.forEach((m) => {
    const d = new Date(m.due_date).getTime();
    if (!Number.isNaN(d)) allDates.push(d);
  });

  const minRaw = Math.min(...allDates);
  const maxRaw = Math.max(...allDates);
  const DAY_MS = 86400000;
  const startBound = minRaw - 15 * DAY_MS;
  const endBound = Math.max(maxRaw + 20 * DAY_MS, startBound + 90 * DAY_MS);
  const totalSpanMs = Math.max(1, endBound - startBound);

  const toPercent = (dateStr: string): number => {
    const t = new Date(dateStr).getTime();
    if (Number.isNaN(t)) return 0;
    const pct = ((t - startBound) / totalSpanMs) * 100;
    return Math.min(100, Math.max(0, pct));
  };

  const todayPct = toPercent(todayStr);

  // Generate header ticks
  const tickCount = zoomScale === 'weeks' ? 10 : zoomScale === 'months' ? 8 : 5;
  const ticks: { label: string; pct: number }[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const ratio = i / tickCount;
    const t = new Date(startBound + ratio * totalSpanMs);
    const label =
      zoomScale === 'weeks'
        ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : zoomScale === 'months'
        ? t.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
        : `Q${Math.floor(t.getMonth() / 3) + 1} '${String(t.getFullYear()).slice(2)}`;
    ticks.push({ label, pct: ratio * 100 });
  }

  return (
    <div className="space-y-4">
      {/* Gantt Schedule Health KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 block">Scheduled Projects</span>
            <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
              {filteredProjects.length}{' '}
              <span className="text-xs font-normal text-emerald-600">
                ({onTrackProjectsCount} On-Schedule)
              </span>
            </span>
          </div>
          <Calendar className="w-4 h-4 text-[#173B75] dark:text-sky-400" />
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 block">Tracked Milestones</span>
            <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
              {visibleMilestones.length}
            </span>
          </div>
          <Flag className="w-4 h-4 text-[#159A9C]" />
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 block">Completed Deliverables</span>
            <span className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-400">
              {completedMsCount} / {visibleMilestones.length}
            </span>
          </div>
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 block">Overdue / Variance Alerts</span>
            <span
              className={`text-base font-bold font-mono ${
                overdueMsCount > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {overdueMsCount} Overdue
            </span>
          </div>
          {overdueMsCount > 0 ? (
            <AlertTriangle className="w-4 h-4 text-red-600" />
          ) : (
            <Clock className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </div>

      {/* Gantt Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#159A9C]" />
            <span>Interactive Gantt Schedule &amp; Milestone Progression Matrix</span>
          </h3>
          <p className="text-xs text-slate-500">
            Tracks planned schedules vs. actual milestone completion against Today ({todayStr}). Click
            any milestone percentage badge to update completion directly on the timeline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!selectedProject && (
            <>
              <select
                value={dirFilter}
                onChange={(e) => setDirFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium"
              >
                <option value="ALL">All Directorates</option>
                {db.directorates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium"
              >
                <option value="ALL">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Submitted">Submitted</option>
                <option value="Approved by Head of Directorate">Approved by HOD</option>
                <option value="Approved by Director General">Approved by DG</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setZoomScale('weeks')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                zoomScale === 'weeks'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Bi-Weekly
            </button>
            <button
              type="button"
              onClick={() => setZoomScale('months')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                zoomScale === 'months'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setZoomScale('quarters')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                zoomScale === 'quarters'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Quarterly
            </button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-xs bg-slate-300 dark:bg-slate-700 inline-block" />
          Planned Baseline Window
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-xs bg-gradient-to-r from-[#173B75] to-[#159A9C] inline-block" />
          Actual Milestone Progress Fill
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rotate-45 bg-emerald-600 inline-block" />
          Completed (100%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rotate-45 bg-amber-500 inline-block" />
          In Progress / Pending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rotate-45 bg-red-600 inline-block" />
          Overdue Deadline
        </span>
        <span className="flex items-center gap-1.5 font-mono text-sky-700 dark:text-sky-400 font-semibold">
          | Today Baseline ({todayStr})
        </span>
      </div>

      {/* Gantt Grid Canvas (Horizontally scrollable on narrow mobile screens) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto bg-white dark:bg-slate-900">
        <div className="min-w-[680px]">
          {/* Timeline Header Row */}
          <div className="grid grid-cols-12 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-500">
          <div className="col-span-5 lg:col-span-4 py-2.5 px-4 border-r border-slate-200 dark:border-slate-800">
            Project / Deliverable Milestone Schedule
          </div>
          <div className="col-span-7 lg:col-span-8 relative py-2.5 px-4 h-9">
            {ticks.map((t, idx) => (
              <span
                key={idx}
                style={{ left: `${Math.min(94, Math.max(2, t.pct))}%` }}
                className="absolute top-2.5 -translate-x-1/2 font-mono text-[10px] text-slate-500 whitespace-nowrap"
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* Project & Milestone Rows */}
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {filteredProjects.map((project) => {
            const dir = getDirectorateById(db, project.directorate_id);
            const projMilestones = milestones
              .filter((m) => m.project_id === project.id)
              .sort((a, b) => a.due_date.localeCompare(b.due_date));

            const startPct = toPercent(project.start_date);
            const endPct = toPercent(project.expected_end_date);
            const widthPct = Math.max(4, endPct - startPct);
            const isOverdueProject =
              project.expected_end_date < todayStr && project.status !== 'Completed';
            const isCollapsed = Boolean(collapsedProjects[project.id]);

            // Calculate elapsed planned time percentage vs actual progress
            const projStartMs = new Date(project.start_date).getTime();
            const projEndMs = new Date(project.expected_end_date).getTime();
            const nowMs = new Date(todayStr).getTime();
            const plannedElapsedPct =
              projEndMs > projStartMs
                ? Math.min(100, Math.max(0, Math.round(((nowMs - projStartMs) / (projEndMs - projStartMs)) * 100)))
                : 0;
            const scheduleDelta = project.calculated_progress - plannedElapsedPct;

            return (
              <div key={project.id} className="group">
                {/* Parent Project Bar Row */}
                <div className="grid grid-cols-12 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <div className="col-span-5 lg:col-span-4 py-3 px-4 border-r border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedProjects((prev) => ({
                              ...prev,
                              [project.id]: !prev[project.id],
                            }))
                          }
                          className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 cursor-pointer shrink-0"
                          title={isCollapsed ? 'Expand milestones' : 'Collapse milestones'}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectProject?.(project.id)}
                          className="text-left font-bold text-xs text-slate-900 dark:text-white hover:text-teal-700 dark:hover:text-teal-400 truncate cursor-pointer"
                        >
                          {project.project_code} — {project.title}
                        </button>
                      </div>

                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                          scheduleDelta >= 0
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                        }`}
                        title="Actual Progress vs Planned Time Elapsed"
                      >
                        {scheduleDelta >= 0 ? `+${scheduleDelta}% Ahead` : `${scheduleDelta}% Behind`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mt-1 font-mono pl-5">
                      <span className="font-bold text-[#173B75] dark:text-sky-400">{dir?.code}</span>
                      <span>·</span>
                      <span>
                        {project.start_date} → {project.expected_end_date}
                      </span>
                      <span>·</span>
                      <span className="text-teal-700 dark:text-teal-400 font-semibold">
                        {project.calculated_progress}% Calc ({projMilestones.length} MS)
                      </span>
                    </div>
                  </div>

                  {/* Timeline Track */}
                  <div className="col-span-7 lg:col-span-8 relative h-14 px-4 flex items-center">
                    {/* Vertical Grid Guides */}
                    {ticks.map((t, idx) => (
                      <div
                        key={idx}
                        style={{ left: `${t.pct}%` }}
                        className="absolute top-0 bottom-0 w-px bg-slate-100 dark:bg-slate-800/70 pointer-events-none"
                      />
                    ))}

                    {/* Today Marker Line */}
                    <div
                      style={{ left: `${todayPct}%` }}
                      className="absolute top-0 bottom-0 w-0.5 bg-sky-500/80 z-10 pointer-events-none"
                      title={`Today: ${todayStr}`}
                    />

                    {/* Planned Project Bar */}
                    <div
                      style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                      className={`relative h-6 rounded-md overflow-hidden border shadow-2xs ${
                        isOverdueProject
                          ? 'bg-red-100/70 dark:bg-red-950/50 border-red-300 dark:border-red-800'
                          : 'bg-slate-200/80 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                      }`}
                      title={`${project.title} | Planned: ${project.start_date} to ${project.expected_end_date} | Progress: ${project.calculated_progress}%`}
                    >
                      {/* System-Calculated Milestone Progress Fill */}
                      <div
                        style={{ width: `${project.calculated_progress}%` }}
                        className="h-full bg-gradient-to-r from-[#173B75] via-[#159A9C] to-[#16866B] transition-all duration-300"
                      />
                      <span className="absolute inset-0 flex items-center justify-between px-2.5 text-[10px] font-mono font-bold text-slate-900 dark:text-white mix-blend-difference">
                        <span className="truncate">{project.status}</span>
                        <span>{project.calculated_progress}%</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Child Milestone Rows */}
                {!isCollapsed &&
                  projMilestones.map((ms) => {
                    const duePct = toPercent(ms.due_date);
                    const msSpanLeft = Math.min(startPct, duePct);
                    const msSpanWidth = Math.max(2, Math.abs(duePct - startPct));
                    const respUser = getUserById(db, ms.responsible_user_id);
                    const isMsOverdue = ms.due_date < todayStr && ms.status !== 'Completed';

                    return (
                      <div
                        key={ms.id}
                        className="grid grid-cols-12 items-center bg-slate-50/40 dark:bg-slate-900/40 text-xs border-t border-slate-100 dark:border-slate-800/60"
                      >
                        <div className="col-span-5 lg:col-span-4 py-2.5 pl-8 pr-4 border-r border-slate-200 dark:border-slate-800">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-medium truncate">
                              <Flag
                                className={`w-3 h-3 shrink-0 ${
                                  ms.status === 'Completed'
                                    ? 'text-emerald-600'
                                    : isMsOverdue
                                    ? 'text-red-600'
                                    : 'text-teal-600'
                                }`}
                              />
                              <span className="truncate" title={ms.title}>
                                {ms.title}
                              </span>
                            </div>

                            {onUpdateDb && (
                              <div className="flex items-center gap-1 shrink-0">
                                {[0, 50, 100].map((stepVal) => (
                                  <button
                                    key={stepVal}
                                    type="button"
                                    onClick={() =>
                                      handleInlineMilestoneProgress(project, ms, stepVal)
                                    }
                                    className={`px-1.5 py-0.5 rounded font-mono text-[9.5px] font-bold cursor-pointer transition-colors ${
                                      ms.progress === stepVal
                                        ? 'bg-[#173B75] text-white'
                                        : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-teal-600 hover:text-white'
                                    }`}
                                    title={`Set milestone progress to ${stepVal}%`}
                                  >
                                    {stepVal}%
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                            Due: {ms.due_date} · {respUser?.full_name || 'Assigned'} · {ms.status} (
                            {ms.progress}%)
                          </div>
                        </div>

                        <div className="col-span-7 lg:col-span-8 relative h-11 px-4 flex items-center">
                          {/* Today Line */}
                          <div
                            style={{ left: `${todayPct}%` }}
                            className="absolute top-0 bottom-0 w-0.5 bg-sky-500/50 pointer-events-none"
                          />

                          {/* Milestone Planned Window & Progress Bar */}
                          <div
                            style={{
                              left: `${msSpanLeft}%`,
                              width: `${msSpanWidth}%`,
                            }}
                            className="absolute h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
                          >
                            <div
                              style={{ width: `${ms.progress}%` }}
                              className={`h-full transition-all duration-300 ${
                                ms.status === 'Completed'
                                  ? 'bg-emerald-600'
                                  : isMsOverdue
                                  ? 'bg-red-600'
                                  : 'bg-[#159A9C]'
                              }`}
                            />
                          </div>

                          {/* Milestone Diamond Marker */}
                          <div
                            style={{ left: `${duePct}%` }}
                            className="absolute -translate-x-1/2 flex items-center gap-1.5 z-20"
                            title={`Milestone: ${ms.title} | Deliverable: ${ms.deliverables} | Due: ${ms.due_date} | Progress: ${ms.progress}%`}
                          >
                            <div
                              className={`w-3.5 h-3.5 rotate-45 border border-white dark:border-slate-900 shadow-xs ${
                                ms.status === 'Completed'
                                  ? 'bg-emerald-600'
                                  : isMsOverdue
                                  ? 'bg-red-600'
                                  : 'bg-amber-500'
                              }`}
                            />
                            <span className="font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-300 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 px-1.5 py-0.2 rounded whitespace-nowrap shadow-2xs">
                              {ms.due_date.slice(5)} · {ms.progress}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
};
