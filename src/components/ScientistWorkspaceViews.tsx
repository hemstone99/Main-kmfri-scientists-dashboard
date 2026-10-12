import React, { useMemo, useState } from 'react';
import { DatabaseState, User } from '../types/kmfri.ts';
import { appendAuditLog } from '../services/database.ts';
import {
  filterProjectsForUser,
  filterReportsForUser,
  getUserRoleName,
  NavSectionId,
} from '../services/rbacPolicy.ts';
import { Bell, CalendarDays, Check, Clock3, GraduationCap, Search } from 'lucide-react';

interface WorkspaceViewProps {
  db: DatabaseState;
  currentUser: User;
  onUpdateDb: (next: DatabaseState) => void;
  onNavigate: (section: NavSectionId) => void;
}

type AgendaItem = {
  id: string;
  title: string;
  kind: 'Milestone' | 'Report' | 'Fieldwork' | 'Training';
  date: string;
  status: string;
  projectTitle: string;
  section: NavSectionId;
  completed: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

export const CalendarTasksView: React.FC<WorkspaceViewProps> = ({
  db,
  currentUser,
  onUpdateDb,
  onNavigate,
}) => {
  const [range, setRange] = useState<'upcoming' | 'overdue' | 'all'>('upcoming');
  const [search, setSearch] = useState('');
  const roleName = getUserRoleName(db, currentUser);
  const accessibleProjects = filterProjectsForUser(db, currentUser).filter((project) =>
    roleName !== 'scientist' ||
    project.principal_investigator_id === currentUser.id ||
    project.created_by === currentUser.id ||
    db.project_members.some((member) => member.project_id === project.id && member.user_id === currentUser.id)
  );
  const projectIds = new Set(accessibleProjects.map((project) => project.id));
  const projectTitle = new Map(accessibleProjects.map((project) => [project.id, project.title]));

  const agenda = useMemo<AgendaItem[]>(() => {
    const milestones: AgendaItem[] = db.project_milestones
      .filter((item) => projectIds.has(item.project_id))
      .map((item) => ({
        id: `milestone-${item.id}`,
        title: item.title,
        kind: 'Milestone',
        date: item.due_date,
        status: item.status,
        projectTitle: projectTitle.get(item.project_id) || 'Research project',
        section: 'projects',
        completed: item.status === 'Completed',
      }));
    const reports: AgendaItem[] = filterReportsForUser(db, currentUser).map((report) => ({
      id: `report-${report.id}`,
      title: report.title,
      kind: 'Report',
      date: report.due_date,
      status: report.status,
      projectTitle: projectTitle.get(report.project_id) || 'Research project',
      section: 'reports',
      completed: ['Approved by Head of Directorate', 'Approved by Director General'].includes(report.status),
    }));
    const activities: AgendaItem[] = db.research_activities
      .filter((activity) => projectIds.has(activity.project_id))
      .filter((activity) => roleName !== 'scientist' || activity.scientist_id === currentUser.id)
      .filter((activity) => activity.status !== 'Completed')
      .map((activity) => ({
        id: `activity-${activity.id}`,
        title: activity.title,
        kind: activity.activity_category === 'Training / Workshop' || activity.activity_category === 'Conference'
          ? 'Training'
          : 'Fieldwork',
        date: activity.activity_date,
        status: activity.status,
        projectTitle: projectTitle.get(activity.project_id) || 'Research project',
        section: activity.activity_category === 'Training / Workshop' || activity.activity_category === 'Conference'
          ? 'training'
          : 'activities',
        completed: false,
      }));
    return [...milestones, ...reports, ...activities].sort((left, right) => left.date.localeCompare(right.date));
  }, [db.projects, db.project_members, db.project_milestones, db.research_activities, db.reports, currentUser, roleName]);

  const filteredAgenda = agenda.filter((item) => {
    const overdue = item.date < today() && !item.completed;
    if (range === 'upcoming' && (item.date < today() || item.completed)) return false;
    if (range === 'overdue' && !overdue) return false;
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      return `${item.title} ${item.projectTitle} ${item.kind} ${item.status}`.toLowerCase().includes(query);
    }
    return true;
  });
  const unreadNotifications = db.notifications.filter(
    (notification) => notification.user_id === currentUser.id && !notification.read_at
  );

  const markNotificationRead = (notificationId: string) => {
    const notification = db.notifications.find((item) => item.id === notificationId);
    if (!notification || notification.user_id !== currentUser.id || notification.read_at) return;
    let nextState: DatabaseState = {
      ...db,
      notifications: db.notifications.map((item) =>
        item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
      ),
    };
    nextState = appendAuditLog(nextState, currentUser, 'NOTIFICATION_MARKED_READ', 'notifications', notification.id, null, { read_at: new Date().toISOString() });
    onUpdateDb(nextState);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <p className="text-xs font-mono uppercase text-teal-700 dark:text-teal-400">Research workspace</p>
          <h1 className="mt-1 text-2xl font-bold">Calendar &amp; Tasks</h1>
          <p className="mt-1 text-sm text-slate-500">Milestones, report deadlines, and planned research activities in your authorized scope.</p>
        </div>
        <button type="button" onClick={() => onNavigate('activities')} className="rounded-md bg-[#123B4A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">Plan an activity</button>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">Upcoming work</div><div className="mt-2 text-2xl font-bold font-mono">{agenda.filter((item) => item.date >= today() && !item.completed).length}</div></div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">Past due</div><div className="mt-2 text-2xl font-bold font-mono text-rose-700">{agenda.filter((item) => item.date < today() && !item.completed).length}</div></div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">Unread alerts</div><div className="mt-2 text-2xl font-bold font-mono">{unreadNotifications.length}</div></div>
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-teal-700" /><h2 className="font-semibold">Research agenda</h2></div>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks and projects" className="w-full sm:w-64 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent py-2 pl-9 pr-3 text-sm" /></label>
            <div className="flex rounded-md border border-slate-300 dark:border-slate-700 p-1">
              {(['upcoming', 'overdue', 'all'] as const).map((option) => <button key={option} type="button" onClick={() => setRange(option)} className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${range === option ? 'bg-[#123B4A] text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{option}</button>)}
            </div>
          </div>
        </div>
        {filteredAgenda.length ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredAgenda.map((item) => (
              <button key={item.id} type="button" onClick={() => onNavigate(item.section)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Clock3 className={`h-4 w-4 ${item.date < today() ? 'text-rose-600' : 'text-teal-700'}`} />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{item.kind} · {item.projectTitle} · {item.status}</span></span>
                <time className="font-mono text-xs text-slate-500">{item.date || 'Date pending'}</time>
              </button>
            ))}
          </div>
        ) : <div className="px-6 py-12 text-center"><CalendarDays className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-3 text-sm font-semibold">No matching agenda items</h3><p className="mt-1 text-xs text-slate-500">Project milestones, reports, and planned activities will appear here.</p></div>}
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 p-4"><Bell className="h-4 w-4 text-teal-700" /><h2 className="font-semibold">Notifications &amp; review updates</h2></div>
        {unreadNotifications.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{unreadNotifications.slice(0, 6).map((notification) => <div key={notification.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{notification.title}</div><p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{notification.message}</p></div><button type="button" onClick={() => markNotificationRead(notification.id)} title="Mark as read" className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 p-2 text-slate-500 hover:text-teal-700"><Check className="h-4 w-4" /></button></div>)}</div> : <p className="px-4 py-8 text-center text-sm text-slate-500">You are up to date.</p>}
      </section>
    </div>
  );
};

export const TrainingDevelopmentView: React.FC<WorkspaceViewProps> = ({
  db,
  currentUser,
  onNavigate,
}) => {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('ALL');
  const roleName = getUserRoleName(db, currentUser);
  const projects = filterProjectsForUser(db, currentUser);
  const projectIds = new Set(projects.map((project) => project.id));
  const records = db.research_activities
    .filter((activity) => ['Training / Workshop', 'Conference'].includes(activity.activity_category))
    .filter((activity) => projectIds.has(activity.project_id))
    .filter((activity) => roleName !== 'scientist' || activity.scientist_id === currentUser.id)
    .filter((activity) => year === 'ALL' || activity.activity_date.startsWith(year))
    .filter((activity) => !search.trim() || `${activity.title} ${activity.description}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((left, right) => right.activity_date.localeCompare(left.activity_date));
  const trainingHours = records.reduce((total, item) => total + item.hours, 0);
  const years = [...new Set(db.research_activities.map((activity) => activity.activity_date.slice(0, 4)).filter(Boolean))].sort().reverse();

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div><p className="text-xs font-mono uppercase text-teal-700 dark:text-teal-400">Research workspace</p><h1 className="mt-1 text-2xl font-bold">Training &amp; Professional Development</h1><p className="mt-1 text-sm text-slate-500">Workshops, conferences, and learning activity recorded in your research portfolio.</p></div>
        <button type="button" onClick={() => onNavigate('activities')} className="rounded-md bg-[#123B4A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">Record training activity</button>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">Recorded events</div><div className="mt-2 text-2xl font-bold font-mono">{records.length}</div></div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">Learning hours</div><div className="mt-2 text-2xl font-bold font-mono">{trainingHours}</div></div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">In progress</div><div className="mt-2 text-2xl font-bold font-mono">{records.filter((record) => record.status === 'In Progress' || record.status === 'Planned').length}</div></div>
      </div>
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 p-4"><div className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-teal-700" /><h2 className="font-semibold">Development record</h2></div><div className="flex gap-2"><label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter events" className="w-full sm:w-56 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent py-2 pl-9 pr-3 text-sm" /></label><select value={year} onChange={(event) => setYear(event.target.value)} className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"><option value="ALL">All years</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div>
        {records.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{records.map((record) => <article key={record.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-4"><div><h3 className="text-sm font-semibold">{record.title}</h3><p className="mt-1 text-xs text-slate-500">{record.activity_category} · {record.description}</p></div><div className="flex shrink-0 items-center gap-4 text-xs text-slate-500"><span>{record.hours} hours</span><span>{record.status}</span><time className="font-mono">{record.activity_date}</time></div></article>)}</div> : <div className="px-6 py-12 text-center"><GraduationCap className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-3 text-sm font-semibold">No development records yet</h3><p className="mt-1 text-xs text-slate-500">Record a workshop or conference from Research Activities to build your professional development history.</p></div>}
      </section>
    </div>
  );
};