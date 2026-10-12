import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Download,
  FileText,
  FolderKanban,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { DatabaseState, User } from '../types/kmfri.ts';
import {
  filterDocumentsForUser,
  filterProjectsForUser,
  filterReportsForUser,
  NavSectionId,
} from '../services/rbacPolicy.ts';
import { getDirectorateById, getTimeOfDayGreeting } from '../services/database.ts';

interface ScientistDashboardWorkspaceProps {
  db: DatabaseState;
  currentUser: User;
  onNavigate: (section: NavSectionId) => void;
  onQuickCreateProject: () => void;
  onQuickCreateResource: () => void;
  onQuickCreateTask: () => void;
  onOpenDocument: (documentId: string) => void;
}

type ActivityItem = {
  id: string;
  title: string;
  category: string;
  date: string;
  section: NavSectionId;
};

const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (value: string) => {
  if (!value) return 'Date pending';
  return new Intl.DateTimeFormat('en-KE', { day: '2-digit', month: 'short' }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
};
const relativeLabel = (value: string) => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently updated';
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3600000));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
const resourceTitle = (resource: DatabaseState['documents'][number]) =>
  (resource as typeof resource & { title?: string }).title || resource.name || resource.original_filename;
const getFirstName = (fullName: string): string => {
  if (!fullName) return 'Colleague';
  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && /^(dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?|eng\.?)/i.test(parts[0])) {
    return parts[1];
  }
  return parts[0] || 'Colleague';
};

