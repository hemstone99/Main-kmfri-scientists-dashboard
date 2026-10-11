-- =============================================================================
-- KMFRI SCIENTISTS & RESEARCH MANAGEMENT SYSTEM
-- SUPABASE POSTGRESQL SCHEMA, RLS POLICIES & SEED MIGRATION
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Primary Cloud State & Real-Time Synchronization Table
CREATE TABLE IF NOT EXISTS public.kmfri_app_state (
  id TEXT PRIMARY KEY DEFAULT 'kmfri_primary_state',
  state_payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Core Relational Tables for Direct SQL Querying & Reporting in Supabase
CREATE TABLE IF NOT EXISTS public.roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.directorates (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  head_user_id TEXT,
  active_status BOOLEAN DEFAULT TRUE,
  is_core_protected BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  staff_number TEXT UNIQUE NOT NULL,
  position TEXT NOT NULL,
  directorate_id TEXT REFERENCES public.directorates(id) ON DELETE SET NULL,
  research_area_id TEXT,
  role_id TEXT REFERENCES public.roles(id),
  account_status TEXT NOT NULL DEFAULT 'Active',
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id TEXT PRIMARY KEY,
  project_code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  directorate_id TEXT REFERENCES public.directorates(id),
  principal_investigator_id TEXT REFERENCES public.users(id),
  start_date DATE,
  expected_end_date DATE,
  status TEXT NOT NULL DEFAULT 'Draft',
  calculated_progress NUMERIC DEFAULT 0,
  budget NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'KES',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.project_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  deliverables TEXT,
  due_date DATE,
  completion_date DATE,
  progress NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  responsible_user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.research_outputs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  output_type TEXT NOT NULL,
  project_id TEXT,
  directorate_id TEXT,
  lead_scientist_id TEXT,
  journal_or_event TEXT,
  doi TEXT,
  publication_date DATE,
  publication_year INTEGER,
  status TEXT NOT NULL DEFAULT 'Draft',
  abstract TEXT,
  manuscript_body TEXT,
  references_section TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  project_id TEXT,
  directorate_id TEXT,
  uploaded_by TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT DEFAULT 0,
  version INTEGER DEFAULT 1,
  version_label TEXT DEFAULT '1.0',
  library_folder TEXT,
  checked_out_by TEXT,
  checked_out_by_name TEXT,
  word_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Seed the 5 Official KMFRI Roles & 4 Core Protected Directorates
INSERT INTO public.roles (id, name, label, description)
VALUES
  ('role-scientist-001', 'scientist', 'Scientist / Researcher', 'Creates and manages own research projects, milestones, manuscripts, and SharePoint documents.'),
  ('role-hod-002', 'head_of_directorate', 'Head of Directorate', 'Reviews and approves directorate submissions and monitors milestones.'),
  ('role-dir-admin-003', 'directorate_admin', 'Directorate Administrator', 'Operational support and document management within one assigned directorate.'),
  ('role-dg-004', 'director_general', 'Director General', 'Executive institution-wide oversight across all 4 directorates.'),
  ('role-sys-admin-005', 'system_admin', 'System Administrator', 'Manages user accounts, roles, security policies, and immutable audit trail.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.directorates (id, code, name, description, active_status, is_core_protected)
VALUES
  ('dir-ocs-001', 'OCS', 'Oceans & Coastal Systems Directorate', 'Marine ecology, coral reef conservation, stock assessment, physical oceanography, and EEZ research anchored at Mombasa HQ.', TRUE, TRUE),
  ('dir-fws-002', 'FWS', 'Freshwater Systems Directorate', 'Limnology, inland fisheries stock assessments, and catchment ecology across Lake Victoria, Lake Turkana, Lake Naivasha, and Lake Baringo.', TRUE, TRUE),
  ('dir-ard-003', 'ARD', 'Aquaculture Research & Development Directorate', 'Mariculture, freshwater fish farming, selective breeding, fish nutrition, and Sagana / Kegati hatcheries.', TRUE, TRUE),
  ('dir-sed-004', 'SED', 'Socio-Economics & Data Governance Directorate', 'Blue economy valuation, BMU co-management, fisheries value chains, and national oceanographic data custody.', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 4. Enable Row Level Security (RLS) & Policies for Authenticated / Service Access
ALTER TABLE public.kmfri_app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directorates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read/write access to kmfri_app_state" ON public.kmfri_app_state;
CREATE POLICY "Allow read/write access to kmfri_app_state"
  ON public.kmfri_app_state FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access to roles" ON public.roles;
CREATE POLICY "Allow access to roles" ON public.roles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access to directorates" ON public.directorates;
CREATE POLICY "Allow access to directorates" ON public.directorates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access to users" ON public.users;
CREATE POLICY "Allow access to users" ON public.users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access to projects" ON public.projects;
CREATE POLICY "Allow access to projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access to project_milestones" ON public.project_milestones;
CREATE POLICY "Allow access to project_milestones" ON public.project_milestones FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access to research_outputs" ON public.research_outputs;
CREATE POLICY "Allow access to research_outputs" ON public.research_outputs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access to documents" ON public.documents;
CREATE POLICY "Allow access to documents" ON public.documents FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow append to audit_logs" ON public.audit_logs;
CREATE POLICY "Allow append to audit_logs" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);
