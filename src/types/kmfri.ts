/**
 * KMFRI Scientists & Research Management System
 * Comprehensive TypeScript Domain Models & Database Schema Types (26+ Normalized Tables)
 */

export type RoleName =
  | 'scientist'
  | 'head_of_directorate'
  | 'directorate_admin'
  | 'director_general'
  | 'system_admin';

export type DirectorateCode = 'OCS' | 'FWS' | 'ARD' | 'SED';

export type AccountStatus = 'Active' | 'Inactive' | 'Locked' | 'PendingSetup';

export type ProjectStatus =
  | 'Draft'
  | 'Proposed'
  | 'Submitted'
  | 'Under Review'
  | 'Changes Requested'
  | 'Approved by Head of Directorate'
  | 'Approved by Director General'
  | 'Approved'
  | 'In Progress'
  | 'Suspended'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected'
  | 'Archived';

export type ApprovalWorkflowState =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Changes Requested'
  | 'Approved by Head of Directorate'
  | 'Approved by Director General'
  | 'Rejected'
  | 'Archived';

export type OutputType =
  | 'Journal Article'
  | 'Book / Chapter'
  | 'Conference Paper / Presentation'
  | 'Technical & Scientific Report'
  | 'Research Dataset'
  | 'Policy Brief';

export type ReportType =
  | 'Project Progress Report'
  | 'Annual Research Report'
  | 'Technical Report'
  | 'Fieldwork Report'
  | 'Financial Report';

// 1. roles
export interface Role {
  id: string;
  name: RoleName;
  label: string;
  description: string;
  created_at: string;
}

// 2. permissions
export interface Permission {
  id: string;
  name: string;
  description: string;
}

// 3. role_permissions
export interface RolePermission {
  role_id: string;
  permission_id: string;
}

// 4. directorates
export interface Directorate {
  id: string;
  code: DirectorateCode;
  name: string;
  description: string;
  head_user_id: string | null;
  active_status: boolean;
  is_core_protected: boolean;
  created_at: string;
}

// 5. research_areas
export interface ResearchArea {
  id: string;
  name: string;
  description: string;
  directorate_id: string;
  created_at: string;
}

// 6. users
export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  password_hash: string;
  staff_number: string;
  profile_photo: string;
  position: string;
  directorate_id: string | null;
  research_area_id: string | null;
  role_id: string;
  account_status: AccountStatus;
  failed_login_attempts: number;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

// 7. researcher_profiles
export interface ResearcherProfile {
  id: string;
  user_id: string;
  specialization: string;
  academic_rank: string;
  qualifications: string;
  biography: string;
  orcid: string;
  phone: string;
  office_location: string;
  research_interests: string;
  areas_of_expertise: string;
  years_experience: number;
  created_at: string;
  updated_at: string;
}

// 8. projects
export interface Project {
  id: string;
  project_code: string;
  title: string;
  summary: string;
  description: string;
  objectives: string;
  research_area_id: string | null;
  directorate_id: string;
  principal_investigator_id: string;
  start_date: string;
  expected_end_date: string;
  actual_completion_date: string | null;
  status: ProjectStatus;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  budget: number;
  currency: 'KES' | 'USD' | 'EUR' | 'GBP';
  funder_name: string;
  grant_reference: string;
  funding_period: string;
  manual_progress: number;
  calculated_progress: number;
  risks_and_issues: string;
  mitigation_measures: string;
  requires_dg_escalation: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

// 9. project_members
export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  project_role: 'Principal Investigator' | 'Co-Investigator' | 'Research Scientist' | 'Laboratory Analyst' | 'Field Coordinator';
  responsibilities: string;
  start_date: string;
  end_date: string | null;
}

// 10. project_milestones
export interface ProjectMilestone {
  id: string;
  project_id: string;
  title: string;
  description: string;
  deliverables: string;
  responsible_user_id: string;
  due_date: string;
  completion_date: string | null;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Overdue';
  progress: number;
  created_at: string;
}

// 11. funders
export interface Funder {
  id: string;
  name: string;
  funding_type: 'Government of Kenya' | 'Bilateral Donor' | 'Multilateral Agency' | 'International Foundation' | 'Private Partner';
  country: string;
  contact_person: string;
  email: string;
  phone: string;
  website: string;
  created_at: string;
}

