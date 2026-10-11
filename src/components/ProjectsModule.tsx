import React, { useState } from 'react';
import {
  DatabaseState,
  User,
  Project,
  ProjectStatus,
  ProjectMember,
  ProjectMilestone,
} from '../types/kmfri.ts';
import {
  filterProjectsForUser,
  canEditProject,
  canApproveOrReviewEntity,
  canManageProjectMembers,
  getUserRoleName,
} from '../services/rbacPolicy.ts';
import {
  generateUuid,
  getDirectorateById,
  getUserById,
  appendAuditLog,
} from '../services/database.ts';
import { ProjectGanttChart } from './ProjectGanttChart.tsx';
import { exportServerPdf } from '../services/exportService.ts';
import { isEffectivelyOnline } from '../services/offlineSyncService.ts';
import {
  Plus,
  Search,
  Eye,
  Send,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Calendar,
  AlertCircle,
  ShieldAlert,
  ArrowLeft,
  Table2,
  BarChartHorizontal,
  ArrowUpDown,
  FileText,
  Edit3,
  Save,
} from 'lucide-react';

interface ProjectsModuleProps {
  db: DatabaseState;
  currentUser: User;
  onUpdateDb: (next: DatabaseState) => void;
  openCreateModalInitially?: boolean;
  onClearInitialModal?: () => void;
}

type ProjectDetailTab =
  | 'Overview'
  | 'Team'
  | 'Timeline'
  | 'Budget'
  | 'Funding'
  | 'Locations'
  | 'Collaborators'
  | 'Milestones'
  | 'Reports'
  | 'Research Outputs'
  | 'Documents'
  | 'Approvals'
  | 'Activity';

const DETAIL_TABS: ProjectDetailTab[] = [
  'Overview',
  'Team',
  'Timeline',
  'Budget',
  'Funding',
  'Locations',
  'Collaborators',
  'Milestones',
  'Reports',
  'Research Outputs',
  'Documents',
  'Approvals',
  'Activity',
];

const ProgressRing: React.FC<{ percent: number; colorClass?: string }> = ({
  percent,
  colorClass = 'text-teal-600 dark:text-teal-400',
}) => {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center w-11 h-11">
      <svg className="w-11 h-11 -rotate-90" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth="3.5"
          className="text-slate-200 dark:text-slate-800"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className={colorClass}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-bold text-slate-900 dark:text-white">
        {clamped}%
      </span>
    </div>
  );
};

