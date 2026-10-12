import {
  DatabaseState,
  User,
  RoleName,
  Project,
  ResearchOutput,
  ResearchReport,
  DocumentRecord,
  ResearchLocation,
} from '../types/kmfri.ts';
import { getRoleById } from './database.ts';

export type NavSectionId =
  | 'dashboard'
  | 'scientists'
  | 'profiles'
  | 'projects'
  | 'activities'
  | 'calendar'
  | 'training'
  | 'research_data'
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
  const accessByRole: Record<RoleName, NavSectionId[]> = {
    scientist: [
      'dashboard', 'profiles', 'projects', 'activities', 'calendar', 'training',
      'research_data', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'notifications',
    ],
    head_of_directorate: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'approvals', 'documents', 'notifications', 'analytics',
    ],
    directorate_admin: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'documents', 'notifications', 'analytics', 'administration',
    ],
    director_general: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'approvals', 'documents', 'notifications', 'analytics', 'audit_logs',
    ],
    system_admin: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'approvals', 'documents', 'notifications', 'analytics', 'administration',
      'audit_logs',
    ],
  };

  return accessByRole[role].includes(section);
}

/**
 * Enforces read-only GIS access for scientists. Scientists may view the
 * national stations map and browse locations, but only the Head of
 * Directorate (for their own directorate), Directorate Admin, DG, and
 * System Administrator may add, edit, or delete georeferenced sites.
 */
export function canManageLocations(state: DatabaseState, user: User): boolean {
  const role = getUserRoleName(state, user);
  return ['head_of_directorate', 'directorate_admin', 'director_general', 'system_admin'].includes(role);
}

export function filterLocationsForUser(state: DatabaseState, user: User): ResearchLocation[] {
  const role = getUserRoleName(state, user);
  if (role === 'system_admin' || role === 'director_general') return state.locations;
  return state.locations.filter((location) => location.directorate_id === user.directorate_id);
}

export function canViewResearcherProfile(
  state: DatabaseState,
  viewer: User,
  subject: User
): boolean {
  if (viewer.id === subject.id) return true;

  const role = getUserRoleName(state, viewer);
  if (role === 'system_admin' || role === 'director_general') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') {
    return Boolean(viewer.directorate_id) && viewer.directorate_id === subject.directorate_id;
  }
  return false;
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
 * Enforces Section 4.B: Project Team Assignment Authority.
 * Only the Head of Directorate (for their own directorate) may add scientists
 * to a project. The project must also be in an editable lifecycle state so
 * assignments cannot be made against a locked/approved record.
 */
export function canManageProjectMembers(
  state: DatabaseState,
  user: User,
  project: Project
): { allowed: boolean; reason?: string } {
  const role = getUserRoleName(state, user);

  if (role === 'system_admin' || role === 'director_general') {
    return { allowed: true };
  }

  if (role === 'head_of_directorate') {
    if (user.directorate_id !== project.directorate_id) {
      return {
        allowed: false,
        reason: 'Cross-directorate restriction: You can only manage team assignments for projects in your own directorate.',
      };
    }
    const editableStatuses = ['Draft', 'Proposed', 'Changes Requested'];
    if (!editableStatuses.includes(project.status)) {
      return {
        allowed: false,
        reason: `Project is in lifecycle status "${project.status}" and team assignments are locked.`,
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'Role restriction: Only the Head of Directorate may add scientists to project teams.',
  };
}

/** Enforces Section 4 & Section 20: Record-level Directorate and Ownership Policy. */
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

export function canViewDocument(
  state: DatabaseState,
  user: User,
  document: DocumentRecord
): boolean {
  const legacyDocument = document as DocumentRecord & {
    uploaded_by?: string;
    category?: string;
  };
  const role = getUserRoleName(state, user);
  if (role === 'system_admin' || role === 'director_general') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') {
    return document.directorate_id === user.directorate_id;
  }

  const category = document.document_category || legacyDocument.category;
  if (category === 'Financial Voucher' || category === 'Approval Letter') {
    return false;
  }
  if ((document.uploader_id || legacyDocument.uploaded_by) === user.id) return true;

  if (document.project_id || (document.linked_entity_type === 'project' && document.linked_entity_id)) {
    const projectId = document.project_id || document.linked_entity_id;
    const project = state.projects.find((item) => item.id === projectId);
    return Boolean(
      project &&
      (project.principal_investigator_id === user.id ||
        project.created_by === user.id ||
        state.project_members.some((member) => member.project_id === project.id && member.user_id === user.id))
    );
  }
  if (document.linked_entity_type === 'output' && document.linked_entity_id) {
    return state.research_outputs.some(
      (output) => output.id === document.linked_entity_id && output.lead_scientist_id === user.id
    );
  }
  if (document.linked_entity_type === 'report' && document.linked_entity_id) {
    return state.reports.some(
      (report) => report.id === document.linked_entity_id && report.scientist_id === user.id
    );
  }
  return false;
}

export function filterDocumentsForUser(state: DatabaseState, user: User): DocumentRecord[] {
  return state.documents.filter((document) => canViewDocument(state, user, document));
}