// 12. funding
export interface FundingRecord {
  id: string;
  project_id: string;
  funder_id: string;
  principal_investigator_id: string;
  grant_number: string;
  award_reference: string;
  funding_source: string;
  funding_type: string;
  award_amount: number;
  currency: 'KES' | 'USD' | 'EUR' | 'GBP';
  award_date: string;
  funding_start_date: string;
  funding_end_date: string;
  allocated_amount: number;
  spent_amount: number;
  remaining_balance: number;
  status: 'Active' | 'Disbursing' | 'Exhausted' | 'Closed' | 'Pending Audit';
  notes: string;
  created_at: string;
  updated_at: string;
}

// 13. funding_transactions
export interface FundingTransaction {
  id: string;
  funding_id: string;
  transaction_type: 'Allocation' | 'Expenditure' | 'Adjustment';
  amount: number;
  transaction_date: string;
  reference: string;
  description: string;
  recorded_by: string;
  created_at: string;
}

// 14. locations
export interface ResearchLocation {
  id: string;
  name: string;
  country: string;
  county: string;
  sub_county: string;
  site: string;
  latitude: number;
  longitude: number;
  ecosystem_type: 'Marine & Coastal' | 'Freshwater Lake / River' | 'Aquaculture Station' | 'Socioeconomic Community Site';
  marine_area: string;
  description: string;
  environmental_context: string;
  directorate_id: string;
  created_at: string;
}

// 15. project_locations
export interface ProjectLocationLink {
  project_id: string;
  location_id: string;
  activity_description: string;
}

// 16. collaborators
export interface Collaborator {
  id: string;
  organization_name: string;
  contact_person: string;
  email: string;
  phone: string;
  country: string;
  organization_type: 'University / Academic' | 'National Research Institute' | 'International NGO' | 'Government Ministry' | 'Community BMU' | 'Private Sector';
  collaboration_type: 'Joint Research' | 'Capacity Building & Training' | 'Data & Equipment Sharing' | 'Funding & Co-Sponsorship' | 'Policy Advisory';
  directorate_id: string;
  start_date: string;
  end_date: string | null;
  mou_status: 'Active MOU' | 'Drafting' | 'Expired' | 'Completed';
  notes: string;
  created_at: string;
}

// 17. project_collaborators
export interface ProjectCollaboratorLink {
  project_id: string;
  collaborator_id: string;
  role: string;
}

// 18. reports
export interface ResearchReport {
  id: string;
  project_id: string;
  scientist_id: string;
  directorate_id: string;
  title: string;
  report_type: ReportType;
  reporting_period: string;
  submission_date: string | null;
  due_date: string;
  status: ApprovalWorkflowState;
  reviewer_id: string | null;
  review_comments: string;
  approval_date: string | null;
  file_reference: string;
  version: number;
  created_at: string;
  updated_at: string;
}

// 19. research_outputs
export interface ManuscriptFigure {
  id: string;
  label: string;
  caption: string;
  data_url: string;
  mime_type: string;
  uploaded_at: string;
}

export interface GroundedCitation {
  id: string;
  title: string;
  url: string;
  snippet: string;
  added_at: string;
}

export interface ResearchOutput {
  id: string;
  title: string;
  output_type: OutputType;
  project_id: string | null;
  directorate_id: string;
  lead_scientist_id: string;
  journal_or_event: string;
  doi: string;
  url: string;
  publication_date: string;
  abstract: string;
  keywords: string;
  attachment_name: string;
  status: ApprovalWorkflowState;
  requires_dg_escalation: boolean;
  manuscript_body?: string;
  methodology_section?: string;
  results_section?: string;
  discussion_section?: string;
  references_section?: string;
  attached_figures?: ManuscriptFigure[];
  grounded_citations?: GroundedCitation[];
  shared_on_platform?: boolean;
  created_at: string;
  updated_at: string;
}

// 20. output_authors
export interface OutputAuthor {
  id: string;
  output_id: string;
  user_id: string | null;
  external_author_name: string | null;
  affiliation: string;
  author_order: number;
}