export const ProjectsModule: React.FC<ProjectsModuleProps> = ({
  db,
  currentUser,
  onUpdateDb,
  openCreateModalInitially,
  onClearInitialModal,
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'gantt'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [directorateFilter, setDirectorateFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'date' | 'budget' | 'progress'>('date');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>('Overview');

  const [showCreateModal, setShowCreateModal] = useState(Boolean(openCreateModalInitially));
  const [formError, setFormError] = useState<string | null>(null);

  // Create project form state (clean empty inputs — zero dummy data)
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [objectives, setObjectives] = useState('');
  const [directorateId, setDirectorateId] = useState(
    currentUser.directorate_id || db.directorates[0]?.id || ''
  );
  const [researchAreaId, setResearchAreaId] = useState(db.research_areas[0]?.id || '');
  const [startDate, setStartDate] = useState('');
  const [expectedEndDate, setExpectedEndDate] = useState('');
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('High');
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState<'KES' | 'USD' | 'EUR' | 'GBP'>('KES');
  const [funderName, setFunderName] = useState('');
  const [grantRef, setGrantRef] = useState('');
  const [manualProgress, setManualProgress] = useState('0');
  const [risks, setRisks] = useState('');
  const [mitigation, setMitigation] = useState('');

  // Sub-record creation states in Project Detail
  const [newMemberUserId, setNewMemberUserId] = useState(db.users[0]?.id || '');
  const [newMemberRole, setNewMemberRole] = useState<ProjectMember['project_role']>('Co-Investigator');
  const [newMemberResp, setNewMemberResp] = useState('');

  const [msTitle, setMsTitle] = useState('');
  const [msDueDate, setMsDueDate] = useState('');
  const [msProgress, setMsProgress] = useState('0');
  const [msStatus, setMsStatus] = useState<ProjectMilestone['status']>('Pending');

  // Review comment state
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState<string | null>(null);
  const [pdfFeedback, setPdfFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Edit Core Project Data state (offline & online capable)
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editObjectives, setEditObjectives] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editExpectedEndDate, setEditExpectedEndDate] = useState('');
  const [editPriority, setEditPriority] = useState<Project['priority']>('High');
  const [editBudget, setEditBudget] = useState('0');
  const [editCurrency, setEditCurrency] = useState<Project['currency']>('KES');
  const [editFunderName, setEditFunderName] = useState('');
  const [editGrantRef, setEditGrantRef] = useState('');
  const [editManualProgress, setEditManualProgress] = useState('0');
  const [editRisks, setEditRisks] = useState('');
  const [editMitigation, setEditMitigation] = useState('');

  const openEditProjectEditor = (proj: Project) => {
    setEditTitle(proj.title);
    setEditSummary(proj.summary);
    setEditDescription(proj.description);
    setEditObjectives(proj.objectives);
    setEditStartDate(proj.start_date);
    setEditExpectedEndDate(proj.expected_end_date);
    setEditPriority(proj.priority);
    setEditBudget(String(proj.budget));
    setEditCurrency(proj.currency);
    setEditFunderName(proj.funder_name || '');
    setEditGrantRef(proj.grant_reference || '');
    setEditManualProgress(String(proj.manual_progress || 0));
    setEditRisks(proj.risks_and_issues || '');
    setEditMitigation(proj.mitigation_measures || '');
    setIsEditingProject(true);
  };

  const handleSaveEditedProject = (e: React.FormEvent, proj: Project) => {
    e.preventDefault();
    if (!editTitle.trim() || !editDescription.trim()) {
      setPdfFeedback({
        type: 'err',
        text: 'Project title and detailed scientific description cannot be empty.',
      });
      return;
    }

    const now = new Date().toISOString();
    const numericBudget = Math.max(0, Number(editBudget) || 0);
    const clampedManual = Math.min(100, Math.max(0, Number(editManualProgress) || 0));

    const updatedProject: Project = {
      ...proj,
      title: editTitle.trim(),
      summary: editSummary.trim() || editTitle.trim(),
      description: editDescription.trim(),
      objectives: editObjectives.trim(),
      start_date: editStartDate || proj.start_date,
      expected_end_date: editExpectedEndDate || proj.expected_end_date,
      priority: editPriority,
      budget: numericBudget,
      currency: editCurrency,
      funder_name: editFunderName.trim(),
      grant_reference: editGrantRef.trim(),
      manual_progress: clampedManual,
      risks_and_issues: editRisks.trim(),
      mitigation_measures: editMitigation.trim(),
      requires_dg_escalation: numericBudget >= 10000000,
      updated_by: currentUser.id,
      updated_at: now,
    };

    let nextState: DatabaseState = {
      ...db,
      projects: db.projects.map((p) => (p.id === proj.id ? updatedProject : p)),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'PROJECT_CORE_DATA_EDITED',
      'projects',
      proj.id,
      { title: proj.title, budget: proj.budget, manual_progress: proj.manual_progress },
      {
        title: updatedProject.title,
        budget: updatedProject.budget,
        manual_progress: updatedProject.manual_progress,
        offline_cached: !isEffectivelyOnline(),
      }
    );

    onUpdateDb(nextState);
    setIsEditingProject(false);
    setPdfFeedback({
      type: 'ok',
      text: isEffectivelyOnline()
        ? `Core project data for "${updatedProject.project_code}" updated and synchronized with Supabase.`
        : `Offline Mode: Core project edits for "${updatedProject.project_code}" saved to Service Worker cache and queued for automatic Supabase sync once connectivity returns.`,
    });
  };

  const handleInlineUpdateMilestone = (
    project: Project,
    milestoneId: string,
    updates: Partial<Pick<ProjectMilestone, 'status' | 'progress' | 'due_date'>>
  ) => {
    const updatedMilestones = db.project_milestones.map((m) => {
      if (m.id !== milestoneId) return m;
      const nextStatus = updates.status ?? m.status;
      const nextProg =
        nextStatus === 'Completed'
          ? 100
          : updates.progress !== undefined
          ? Math.min(100, Math.max(0, updates.progress))
          : m.progress;
      return {
        ...m,
        ...updates,
        status: nextStatus,
        progress: nextProg,
        completion_date:
          nextStatus === 'Completed'
            ? m.completion_date || new Date().toISOString().slice(0, 10)
            : null,
      };
    });

    const projectMs = updatedMilestones.filter((m) => m.project_id === project.id);
    const systemCalculatedProgress =
      projectMs.length > 0
        ? Math.round(projectMs.reduce((sum, m) => sum + m.progress, 0) / projectMs.length)
        : project.calculated_progress;

    const updatedProject: Project = {
      ...project,
      calculated_progress: systemCalculatedProgress,
      updated_by: currentUser.id,
      updated_at: new Date().toISOString(),
    };

    let nextState: DatabaseState = {
      ...db,
      project_milestones: updatedMilestones,
      projects: db.projects.map((p) => (p.id === project.id ? updatedProject : p)),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'MILESTONE_UPDATED_AND_PROGRESS_RECALCULATED',
      'project_milestones',
      milestoneId,
      { calculated_progress: project.calculated_progress },
      { calculated_progress: systemCalculatedProgress, offline_cached: !isEffectivelyOnline() }
    );

    onUpdateDb(nextState);
  };

  const handleServerPdfExport = async (
    exportType: 'projects_summary' | 'single_project',
    targetProject?: Project
  ) => {
    const key = targetProject ? targetProject.id : 'summary';
    setPdfExporting(key);
    setPdfFeedback(null);
    try {
      await exportServerPdf({
        type: exportType,
        user: currentUser,
        db,
        targetId: targetProject?.id,
        filterDirectorate: directorateFilter,
        filterStatus: statusFilter,
        filename: targetProject
          ? `KMFRI_Project_Dossier_${targetProject.project_code}.pdf`
          : `KMFRI_Projects_Summary_${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      const next = appendAuditLog(
        db,
        currentUser,
        exportType === 'single_project'
          ? 'SERVER_PDF_EXPORT_PROJECT_DOSSIER'
          : 'SERVER_PDF_EXPORT_PROJECTS_SUMMARY',
        'projects',
        targetProject ? targetProject.id : 'batch-summary',
        null,
        {
          format: 'server-pdfkit',
          project_code: targetProject?.project_code || 'ALL_AUTHORIZED',
        }
      );
      onUpdateDb(next);
      setPdfFeedback({
        type: 'ok',
        text: targetProject
          ? `Server-generated PDF dossier for "${targetProject.project_code}" downloaded.`
          : `Server-generated PDF summary for ${visibleProjects.length} authorized project(s) downloaded.`,
      });
    } catch (err) {
      setPdfFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Server PDF generation failed.',
      });
    } finally {
      setPdfExporting(null);
    }
  };

  React.useEffect(() => {
    if (openCreateModalInitially) {
      setShowCreateModal(true);
      onClearInitialModal?.();
    }
  }, [openCreateModalInitially, onClearInitialModal]);

  const visibleProjects = filterProjectsForUser(db, currentUser)
    .filter((p) => {
      if (directorateFilter !== 'ALL' && p.directorate_id !== directorateFilter) return false;
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.project_code.toLowerCase().includes(q) ||
          p.summary.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'budget') return b.budget - a.budget;
      if (sortBy === 'progress') return b.calculated_progress - a.calculated_progress;
      return b.start_date.localeCompare(a.start_date);
    });

  const totalPages = Math.max(1, Math.ceil(visibleProjects.length / pageSize));
  const paginatedProjects = visibleProjects.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const selectedProject = db.projects.find((p) => p.id === selectedProjectId) || null;

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!title.trim() || !code.trim() || !description.trim()) {
      setFormError('Project code, title, and detailed scientific description are mandatory.');
      return;
    }

    if (db.projects.some((p) => p.project_code.toUpperCase() === code.trim().toUpperCase())) {
      setFormError(`Project code "${code.trim()}" already exists. Enforce unique project codes.`);
      return;
    }

    if (expectedEndDate < startDate) {
      setFormError('Invalid date range: Expected completion date cannot precede project start date.');
      return;
    }

    const numericBudget = Number(budget) || 0;
    if (numericBudget < 0) {
      setFormError('Project budget cannot be negative.');
      return;
    }

    const now = new Date().toISOString();
    const newProject: Project = {
      id: generateUuid(),
      project_code: code.trim().toUpperCase(),
      title: title.trim(),
      summary: summary.trim() || title.trim(),
      description: description.trim(),
      objectives:
        objectives.trim() ||
        '1. Conduct baseline ecological assessment; 2. Publish peer-reviewed dataset.',
      research_area_id: researchAreaId || null,
      directorate_id: directorateId,
      principal_investigator_id: currentUser.id,
      start_date: startDate,
      expected_end_date: expectedEndDate,
      actual_completion_date: null,
      status: 'Draft',
      priority,
      budget: numericBudget,
      currency,
      funder_name: funderName.trim(),
      grant_reference: grantRef.trim(),
      funding_period: `${startDate.slice(0, 4)}–${expectedEndDate.slice(0, 4)}`,
      manual_progress: Math.min(100, Math.max(0, Number(manualProgress) || 0)),
      calculated_progress: 0,
      risks_and_issues: risks.trim(),
      mitigation_measures: mitigation.trim(),
      requires_dg_escalation: numericBudget >= 10000000,
      created_by: currentUser.id,
      updated_by: currentUser.id,
      created_at: now,
      updated_at: now,
    };

    const initialMember: ProjectMember = {
      id: generateUuid(),
      project_id: newProject.id,
      user_id: currentUser.id,
      project_role: 'Principal Investigator',
      responsibilities: 'Overall scientific leadership, protocol compliance, and reporting.',
      start_date: startDate,
      end_date: null,
    };

    const nextFunders = [...db.funders];
    const nextFunding = [...db.funding];

    if (numericBudget > 0) {
      const resolvedFunderName =
        funderName.trim() || 'Government of Kenya / KMFRI Research Fund';
      let funder = nextFunders.find(
        (fn) => fn.name.toLowerCase() === resolvedFunderName.toLowerCase()
      );
      if (!funder) {
        funder = {
          id: generateUuid(),
          name: resolvedFunderName,
          funding_type: 'Government of Kenya',
          contact_person: 'Grant Programme Officer',
          email: 'grants@kmfri.go.ke',
          phone: '',
          country: 'Kenya',
          reference_code: grantRef.trim() || `FND-${newProject.project_code}`,
          created_at: now,
        };
        nextFunders.unshift(funder);
      }

      nextFunding.unshift({
        id: generateUuid(),
        project_id: newProject.id,
        funder_id: funder.id,
        grant_number: grantRef.trim() || `GRT-${newProject.project_code}`,
        award_amount: numericBudget,
        allocated_amount: numericBudget,
        spent_amount: 0,
        remaining_balance: numericBudget,
        currency,
        award_date: startDate,
        funding_start_date: startDate,
        funding_end_date: expectedEndDate,
        reporting_due_date: expectedEndDate,
        status: 'Active',
        notes: `Initial project budget allocation for ${newProject.project_code}`,
        created_at: now,
        updated_at: now,
      });
    }

    let nextState: DatabaseState = {
      ...db,
      projects: [newProject, ...db.projects],
      project_members: [initialMember, ...db.project_members],
      funders: nextFunders,
      funding: nextFunding,
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'PROJECT_CREATED_DRAFT',
      'projects',
      newProject.id,
      null,
      { project_code: newProject.project_code, title: newProject.title, budget: newProject.budget }
    );

    onUpdateDb(nextState);
    setShowCreateModal(false);
    setSelectedProjectId(newProject.id);
    setTitle('');
    setSummary('');
    setDescription('');
    setCode(`KMFRI/PRJ/2026/${String(nextState.projects.length + 1).padStart(3, '0')}`);
  };

  const handleSubmitForReview = (project: Project) => {
    const now = new Date().toISOString();
    const updatedProject: Project = {
      ...project,
      status: 'Submitted',
      updated_by: currentUser.id,
      updated_at: now,
    };

    const approvalEntry = {
      id: generateUuid(),
      entity_type: 'project' as const,
      entity_id: project.id,
      entity_title: project.title,
      directorate_id: project.directorate_id,
      submitted_by: currentUser.id,
      reviewer_id: null,
      reviewer_role: null,
      decision: 'Submitted' as const,
      comments: 'Submitted by Principal Investigator for Head of Directorate review.',
      workflow_stage: 'Directorate Review Queue',
      previous_state: project.status,
      new_state: 'Submitted',
      decided_at: now,
      created_at: now,
    };

    const hodUsers = db.users.filter(
      (u) =>
        u.directorate_id === project.directorate_id &&
        getUserRoleName(db, u) === 'head_of_directorate'
    );
    const newNotifications = hodUsers.map((hod) => ({
      id: generateUuid(),
      user_id: hod.id,
      title: `Project Submitted for Review: ${project.project_code}`,
      message: `${currentUser.full_name} submitted "${project.title}" for Directorate review.`,
      type: 'submission' as const,
      related_module: 'projects',
      related_entity_id: project.id,
      read_at: null,
      created_at: now,
    }));

    let nextState: DatabaseState = {
      ...db,
      projects: db.projects.map((p) => (p.id === project.id ? updatedProject : p)),
      approvals: [approvalEntry, ...db.approvals],
      notifications: [...newNotifications, ...db.notifications],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'PROJECT_SUBMITTED_FOR_REVIEW',
      'projects',
      project.id,
      { status: project.status },
      { status: 'Submitted' }
    );

    onUpdateDb(nextState);
  };

  const handleDecision = (
    project: Project,
    decision: 'Approved' | 'Changes Requested' | 'Rejected' | 'Escalated to DG'
  ) => {
    setReviewError(null);
    const check = canApproveOrReviewEntity(
      db,
      currentUser,
      project.directorate_id,
      project.principal_investigator_id,
      project.status
    );

    if (!check.allowed) {
      setReviewError(check.reason || 'Unauthorized approval action.');
      return;
    }

    if (
      (decision === 'Changes Requested' || decision === 'Rejected') &&
      reviewComment.trim() === ''
    ) {
      setReviewError('Mandatory review comments are required when requesting changes or rejecting.');
      return;
    }

    const roleName = getUserRoleName(db, currentUser);
    const now = new Date().toISOString();
    let newStatus: ProjectStatus = project.status;

    if (decision === 'Approved') {
      newStatus =
        roleName === 'director_general'
          ? 'Approved by Director General'
          : 'Approved by Head of Directorate';
    } else if (decision === 'Escalated to DG') {
      newStatus = 'Approved by Head of Directorate';
    } else if (decision === 'Changes Requested') {
      newStatus = 'Changes Requested';
    } else if (decision === 'Rejected') {
      newStatus = 'Rejected';
    }

    const updatedProject: Project = {
      ...project,
      status: newStatus,
      updated_by: currentUser.id,
      updated_at: now,
    };

    const approvalEntry = {
      id: generateUuid(),
      entity_type: 'project' as const,
      entity_id: project.id,
      entity_title: project.title,
      directorate_id: project.directorate_id,
      submitted_by: project.principal_investigator_id,
      reviewer_id: currentUser.id,
      reviewer_role: roleName,
      decision,
      comments:
        reviewComment.trim() ||
        `${decision} recorded by ${currentUser.full_name} (${roleName}).`,
      workflow_stage:
        roleName === 'director_general' ? 'Institutional DG Review' : 'Directorate Head Review',
      previous_state: project.status,
      new_state: newStatus,
      decided_at: now,
      created_at: now,
    };

    const piNotification = {
      id: generateUuid(),
      user_id: project.principal_investigator_id,
      title: `Project Decision: ${project.project_code} (${newStatus})`,
      message: `${currentUser.full_name} recorded "${decision}" on "${project.title}".`,
      type: 'approval' as const,
      related_module: 'projects',
      related_entity_id: project.id,
      read_at: null,
      created_at: now,
    };

    let nextState: DatabaseState = {
      ...db,
      projects: db.projects.map((p) => (p.id === project.id ? updatedProject : p)),
      approvals: [approvalEntry, ...db.approvals],
      notifications: [piNotification, ...db.notifications],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      `PROJECT_WORKFLOW_${decision.toUpperCase().replace(/\s+/g, '_')}`,
      'projects',
      project.id,
      { status: project.status },
      { status: newStatus, comments: approvalEntry.comments }
    );

    onUpdateDb(nextState);
    setReviewComment('');
  };

  const handleAddMilestone = (e: React.FormEvent, project: Project) => {
    e.preventDefault();
    if (!msTitle.trim()) return;
    const prog = Math.min(100, Math.max(0, Number(msProgress) || 0));
    const newMs: ProjectMilestone = {
      id: generateUuid(),
      project_id: project.id,
      title: msTitle.trim(),
      description: 'Deliverable milestone tracked under project workplan.',
      deliverables: 'Field dataset & technical verification note',
      responsible_user_id: currentUser.id,
      due_date: msDueDate,
      completion_date: msStatus === 'Completed' ? new Date().toISOString().slice(0, 10) : null,
      status: msStatus,
      progress: msStatus === 'Completed' ? 100 : prog,
      created_at: new Date().toISOString(),
    };

    const allProjectMs = [
      ...db.project_milestones.filter((m) => m.project_id === project.id),
      newMs,
    ];
    const systemCalculatedProgress = Math.round(
      allProjectMs.reduce((sum, m) => sum + m.progress, 0) / allProjectMs.length
    );

    const updatedProject: Project = {
      ...project,
      calculated_progress: systemCalculatedProgress,
      updated_at: new Date().toISOString(),
    };

    let nextState: DatabaseState = {
      ...db,
      project_milestones: [...db.project_milestones, newMs],
      projects: db.projects.map((p) => (p.id === project.id ? updatedProject : p)),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'MILESTONE_ADDED_AND_PROGRESS_RECALCULATED',
      'project_milestones',
      newMs.id,
      { calculated_progress: project.calculated_progress },
      { calculated_progress: systemCalculatedProgress, milestone: newMs.title }
    );

    onUpdateDb(nextState);
    setMsTitle('');
  };

  const handleAddTeamMember = (e: React.FormEvent, project: Project) => {
    e.preventDefault();
    const permission = canManageProjectMembers(db, currentUser, project);
    const candidate = db.users.find((user) => user.id === newMemberUserId);
    if (!permission.allowed || !candidate) {
      setFormError(permission.reason || 'Select a valid scientist for this assignment.');
      return;
    }
    if (getUserRoleName(db, candidate) !== 'scientist' || candidate.directorate_id !== project.directorate_id) {
      setFormError('Only an active scientist from this project directorate can be assigned.');
      return;
    }
    if (candidate.account_status !== 'Active') {
      setFormError('Inactive or locked accounts cannot be assigned to a project.');
      return;
    }
    const exists = db.project_members.some(
      (m) => m.project_id === project.id && m.user_id === newMemberUserId
    );
    if (exists) {
      setFormError('This scientist is already assigned to the project.');
      return;
    }

    const member: ProjectMember = {
      id: generateUuid(),
      project_id: project.id,
      user_id: newMemberUserId,
      project_role: newMemberRole,
      responsibilities: newMemberResp.trim(),
      start_date: project.start_date,
      end_date: null,
    };

    const notifyMember = {
      id: generateUuid(),
      user_id: newMemberUserId,
      title: `Assigned to Research Project ${project.project_code}`,
      message: `You have been assigned as ${newMemberRole} on "${project.title}".`,
      type: 'assignment' as const,
      related_module: 'projects',
      related_entity_id: project.id,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    let nextState = {
      ...db,
      project_members: [...db.project_members, member],
      notifications: [notifyMember, ...db.notifications],
    };
    nextState = appendAuditLog(
      nextState,
      currentUser,
      'PROJECT_SCIENTIST_ASSIGNED',
      'project_members',
      member.id,
      null,
      { project_id: project.id, user_id: candidate.id, project_role: member.project_role }
    );
    onUpdateDb(nextState);
    setFormError(null);
    setNewMemberUserId('');
  };

  if (selectedProject) {
    const dir = getDirectorateById(db, selectedProject.directorate_id);
    const pi = getUserById(db, selectedProject.principal_investigator_id);
    const members = db.project_members.filter((m) => m.project_id === selectedProject.id);
    const milestones = db.project_milestones.filter((m) => m.project_id === selectedProject.id);
    const projectFunding = db.funding.filter((f) => f.project_id === selectedProject.id);
    const projectOutputs = db.research_outputs.filter((o) => o.project_id === selectedProject.id);
    const projectReports = db.reports.filter((r) => r.project_id === selectedProject.id);
    const projectDocs = db.documents.filter((d) => d.project_id === selectedProject.id);
    const projectApprovals = db.approvals.filter(
      (a) => a.entity_type === 'project' && a.entity_id === selectedProject.id
    );
    const projectActivities = db.research_activities.filter(
      (a) => a.project_id === selectedProject.id
    );

    const editable = canEditProject(db, currentUser, selectedProject);
    const reviewCheck = canApproveOrReviewEntity(
      db,
      currentUser,
      selectedProject.directorate_id,
      selectedProject.principal_investigator_id,
      selectedProject.status
    );
    const memberManagementCheck = canManageProjectMembers(
      db,
      currentUser,
      selectedProject
    );
    const assignableScientists = db.users.filter(
      (user) =>
        getUserRoleName(db, user) === 'scientist' &&
        user.directorate_id === selectedProject.directorate_id &&
        user.account_status === 'Active' &&
        !members.some((member) => member.user_id === user.id)
    );
    const roleName = getUserRoleName(db, currentUser);
    const visibleDetailTabs = roleName === 'scientist'
      ? DETAIL_TABS.filter((tab) => !['Budget', 'Funding', 'Approvals', 'Documents'].includes(tab))
      : DETAIL_TABS;

    return (
      <div className="space-y-6">
        {/* Back & Project Header */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Projects Registry</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('Overview');
                  openEditProjectEditor(selectedProject);
                }}
                className="px-3.5 py-1.5 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer kmfri-btn-transition"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Core Project Data</span>
              </button>

              {roleName !== 'scientist' && <button
                type="button"
                disabled={pdfExporting === selectedProject.id}
                onClick={() => handleServerPdfExport('single_project', selectedProject)}
                className="px-3.5 py-1.5 bg-[#173B75] hover:bg-[#3155A4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer kmfri-btn-transition"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>
                  {pdfExporting === selectedProject.id
                    ? 'Generating PDF...'
                    : 'Export Project Dossier PDF'}
                </span>
              </button>}

              {editable && (
                <button
                  type="button"
                  onClick={() => handleSubmitForReview(selectedProject)}
                  className="px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer kmfri-btn-transition"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Project for Directorate Review</span>
                </button>
              )}

              {selectedProject.status === 'Approved by Head of Directorate' &&
                selectedProject.principal_investigator_id === currentUser.id && (
                  <button
                    type="button"
                    onClick={() => {
                      const upd = db.projects.map((p) =>
                        p.id === selectedProject.id ? { ...p, status: 'In Progress' as const } : p
                      );
                      onUpdateDb({ ...db, projects: upd });
                    }}
                    className="px-3.5 py-1.5 bg-[#0A2540] text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Mark Project In Progress
                  </button>
                )}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1.5">
                <span className="font-mono font-bold text-teal-700 dark:text-teal-400">
                  {selectedProject.project_code}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {dir?.code} — {dir?.name}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Status:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {selectedProject.status}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>Priority: {selectedProject.priority}</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
                {selectedProject.title}
              </h1>
            </div>

            {/* Dual Progress Rings: Manual PI vs System-Calculated from Milestones */}
            <div className="flex items-center gap-5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 shrink-0">
              <div className="flex items-center gap-2.5">
                <ProgressRing
                  percent={selectedProject.manual_progress}
                  colorClass="text-sky-600 dark:text-sky-400"
                />
                <div>
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 block">
                    Manual PI Progress
                  </span>
                  <span className="text-[10px] text-slate-500">Self-reported</span>
                </div>
              </div>
              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
              <div className="flex items-center gap-2.5">
                <ProgressRing
                  percent={selectedProject.calculated_progress}
                  colorClass="text-teal-600 dark:text-teal-400"
                />
                <div>
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 block">
                    System Calculated
                  </span>
                  <span className="text-[10px] text-slate-500">
                    From {milestones.length} Milestones
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 13 Project Detail Tabs */}
          <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto pb-1">
            {visibleDetailTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === tab
                    ? 'bg-[#0A2540] text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content Panel */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
          {activeTab === 'Overview' && (
            <div className="space-y-6">
              {isEditingProject && (
                <form
                  onSubmit={(e) => handleSaveEditedProject(e, selectedProject)}
                  className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-teal-500/40 space-y-4 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-700">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Edit Core Project Data ({selectedProject.project_code})
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Changes work seamlessly offline via the Service Worker cache and auto-sync to
                        Supabase when online.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingProject(false)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Project Changes</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block font-semibold mb-1">Project Title</label>
                      <input
                        type="text"
                        required
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Priority</label>
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value as Project['priority'])}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Critical">Critical</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Executive Summary</label>
                    <textarea
                      rows={2}
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">
                      Detailed Scientific Description &amp; Methodology
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Specific Objectives</label>
                    <textarea
                      rows={2}
                      value={editObjectives}
                      onChange={(e) => setEditObjectives(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Start Date</label>
                      <input
                        type="date"
                        value={editStartDate}
                        onChange={(e) => setEditStartDate(e.target.value)}
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Expected End Date</label>
                      <input
                        type="date"
                        value={editExpectedEndDate}
                        onChange={(e) => setEditExpectedEndDate(e.target.value)}
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Currency</label>
                      <select
                        value={editCurrency}
                        onChange={(e) => setEditCurrency(e.target.value as Project['currency'])}
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <option value="KES">KES</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Approved Budget</label>
                      <input
                        type="number"
                        min="0"
                        value={editBudget}
                        onChange={(e) => setEditBudget(e.target.value)}
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Manual PI Progress %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={editManualProgress}
                        onChange={(e) => setEditManualProgress(e.target.value)}
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Risks &amp; Operational Issues</label>
                      <input
                        type="text"
                        value={editRisks}
                        onChange={(e) => setEditRisks(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Mitigation Measures</label>
                      <input
                        type="text"
                        value={editMitigation}
                        onChange={(e) => setEditMitigation(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">Executive Summary</h3>
                  <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                    {selectedProject.summary}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">
                    Detailed Scientific Description & Methodology
                  </h3>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                    {selectedProject.description}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">Specific Objectives</h3>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
                    {selectedProject.objectives}
                  </p>
                </div>
                {roleName !== 'scientist' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-1">
                      Risks & Operational Issues
                    </h4>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      {selectedProject.risks_and_issues}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-1">
                      Mitigation Measures
                    </h4>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      {selectedProject.mitigation_measures}
                    </p>
                  </div>
                </div>}
              </div>

              <div className="lg:col-span-4 space-y-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs">
                <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-2">
                  Project Governance Metadata
                </h3>
                <div className="flex justify-between py-1.5 border-b border-slate-200/70 dark:border-slate-700">
                  <span className="text-slate-500">Principal Investigator</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {pi?.full_name || 'Assigned Scientist'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200/70 dark:border-slate-700">
                  <span className="text-slate-500">Directorate</span>
                  <span className="font-mono font-semibold">{dir?.code}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200/70 dark:border-slate-700">
                  <span className="text-slate-500">Start Date</span>
                  <span className="font-mono">{selectedProject.start_date}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200/70 dark:border-slate-700">
                  <span className="text-slate-500">Expected End Date</span>
                  <span className="font-mono">{selectedProject.expected_end_date}</span>
                </div>
                {roleName !== 'scientist' && <>
                <div className="flex justify-between py-1.5 border-b border-slate-200/70 dark:border-slate-700">
                  <span className="text-slate-500">Approved Budget</span>
                  <span className="font-mono font-bold">
                    {selectedProject.currency} {selectedProject.budget.toLocaleString()}
                  </span>
                </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">Grant Reference</span>
                    <span className="font-mono">{selectedProject.grant_reference}</span>
                  </div>
                </>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Timeline' && (
            <div className="space-y-6">
              <ProjectGanttChart
                db={db}
                currentUser={currentUser}
                projects={[selectedProject]}
                milestones={milestones}
                selectedProject={selectedProject}
                onUpdateDb={onUpdateDb}
              />
            </div>
          )}

          {activeTab === 'Team' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Project Investigators & Scientific Team ({members.length})
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2.5 px-3">Scientist Name</th>
                      <th className="py-2.5 px-3">Staff Number</th>
                      <th className="py-2.5 px-3">Project Role</th>
                      <th className="py-2.5 px-3">Responsibilities</th>
                      <th className="py-2.5 px-3">Start Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {members.map((m) => {
                      const u = getUserById(db, m.user_id);
                      return (
                        <tr key={m.id}>
                          <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                            {u?.full_name || m.user_id}
                          </td>
                          <td className="py-2.5 px-3 font-mono">{u?.staff_number || '—'}</td>
                          <td className="py-2.5 px-3">{m.project_role}</td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                            {m.responsibilities}
                          </td>
                          <td className="py-2.5 px-3 font-mono">{m.start_date}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {memberManagementCheck.allowed ? (
                <form
                  onSubmit={(e) => handleAddTeamMember(e, selectedProject)}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
                >
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Assign Researcher
                    </label>
                    <select
                      value={newMemberUserId}
                      onChange={(e) => setNewMemberUserId(e.target.value)}
                      required
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                    >
                      <option value="" disabled>Select a scientist</option>
                      {assignableScientists.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name} ({u.staff_number})
                        </option>
                      ))}
                    </select>
                    {assignableScientists.length === 0 && (
                      <p className="mt-1 text-[11px] text-slate-500">No eligible unassigned scientists in this directorate.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Project Role
                    </label>
                    <select
                      value={newMemberRole}
                      onChange={(e) =>
                        setNewMemberRole(e.target.value as ProjectMember['project_role'])
                      }
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                    >
                      <option value="Co-Investigator">Co-Investigator</option>
                      <option value="Research Scientist">Research Scientist</option>
                      <option value="Laboratory Analyst">Laboratory Analyst</option>
                      <option value="Field Coordinator">Field Coordinator</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Specific Responsibilities
                    </label>
                    <input
                      type="text"
                      value={newMemberResp}
                      onChange={(e) => setNewMemberResp(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={assignableScientists.length === 0}
                    className="py-1.5 px-4 bg-[#0A2540] text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Assign Member
                  </button>
                </form>
              ) : (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>
                    Project team assignment is restricted to the Head of Directorate for this
                    project's directorate. Contact your System Administrator if you believe this
                    is an error.
                  </span>
                </div>
              )}
              {formError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{formError}</p>}
            </div>
          )}

          {activeTab === 'Milestones' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Project Milestones & Deliverables ({milestones.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    System-calculated project progress automatically updates from milestone completion
                    and plots onto the Gantt Timeline tab.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold text-teal-700">
                  Calculated Progress: {selectedProject.calculated_progress}%
                </span>
              </div>

              {milestones.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">
                  No milestones recorded for this project yet. Add a milestone below to compute progress
                  and populate the Gantt chart.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 px-3">Milestone Title</th>
                        <th className="py-2 px-3">Due Date</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3 text-right">Completion %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {milestones.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2.5 px-3 font-semibold">{m.title}</td>
                          <td className="py-2.5 px-3 font-mono">
                            <input
                              type="date"
                              value={m.due_date || ''}
                              onChange={(e) =>
                                handleInlineUpdateMilestone(selectedProject, m.id, {
                                  due_date: e.target.value,
                                })
                              }
                              className="px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={m.status}
                              onChange={(e) =>
                                handleInlineUpdateMilestone(selectedProject, m.id, {
                                  status: e.target.value as ProjectMilestone['status'],
                                })
                              }
                              className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              <option value="Pending">Pending</option>
                              <option value="In Progress">In Progress</option>
                              <option value="Completed">Completed</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={m.progress}
                                onChange={(e) =>
                                  handleInlineUpdateMilestone(selectedProject, m.id, {
                                    progress: Number(e.target.value),
                                  })
                                }
                                className="w-16 px-2 py-1 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              />
                              <span>%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <form
                onSubmit={(e) => handleAddMilestone(e, selectedProject)}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
              >
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold mb-1">Milestone Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Q2 Hydro-Acoustic Transect Survey"
                    value={msTitle}
                    onChange={(e) => setMsTitle(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Due Date</label>
                  <input
                    type="date"
                    value={msDueDate}
                    onChange={(e) => setMsDueDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Status & %</label>
                  <div className="flex gap-1.5">
                    <select
                      value={msStatus}
                      onChange={(e) => setMsStatus(e.target.value as ProjectMilestone['status'])}
                      className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Completed">Completed</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={msProgress}
                      onChange={(e) => setMsProgress(e.target.value)}
                      className="w-16 px-2 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="py-1.5 px-4 bg-teal-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Add Milestone
                </button>
              </form>
            </div>
          )}

          {activeTab === 'Approvals' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Traceable Institutional Approval Workflow & Decision Log
                  </h3>
                  <p className="text-xs text-slate-500">
                    Enforces self-approval prevention, directorate scope, and mandatory comments on
                    rejection or change requests.
                  </p>
                </div>
              </div>

              {reviewError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{reviewError}</span>
                </div>
              )}

              {/* Reviewer Decision Panel */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Reviewer Decision Gate (Current Status: {selectedProject.status})
                  </span>
                  {!reviewCheck.allowed && (
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      {reviewCheck.reason}
                    </span>
                  )}
                </div>

                <textarea
                  rows={2}
                  placeholder="Enter reviewer observations or mandatory modification instructions..."
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-lg border border-slate-300 bg-white dark:bg-slate-900"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!reviewCheck.allowed}
                    onClick={() => handleDecision(selectedProject, 'Approved')}
                    className="px-3.5 py-1.5 bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve Submission</span>
                  </button>
                  <button
                    type="button"
                    disabled={!reviewCheck.allowed}
                    onClick={() => handleDecision(selectedProject, 'Changes Requested')}
                    className="px-3.5 py-1.5 bg-amber-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Request Changes</span>
                  </button>
                  <button
                    type="button"
                    disabled={!reviewCheck.allowed}
                    onClick={() => handleDecision(selectedProject, 'Rejected')}
                    className="px-3.5 py-1.5 bg-red-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>

              {/* Approval History Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 px-3">Timestamp (UTC)</th>
                      <th className="py-2 px-3">Stage</th>
                      <th className="py-2 px-3">Decision</th>
                      <th className="py-2 px-3">State Transition</th>
                      <th className="py-2 px-3">Comments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {projectApprovals.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 px-3 text-slate-500">
                          No approval transitions recorded for this project yet.
                        </td>
                      </tr>
                    ) : (
                      projectApprovals.map((a) => (
                        <tr key={a.id}>
                          <td className="py-2.5 px-3 font-mono">
                            {a.decided_at.slice(0, 19).replace('T', ' ')}
                          </td>
                          <td className="py-2.5 px-3">{a.workflow_stage}</td>
                          <td className="py-2.5 px-3 font-semibold">{a.decision}</td>
                          <td className="py-2.5 px-3 font-mono">
                            {a.previous_state} → {a.new_state}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{a.comments}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {[
            'Budget',
            'Funding',
            'Locations',
            'Collaborators',
            'Reports',
            'Research Outputs',
            'Documents',
            'Activity',
          ].includes(activeTab) && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block mb-1">Timeline Window</span>
                  <span className="font-mono font-bold text-sm">
                    {selectedProject.start_date} → {selectedProject.expected_end_date}
                  </span>
                </div>
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block mb-1">Budget & Funder</span>
                  <span className="font-mono font-bold text-sm">
                    {selectedProject.currency} {selectedProject.budget.toLocaleString()}
                  </span>
                  <span className="block text-slate-500 mt-0.5">{selectedProject.funder_name}</span>
                </div>
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block mb-1">Linked Relational Entities</span>
                  <span>
                    Grants: {projectFunding.length} · Outputs: {projectOutputs.length} · Reports:{' '}
                    {projectReports.length} · Docs: {projectDocs.length} · Activities:{' '}
                    {projectActivities.length}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Institutional Research Projects & Gantt Schedule ({visibleProjects.length})
          </h1>
          <p className="text-xs text-slate-500">
            Manage project proposals, investigators, Gantt milestone schedules, budgets, and multi-stage
            directorate approvals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Segmented View Switcher: Registry Table vs Gantt Schedule */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Registry Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('gantt')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                viewMode === 'gantt'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <BarChartHorizontal className="w-3.5 h-3.5 text-teal-600" />
              <span>Gantt Timeline</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search code or title..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <select
            value={directorateFilter}
            onChange={(e) => {
              setDirectorateFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800"
          >
            <option value="ALL">All Directorates</option>
            {db.directorates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'budget' | 'progress')}
            aria-label="Sort projects"
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800"
          >
            <option value="date">Sort: Start Date</option>
            <option value="budget">Sort: Budget</option>
            <option value="progress">Sort: Progress %</option>
          </select>

          <button
            type="button"
            disabled={pdfExporting === 'summary'}
            onClick={() => handleServerPdfExport('projects_summary')}
            className="px-3.5 py-1.5 bg-[#159A9C] hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer kmfri-btn-transition whitespace-nowrap shrink-0"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>
              {pdfExporting === 'summary' ? 'Generating PDF...' : 'Export Projects Summary PDF'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-3.5 py-1.5 bg-[#0A2540] hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer kmfri-btn-transition whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register Project</span>
          </button>
        </div>
      </div>

      {pdfFeedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            pdfFeedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {pdfFeedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{pdfFeedback.text}</span>
        </div>
      )}

      {viewMode === 'gantt' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
          <ProjectGanttChart
            db={db}
            currentUser={currentUser}
            projects={visibleProjects}
            milestones={db.project_milestones}
            onUpdateDb={onUpdateDb}
            onSelectProject={(id) => {
              setSelectedProjectId(id);
              setActiveTab('Timeline');
            }}
          />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
          {visibleProjects.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                No Research Projects Found (0 Records)
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                No projects match your current filter or the database is newly initialized. Click below to
                create a draft research project and visualize it on the Gantt schedule.
              </p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Research Project</span>
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                      <th className="py-3 px-4">Project Code</th>
                      <th className="py-3 px-4">Title & Principal Investigator</th>
                      <th className="py-3 px-4">Directorate</th>
                      <th className="py-3 px-4">Timeline</th>
                      <th className="py-3 px-4 text-right">Budget</th>
                      <th className="py-3 px-4 text-center">Progress Ring</th>
                      <th className="py-3 px-4">Lifecycle Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {paginatedProjects.map((p) => {
                      const dir = getDirectorateById(db, p.directorate_id);
                      const pi = getUserById(db, p.principal_investigator_id);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono font-bold text-teal-700 dark:text-teal-400 whitespace-nowrap">
                            {p.project_code}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {p.title}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              PI: {pi?.full_name || 'Assigned Researcher'} · Priority: {p.priority}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono">{dir?.code}</td>
                          <td className="py-3 px-4 font-mono whitespace-nowrap">
                            {p.start_date} → {p.expected_end_date}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            {p.currency} {p.budget.toLocaleString()}
                          </td>
                          <td className="py-2 px-4 text-center">
                            <ProgressRing percent={p.calculated_progress} />
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                            {p.status}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={pdfExporting === p.id}
                                onClick={() => handleServerPdfExport('single_project', p)}
                                title="Export single project summary PDF via server"
                                className="px-2 py-1 border border-slate-300 dark:border-slate-700 hover:border-[#173B75] rounded-md text-xs font-semibold inline-flex items-center gap-1 cursor-pointer text-[#173B75] dark:text-sky-300"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>PDF</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedProjectId(p.id);
                                  setActiveTab('Overview');
                                  openEditProjectEditor(p);
                                }}
                                className="px-2.5 py-1 border border-slate-300 dark:border-slate-700 hover:border-teal-600 rounded-md text-xs font-semibold inline-flex items-center gap-1 cursor-pointer text-teal-700 dark:text-teal-400"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedProjectId(p.id);
                                  setActiveTab('Overview');
                                  setIsEditingProject(false);
                                }}
                                className="px-2.5 py-1 border border-slate-300 dark:border-slate-700 hover:border-teal-600 rounded-md text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Open 13 Tabs</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Showing {(currentPage - 1) * pageSize + 1} to{' '}
                  {Math.min(currentPage * pageSize, visibleProjects.length)} of{' '}
                  {visibleProjects.length} projects
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="font-mono px-2">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-xl my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Register New KMFRI Research Project
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateProject} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Unique Project Code</label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Directorate</label>
                  <select
                    value={directorateId}
                    onChange={(e) => setDirectorateId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  >
                    {db.directorates.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Project['priority'])}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Project Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Stock Assessment & Acoustic Mapping of Pelagic Fisheries in Kenya's EEZ"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Detailed Scientific Description</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Methodology, sampling stations, vessel requirements, and analytical protocols..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Expected End Date</label>
                  <input
                    type="date"
                    required
                    value={expectedEndDate}
                    onChange={(e) => setExpectedEndDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Project['currency'])}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300"
                  >
                    <option value="KES">KES</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Total Budget</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#0A2540] text-white rounded-lg font-semibold cursor-pointer"
                >
                  Save Project as Draft
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
