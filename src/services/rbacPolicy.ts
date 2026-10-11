import {
  DatabaseState,
  User,
  RoleName,
  Project,
  ResearchOutput,
  ResearchReport,
} from '../types/kmfri.ts';
import { getRoleById } from './database.ts';

export type NavSectionId =
  | 'dashboard'
  | 'scientists'
  | 'profiles'
  | 'projects'
  | 'activities'
  | 'funding'
  | 'reports'
  | 'outputs'
  | 'sharepoint_hub'
  | 'locations'
  | 'collaborators'
  | 'approvals'
  | 'documents'
  | 'notifications'
  | 'analytics'
  | 'administration'
  | 'audit_logs';

export function getUserRoleName(state: DatabaseState, user: User): RoleName {
  return getRoleById(state, user.role_id)?.name || 'scientist';
}

/**
 * Enforces Section 23: Permission-aware sidebar visibility and server-side route authorization
 */
export function canAccessNavSection(state: DatabaseState, user: User, section: NavSectionId): boolean {
  const role = getUserRoleName(state, user);

  switch (section) {
    case 'dashboard':
    case 'profiles':
    case 'projects':
    case 'activities':
    case 'funding':
    case 'reports':
    case 'outputs':
    case 'sharepoint_hub':
    case 'locations':
    case 'collaborators':
    case 'documents':
    case 'notifications':
    case 'analytics':
      return true;
    case 'scientists':
      return ['head_of_directorate', 'directorate_admin', 'director_general', 'system_admin', 'scientist'].includes(role);
    case 'approvals':
      return ['scientist', 'head_of_directorate', 'director_general', 'directorate_admin', 'system_admin'].includes(role);
    case 'administration':
      return ['system_admin', 'directorate_admin'].includes(role);
    case 'audit_logs':
      return ['system_admin', 'director_general'].includes(role);
    default:
      return false;
  }
}

/**
 * Enforces Section 4 & Section 20: Record-level Directorate and Ownership Policy
 */
export function canViewProject(state: DatabaseState, user: User, project: Project): boolean {
  const role = getUserRoleName(state, user);
  if (role === 'director_general' || role === 'system_admin') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') {
    return project.directorate_id === user.directorate_id;
  }
  // Scientist: can view if PI, team member, or non-draft within their directorate
  const isMember = state.project_members.some(
    (m) => m.project_id === project.id && m.user_id === user.id
  );
  if (project.principal_investigator_id === user.id || project.created_by === user.id || isMember) {
    return true;
  }
  return project.directorate_id === user.directorate_id && project.status !== 'Draft';
}

export function canEditProject(state: DatabaseState, user: User, project: Project): boolean {
  const role = getUserRoleName(state, user);
  if (role === 'system_admin') return true;
  if (role === 'scientist' || role === 'head_of_directorate') {
    const isOwner = project.principal_investigator_id === user.id || project.created_by === user.id;
    const editableStatuses = ['Draft', 'Proposed', 'Changes Requested'];
    return isOwner && editableStatuses.includes(project.status);
  }
  return false;
}

/**
 * Enforces Section 4.A & Section 11:
 * "A user must not approve their own submission."
 * "Only authorized roles can approve or reject submissions."
 */
export function canApproveOrReviewEntity(
  state: DatabaseState,
  user: User,
  entityDirectorateId: string,
  submittedByUserId: string,
  currentStatus: string
): { allowed: boolean; reason?: string } {
  const role = getUserRoleName(state, user);

  if (submittedByUserId === user.id) {
    return {
      allowed: false,
      reason: 'Conflict of interest policy: You cannot approve or review your own submission.',
    };
  }

  if (role === 'head_of_directorate') {
    if (user.directorate_id !== entityDirectorateId) {
      return {
        allowed: false,
        reason: 'Cross-directorate restriction: You can only review submissions belonging to your assigned directorate.',
      };
    }
    if (!['Submitted', 'Under Review'].includes(currentStatus)) {
      return {
        allowed: false,
        reason: `Item in status "${currentStatus}" is not awaiting Head of Directorate review.`,
      };
    }
    return { allowed: true };
  }

  if (role === 'director_general') {
    if (!['Approved by Head of Directorate', 'Under Review', 'Submitted'].includes(currentStatus)) {
      return {
        allowed: false,
        reason: `Item in status "${currentStatus}" is not awaiting Director General decision.`,
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'Role restriction: Only Head of Directorate or Director General may record approval decisions.',
  };
}

export function filterProjectsForUser(state: DatabaseState, user: User): Project[] {
  return state.projects.filter((p) => canViewProject(state, user, p));
}

export function filterOutputsForUser(state: DatabaseState, user: User): ResearchOutput[] {
  const role = getUserRoleName(state, user);
  if (role === 'director_general' || role === 'system_admin') return state.research_outputs;
  if (role === 'head_of_directorate' || role === 'directorate_admin') {
    return state.research_outputs.filter((o) => o.directorate_id === user.directorate_id);
  }
  return state.research_outputs.filter(
    (o) =>
      o.lead_scientist_id === user.id ||
      (o.directorate_id === user.directorate_id && o.status !== 'Draft')
  );
}

export function filterReportsForUser(state: DatabaseState, user: User): ResearchReport[] {
  const role = getUserRoleName(state, user);
  if (role === 'director_general' || role === 'system_admin') return state.reports;
  if (role === 'head_of_directorate' || role === 'directorate_admin') {
    return state.reports.filter((r) => r.directorate_id === user.directorate_id);
  }
  return state.reports.filter((r) => r.scientist_id === user.id);
}