// 21. research_activities
export interface ResearchActivity {
  id: string;
  project_id: string;
  scientist_id: string;
  directorate_id: string;
  title: string;
  activity_category: 'Fieldwork' | 'Laboratory Research' | 'Hydrographic Survey' | 'Sample Collection' | 'Data Analysis' | 'Stakeholder Meeting' | 'Training / Workshop' | 'Conference';
  description: string;
  activity_date: string;
  location_id: string | null;
  specimen_reference?: string;
  environmental_observations?: string;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  field_photo_data_url?: string;
  field_photo_name?: string;
  status: 'Planned' | 'In Progress' | 'Completed' | 'Delayed';
  hours: number;
  created_at: string;
}

// 22. approvals
export interface ApprovalRecord {
  id: string;
  entity_type: 'project' | 'output' | 'report';
  entity_id: string;
  entity_title: string;
  directorate_id: string;
  submitted_by: string;
  reviewer_id: string | null;
  reviewer_role: RoleName | null;
  decision: 'Submitted' | 'Approved' | 'Rejected' | 'Changes Requested' | 'Escalated to DG';
  comments: string;
  workflow_stage: string;
  previous_state: string;
  new_state: string;
  decided_at: string;
  created_at: string;
}

// 23. documents
export interface DocumentVersionEntry {
  version: number;
  edited_by_id: string;
  edited_by_name: string;
  edited_at: string;
  comment: string;
  content_snapshot: string;
}

export interface DocumentRecord {
  id: string;
  project_id: string | null;
  directorate_id: string;
  uploader_id: string;
  name: string;
  original_filename: string;
  mime_type: string;
  document_category: 'Project Proposal' | 'MOU / Partnership Agreement' | 'Technical Report' | 'Research Dataset' | 'Publication Manuscript' | 'Approval Letter' | 'Financial Voucher';
  secure_storage_key: string;
  file_size_bytes: number;
  version: number;
  linked_entity_type: 'project' | 'output' | 'report' | 'collaborator' | 'funding' | 'general';
  linked_entity_id: string | null;
  description: string;
  word_content?: string;
  image_data_url?: string;
  checked_out_by_id?: string | null;
  checked_out_by_name?: string | null;
  checked_out_at?: string | null;
  version_history?: DocumentVersionEntry[];
  created_at: string;
}

// 24. notifications
export interface NotificationRecord {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'approval' | 'submission' | 'deadline' | 'funding' | 'assignment' | 'system';
  related_module: string;
  related_entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

// 25. audit_logs
export interface AuditLogRecord {
  id: string;
  user_id: string | null;
  user_email: string;
  user_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: string | null;
  new_values: string | null;
  request_metadata: string;
  created_at: string;
}

// 26. system_settings
export interface SystemSettingRecord {
  id: string;
  setting_key: string;
  setting_label: string;
  json_value: string;
  category: 'Security' | 'Uploads' | 'Workflows' | 'SMTP & Alerts' | 'Institutional';
  updated_at: string;
}

export interface DatabaseState {
  isInitializedAdmin: boolean;
  csrfToken: string;
  roles: Role[];
  permissions: Permission[];
  role_permissions: RolePermission[];
  directorates: Directorate[];
  research_areas: ResearchArea[];
  users: User[];
  researcher_profiles: ResearcherProfile[];
  projects: Project[];
  project_members: ProjectMember[];
  project_milestones: ProjectMilestone[];
  funders: Funder[];
  funding: FundingRecord[];
  funding_transactions: FundingTransaction[];
  locations: ResearchLocation[];
  project_locations: ProjectLocationLink[];
  collaborators: Collaborator[];
  project_collaborators: ProjectCollaboratorLink[];
  reports: ResearchReport[];
  research_outputs: ResearchOutput[];
  output_authors: OutputAuthor[];
  research_activities: ResearchActivity[];
  approvals: ApprovalRecord[];
  documents: DocumentRecord[];
  notifications: NotificationRecord[];
  audit_logs: AuditLogRecord[];
  system_settings: SystemSettingRecord[];
}
