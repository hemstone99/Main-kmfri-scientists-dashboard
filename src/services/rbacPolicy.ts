import {
  DatabaseState,
  User,
  RoleName,
  Project,
  ResearchOutput,
  ResearchReport,
  DocumentRecord,
  ResearchLocation,
  FieldMission,
  EnvironmentalObservation,
  ResearchSpecimen,
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
  | 'field_research'
  | 'advanced_gis'
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
      'research_data', 'field_research', 'advanced_gis', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'notifications',
    ],
    head_of_directorate: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'field_research', 'advanced_gis', 'approvals', 'documents', 'notifications', 'analytics',
    ],
    directorate_admin: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'field_research', 'advanced_gis', 'documents', 'notifications', 'analytics', 'administration',
    ],
    director_general: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'field_research', 'advanced_gis', 'approvals', 'documents', 'notifications', 'analytics', 'audit_logs',
    ],
    system_admin: [
      'dashboard', 'scientists', 'profiles', 'projects', 'activities', 'calendar',
      'training', 'research_data', 'funding', 'reports', 'outputs', 'sharepoint_hub', 'locations', 'collaborators',
      'field_research', 'advanced_gis', 'approvals', 'documents', 'notifications', 'analytics', 'administration',
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
  const scopedLocations = role === 'system_admin' || role === 'director_general'
    ? state.locations
    : state.locations.filter((location) => location.directorate_id === user.directorate_id);
  return scopedLocations.filter((location) =>
    location.approval_status !== 'Pending Approval' ||
    location.submitted_by === user.id ||
    canReviewFieldStation(state, user, location)
  );
}

export function canReviewFieldStation(
  state: DatabaseState,
  user: User,
  station: ResearchLocation
): boolean {
  const role = getUserRoleName(state, user);
  return (role === 'system_admin' || role === 'head_of_directorate') &&
    (role === 'system_admin' || user.directorate_id === station.directorate_id) &&
    station.submitted_by !== user.id && station.approval_status === 'Pending Approval';
}

function isAssignedToProject(state: DatabaseState, user: User, projectId: string): boolean {
  const project = state.projects.find((item) => item.id === projectId);
  return Boolean(project && (
    project.principal_investigator_id === user.id ||
    project.created_by === user.id ||
    state.project_members.some((member) => member.project_id === projectId && member.user_id === user.id)
  ));
}

export function canManageFieldStation(
  state: DatabaseState,
  user: User,
  directorateId: string,
  projectId?: string | null
): boolean {
  const role = getUserRoleName(state, user);
  if (role === 'system_admin' || role === 'director_general') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') {
    return user.directorate_id === directorateId;
  }
  return role === 'scientist' && user.directorate_id === directorateId && Boolean(projectId && isAssignedToProject(state, user, projectId));
}

export function canViewFieldMission(state: DatabaseState, user: User, mission: FieldMission): boolean {
  const role = getUserRoleName(state, user);
  if (role === 'system_admin' || role === 'director_general') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') return user.directorate_id === mission.directorate_id;
  return mission.requested_by === user.id || mission.mission_lead_id === user.id ||
    mission.team_member_ids.includes(user.id) || isAssignedToProject(state, user, mission.project_id);
}

export function canManageFieldMission(state: DatabaseState, user: User, mission: FieldMission): boolean {
  const role = getUserRoleName(state, user);
  if (role === 'system_admin') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') {
    return user.directorate_id === mission.directorate_id;
  }
  return role === 'scientist' && mission.requested_by === user.id && ['Draft', 'Pending Approval', 'Approved', 'In Progress'].includes(mission.status);
}

export function canReviewFieldMission(state: DatabaseState, user: User, mission: FieldMission): boolean {
  const role = getUserRoleName(state, user);
  return (role === 'system_admin' || role === 'head_of_directorate') &&
    (role === 'system_admin' || user.directorate_id === mission.directorate_id) &&
    mission.requested_by !== user.id && mission.status === 'Pending Approval';
}

export function filterFieldMissionsForUser(state: DatabaseState, user: User): FieldMission[] {
  return state.field_missions.filter((mission) => canViewFieldMission(state, user, mission));
}

export function canViewFieldObservation(
  state: DatabaseState,
  user: User,
  observation: EnvironmentalObservation
): boolean {
  const role = getUserRoleName(state, user);
  if (role === 'system_admin' || role === 'director_general') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') return user.directorate_id === observation.directorate_id;
  return observation.observer_id === user.id || isAssignedToProject(state, user, observation.project_id);
}

export function filterFieldObservationsForUser(state: DatabaseState, user: User): EnvironmentalObservation[] {
  return state.field_observations.filter((observation) => canViewFieldObservation(state, user, observation));
}

export function canViewResearchSpecimen(state: DatabaseState, user: User, specimen: ResearchSpecimen): boolean {
  const role = getUserRoleName(state, user);
  if (role === 'system_admin' || role === 'director_general') return true;
  if (role === 'head_of_directorate' || role === 'directorate_admin') return user.directorate_id === specimen.directorate_id;
  return specimen.collected_by === user.id || isAssignedToProject(state, user, specimen.project_id);
}

export function filterResearchSpecimensForUser(state: DatabaseState, user: User): ResearchSpecimen[] {
  return state.research_specimens.filter((specimen) => canViewResearchSpecimen(state, user, specimen));
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