export const ScientistDashboardWorkspace: React.FC<ScientistDashboardWorkspaceProps> = ({
  db,
  currentUser,
  onNavigate,
  onQuickCreateProject,
  onQuickCreateResource,
  onQuickCreateTask,
  onOpenDocument,
}) => {
  const directorate = getDirectorateById(db, currentUser.directorate_id);
  const greeting = useMemo(
    () => getTimeOfDayGreeting(currentUser.last_login),
    [currentUser.last_login]
  );
  const firstName = useMemo(
    () => getFirstName(currentUser.full_name),
    [currentUser.full_name]
  );
  const assignedProjects = filterProjectsForUser(db, currentUser).filter((project) =>
    project.principal_investigator_id === currentUser.id ||
    project.created_by === currentUser.id ||
    db.project_members.some((member) => member.project_id === project.id && member.user_id === currentUser.id)
  );
  const assignedProjectIds = new Set(assignedProjects.map((project) => project.id));
  const assignedActivities = db.research_activities.filter(
    (activity) => activity.scientist_id === currentUser.id && assignedProjectIds.has(activity.project_id)
  );
  const assignedReports = filterReportsForUser(db, currentUser).filter(
    (report) => report.scientist_id === currentUser.id
  );
  const assignedOutputs = db.research_outputs.filter(
    (output) => output.lead_scientist_id === currentUser.id
  );
  const authorizedDocuments = filterDocumentsForUser(db, currentUser);
  const assignedMilestones = db.project_milestones.filter(
    (milestone) => milestone.responsible_user_id === currentUser.id && assignedProjectIds.has(milestone.project_id)
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showResourcePicker, setShowResourcePicker] = useState(false);
  const [pins, setPins] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`kmfri_research_pins_${currentUser.id}`);
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });

  const visibleProjects = assignedProjects.filter((project) => {
    if (statusFilter !== 'ALL' && project.status !== statusFilter) return false;
    if (areaFilter !== 'ALL' && project.research_area_id !== areaFilter) return false;
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      return `${project.title} ${project.project_code} ${project.status}`.toLowerCase().includes(query);
    }
    return true;
  });

  const recentActivity = useMemo<ActivityItem[]>(() => {
    const projectItems: ActivityItem[] = assignedProjects.map((project) => ({
      id: `project-${project.id}`,
      title: project.title,
      category: 'Project update',
      date: project.updated_at || project.created_at,
      section: 'projects',
    }));
    const activityItems: ActivityItem[] = assignedActivities.map((activity) => ({
      id: `activity-${activity.id}`,
      title: activity.title,
      category: activity.activity_category,
      date: activity.created_at,
      section: 'activities',
    }));
    const reportItems: ActivityItem[] = assignedReports.map((report) => ({
      id: `report-${report.id}`,
      title: report.title,
      category: `Report · ${report.status}`,
      date: report.updated_at || report.created_at,
      section: 'reports',
    }));
    const outputItems: ActivityItem[] = assignedOutputs.map((output) => ({
      id: `output-${output.id}`,
      title: output.title,
      category: `Research output · ${output.status}`,
      date: output.updated_at || output.created_at,
      section: 'outputs',
    }));
    const documentItems: ActivityItem[] = authorizedDocuments.map((document) => ({
      id: `document-${document.id}`,
      title: resourceTitle(document),
      category: 'Research resource',
      date: document.created_at,
      section: 'research_data',
    }));
    return [...projectItems, ...activityItems, ...reportItems, ...outputItems, ...documentItems]
      .filter((item) => item.date)
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 5);
  }, [assignedProjects, assignedActivities, assignedReports, assignedOutputs, authorizedDocuments]);

  const upcomingEvents = [
    ...db.project_milestones
      .filter((milestone) => assignedProjectIds.has(milestone.project_id) && milestone.status !== 'Completed' && milestone.due_date >= today())
      .map((milestone) => ({ id: `milestone-${milestone.id}`, title: milestone.title, date: milestone.due_date, kind: 'Project milestone', section: 'projects' as NavSectionId })),
    ...assignedActivities
      .filter((activity) => activity.status !== 'Completed' && activity.activity_date >= today())
      .map((activity) => ({ id: `activity-${activity.id}`, title: activity.title, date: activity.activity_date, kind: activity.activity_category, section: 'activities' as NavSectionId })),
    ...assignedReports
      .filter((report) => !['Approved by Head of Directorate', 'Approved by Director General'].includes(report.status) && report.due_date >= today())
      .map((report) => ({ id: `report-${report.id}`, title: report.title, date: report.due_date, kind: 'Report deadline', section: 'reports' as NavSectionId })),
  ].sort((left, right) => left.date.localeCompare(right.date)).slice(0, 4);

  const completedTasks = assignedMilestones.filter((milestone) => milestone.status === 'Completed').length;
  const activeProjectsCount = assignedProjects.filter((project) => ['In Progress', 'Approved', 'Approved by Director General', 'Approved by Head of Directorate'].includes(project.status)).length;
  const pinnedDocuments = pins
    .map((id) => authorizedDocuments.find((document) => document.id === id))
    .filter((document): document is DatabaseState['documents'][number] => Boolean(document));
  const resourceOptions = authorizedDocuments.filter((document) =>
    !search.trim() || resourceTitle(document).toLowerCase().includes(search.trim().toLowerCase())
  );

  const togglePin = (documentId: string) => {
    const nextPins = pins.includes(documentId)
      ? pins.filter((id) => id !== documentId)
      : [...pins, documentId];
    setPins(nextPins);
    try {
      localStorage.setItem(`kmfri_research_pins_${currentUser.id}`, JSON.stringify(nextPins));
    } catch {
      // Pinning remains available for the current session if storage is full or unavailable.
    }
  };

  return (
    <div className="space-y-5 pb-4">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-teal-800 dark:text-teal-300">KMFRI SCIENTIFIC WORKSPACE · {directorate?.code || 'HQ'}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{greeting}, {firstName}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Welcome back to your {directorate?.name || 'research and professional workspace'}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your workspace" className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm sm:w-56 dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <button type="button" onClick={() => onNavigate('calendar')} title="Open calendar" className="rounded-md border border-slate-200 bg-white p-2 text-slate-600 hover:border-teal-500 hover:text-teal-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><CalendarDays className="h-4 w-4" /></button>
          <div className="relative">
            <button type="button" onClick={() => setShowNewMenu((open) => !open)} className="inline-flex items-center gap-2 rounded-md bg-[#16866B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800"><Plus className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5" /></button>
            {showNewMenu && <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              {[
                { label: 'Research project', section: 'projects' as const, action: onQuickCreateProject },
                { label: 'Fieldwork record', section: 'activities' as const },
                { label: 'Dataset or document', action: onQuickCreateResource },
                { label: 'Report or deliverable', section: 'reports' as const },
                { label: 'Task or deadline', action: onQuickCreateTask },
              ].map((item) => <button key={item.label} type="button" onClick={() => { setShowNewMenu(false); if (item.action) item.action(); else onNavigate(item.section); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"><Plus className="h-3.5 w-3.5 text-teal-700" />{item.label}</button>)}
            </div>}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Active projects', value: activeProjectsCount, detail: `${assignedProjects.length} assigned`, icon: FolderKanban, color: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300', section: 'projects' as const },
          { label: 'Assigned activities', value: assignedActivities.length, detail: `${assignedActivities.filter((activity) => activity.status === 'Planned' || activity.status === 'In Progress').length} active`, icon: Activity, color: 'text-sky-700 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300', section: 'activities' as const },
          { label: 'Datasets & documents', value: authorizedDocuments.length, detail: `${pinnedDocuments.length} pinned`, icon: Database, color: 'text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300', section: 'research_data' as const },
          { label: 'Completed tasks', value: completedTasks, detail: 'Assigned milestones', icon: CheckCircle2, color: 'text-teal-800 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-300', section: 'calendar' as const },
        ].map((metric) => {
          const Icon = metric.icon;
          return <button key={metric.label} type="button" onClick={() => onNavigate(metric.section)} className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition hover:border-teal-500 dark:border-slate-800 dark:bg-slate-900 sm:p-4"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-500 sm:text-sm">{metric.label}</span><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${metric.color}`}><Icon className="h-4 w-4" /></span></div><div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{metric.value}</div><div className="mt-0.5 text-[11px] text-slate-500">{metric.detail}</div></button>;
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
            <div><h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active projects</h2><p className="mt-0.5 text-xs text-slate-500">Your projects and team assignments</p></div>
            <button type="button" onClick={() => onNavigate('projects')} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:text-teal-600 dark:text-teal-300">View all <ArrowRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:flex-row">
            <label className="flex items-center gap-2 text-xs text-slate-500"><SlidersHorizontal className="h-3.5 w-3.5" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="ALL">All statuses</option>{[...new Set(assignedProjects.map((project) => project.status))].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="ALL">All research areas</option>{db.research_areas.filter((area) => area.directorate_id === currentUser.directorate_id).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
          </div>
          {visibleProjects.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{visibleProjects.slice(0, 5).map((project) => {
            const area = db.research_areas.find((item) => item.id === project.research_area_id);
            return <button key={project.id} type="button" onClick={() => onNavigate('projects')} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"><FolderKanban className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2"><span className="truncate text-sm font-medium text-slate-900 dark:text-white">{project.title}</span><span className="text-[10px] text-slate-500">{area?.name || project.project_code}</span></span><span className="mt-2 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-emerald-600" style={{ width: `${Math.max(0, Math.min(100, project.calculated_progress))}%` }} /></span><span className="w-8 text-right font-mono text-[10px] text-slate-500">{project.calculated_progress}%</span></span></span>
              <span className="text-right"><span className={`block text-[10px] font-semibold ${project.status === 'In Progress' ? 'text-emerald-700' : 'text-amber-700'}`}>{project.status}</span><span className="mt-1 block text-[10px] text-slate-400">{relativeLabel(project.updated_at || project.created_at)}</span></span>
            </button>;
          })}</div> : <div className="px-6 py-10 text-center"><FolderKanban className="mx-auto h-7 w-7 text-slate-300" /><h3 className="mt-2 text-sm font-semibold">No projects match these filters</h3><p className="mt-1 text-xs text-slate-500">Try another status or research area, or start a project.</p><button type="button" onClick={onQuickCreateProject} className="mt-3 text-xs font-semibold text-teal-800">Create a project</button></div>}
        </div>

        <div className="xl:col-span-5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 p-4 dark:border-slate-800"><div><h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recent activity</h2><p className="mt-0.5 text-xs text-slate-500">Updates from your authorized workspace</p></div><button type="button" onClick={() => onNavigate('calendar')} className="text-xs font-semibold text-teal-800 dark:text-teal-300">View all</button></div>
          {recentActivity.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{recentActivity.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.section)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Activity className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{item.category} · {relativeLabel(item.date)}</span></span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" /></button>)}</div> : <div className="px-5 py-10 text-center text-xs text-slate-500">Research updates will appear here as work is recorded.</div>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800"><div><h2 className="text-sm font-semibold text-slate-900 dark:text-white">Upcoming events</h2><p className="mt-0.5 text-xs text-slate-500">Milestones, field activities, and report deadlines</p></div><button type="button" onClick={() => onNavigate('calendar')} className="text-xs font-semibold text-teal-800 dark:text-teal-300">View calendar</button></div>
          {upcomingEvents.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{upcomingEvents.map((event) => <button key={event.id} type="button" onClick={() => onNavigate(event.section)} className="grid w-full grid-cols-[46px_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"><span className="rounded-md border border-slate-200 px-1.5 py-1 text-center dark:border-slate-700"><span className="block text-[9px] font-bold uppercase text-teal-800 dark:text-teal-300">{dateLabel(event.date).split(' ')[1]}</span><span className="block font-mono text-base font-bold text-slate-900 dark:text-white">{dateLabel(event.date).split(' ')[0]}</span></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{event.title}</span><span className="mt-0.5 block text-[10px] text-slate-500">{event.kind}</span></span><CalendarDays className="h-4 w-4 text-slate-400" /></button>)}</div> : <div className="px-5 py-10 text-center"><CalendarDays className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-xs text-slate-500">No scheduled fieldwork or deadlines. Upcoming work will appear here.</p></div>}
        </div>

        <div className="xl:col-span-5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800"><div><h2 className="text-sm font-semibold text-slate-900 dark:text-white">Tasks &amp; alerts</h2><p className="mt-0.5 text-xs text-slate-500">Your milestones and notifications</p></div><button type="button" onClick={() => onNavigate('notifications')} className="relative rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Notifications"><Bell className="h-4 w-4" /><span className="sr-only">Notifications</span></button></div>
          <div className="p-4"><div className="flex items-center justify-between text-xs"><span className="font-medium text-slate-600 dark:text-slate-300">Completed assigned milestones</span><span className="font-mono font-bold text-emerald-700">{completedTasks}</span></div><div className="mt-3 space-y-2">{assignedMilestones.filter((item) => item.status !== 'Completed').slice(0, 3).map((task) => <button key={task.id} type="button" onClick={() => onNavigate('projects')} className="flex w-full items-start gap-2 rounded-md bg-slate-50 p-2.5 text-left dark:bg-slate-800/60"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{task.title}</span><span className="mt-0.5 block text-[10px] text-slate-500">Due {task.due_date || 'date pending'}</span></span></button>)}</div><button type="button" onClick={() => onNavigate('calendar')} className="mt-3 text-xs font-semibold text-teal-800 dark:text-teal-300">Open task calendar <ArrowRight className="ml-1 inline h-3 w-3" /></button></div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800"><div><h2 className="text-sm font-semibold text-slate-900 dark:text-white">Pinned research resources</h2><p className="mt-0.5 text-xs text-slate-500">Protocols, datasets, reports, and shared documents in your authorized libraries.</p></div><button type="button" onClick={() => setShowResourcePicker((shown) => !shown)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-teal-500 dark:border-slate-700 dark:text-slate-300"><Pin className="h-3.5 w-3.5" />{showResourcePicker ? 'Done' : 'Manage pins'}</button></div>
        {pinnedDocuments.length ? <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">{pinnedDocuments.slice(0, 8).map((document) => <div key={document.id} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800"><span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><FileText className="h-4 w-4" /></span><button type="button" onClick={() => onOpenDocument(document.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{resourceTitle(document)}</span><span className="block truncate text-[10px] text-slate-500">{document.document_category} · v{document.version}</span></button>{document.image_data_url && <a href={document.image_data_url} download={document.original_filename} title="Download resource" className="rounded p-1.5 text-slate-400 hover:text-teal-800"><Download className="h-3.5 w-3.5" /></a>}<button type="button" onClick={() => togglePin(document.id)} title="Unpin resource" className="rounded p-1 text-teal-700"><Pin className="h-3.5 w-3.5 fill-current" /></button></div>)}</div> : <div className="px-5 py-7 text-center"><BookOpen className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-2 text-xs text-slate-500">No pinned resources yet. Manage pins to add a protocol, dataset, or shared document.</p></div>}
        {showResourcePicker && <div className="border-t border-slate-100 p-3 dark:border-slate-800"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Authorized resources</p><button type="button" onClick={() => setShowResourcePicker(false)} aria-label="Close resource picker" className="rounded p-1 text-slate-400 hover:text-slate-800"><X className="h-4 w-4" /></button></div>{resourceOptions.length ? <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">{resourceOptions.slice(0, 12).map((document) => <div key={document.id} className="flex min-w-0 items-center gap-2 rounded px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"><FileText className="h-4 w-4 shrink-0 text-slate-400" /><button type="button" onClick={() => onOpenDocument(document.id)} className="min-w-0 flex-1 truncate text-left text-xs">{resourceTitle(document)}</button><button type="button" onClick={() => togglePin(document.id)} title={pins.includes(document.id) ? 'Unpin resource' : 'Pin resource'} className="rounded p-1 text-teal-800"><Pin className={`h-3.5 w-3.5 ${pins.includes(document.id) ? 'fill-current' : ''}`} /></button></div>)}</div> : <p className="px-2 py-4 text-center text-xs text-slate-500">No authorized resources available yet.</p>}</div>}
      </section>
    </div>
  );
};