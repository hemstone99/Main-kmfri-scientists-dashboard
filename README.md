# KMFRI Scientists & Research Management System

Production-ready institutional web application for the **Kenya Marine and Fisheries Research Institute (KMFRI)** supporting researcher profile management, multi-stage project and output approval workflows, grant expenditure tracking, GIS location mapping, document versioning, and immutable audit logging across KMFRI's four fixed directorates.

## 1. Core Directorates & RBAC Architecture

### Four Fixed Protected Directorates
1. **OCS** — Oceans & Coastal Systems Directorate
2. **FWS** — Freshwater Systems Directorate
3. **ARD** — Aquaculture Research Directorate
4. **SED** — Socioeconomics Directorate

### Five Database-Driven System Roles
- `scientist` — Manages own researcher profile, creates/edits draft projects & outputs, submits for review, logs fieldwork activities, milestones, and reports. Cannot self-approve.
- `head_of_directorate` — Reviews submissions within assigned directorate, approves/rejects/requests changes with mandatory comments, and escalates institutional items to the Director General.
- `directorate_admin` — Supports account provisioning, profile completeness, document management, and deadline tracking within one assigned directorate.
- `director_general` — Executive oversight across all four directorates, cross-directorate performance comparison, and final approval on escalated submissions.
- `system_admin` — Full user/role lifecycle administration, reference data maintenance (with deletion protection on OCS, FWS, ARD, SED), CSV batch imports, and append-only audit log inspection.

## 2. Clean Database & Zero Fabricated Statistics Policy
- On a clean installation, only the **5 roles**, **12 permissions**, and **4 core directorates** are seeded.
- All operational counters (projects, grants, publications, reports, GIS stations) begin at exact database-derived zero (`0`) values with informative empty states.
- The initial System Administrator is provisioned through the secure initial setup screen (or CLI command `php bin/provision-admin.php`).

## 3. Hosting on Render (Frontend & Server) + Supabase (PostgreSQL Database)

This repository is pre-configured for one-click deployment on **Render** (`render.yaml`) backed by **Supabase PostgreSQL** (`supabase/schema.sql`).

### Step 1: Set Up the Database in Supabase
1. Create a new project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Open the **SQL Editor** in Supabase and run the entire migration script located at:
   - `supabase/schema.sql`
   - This provisions the relational tables (`roles`, `directorates`, `users`, `projects`, `project_milestones`, `research_outputs`, `documents`, `audit_logs`), the real-time state table (`kmfri_app_state`), seeds the 5 official KMFRI roles and 4 core protected directorates (`OCS`, `FWS`, `ARD`, `SED`), and configures Row-Level Security (RLS) policies.
3. Navigate to **Project Settings → API** in Supabase and copy:
   - **Project URL** (`VITE_SUPABASE_URL` / `SUPABASE_URL`)
   - **anon public key** (`VITE_SUPABASE_ANON_KEY`)
   - **service_role secret key** (`SUPABASE_SERVICE_ROLE_KEY`)

### Step 2: Deploy to Render
You can deploy either via **Render Blueprint (`render.yaml`)** or as a **Render Web Service / Static Site**:

#### Option A: Full-Stack Render Web Service (Recommended — includes PDFKit exports, SMTP 2FA emails & WebSockets)
1. Push this repository to GitHub/GitLab and click **New + → Blueprint** (or **New + → Web Service**) in the [Render Dashboard](https://dashboard.render.com).
2. Render automatically detects `render.yaml` with:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start`
   - **Health Check Path:** `/api/health`
3. Add the environment variables in Render (**Environment** tab):
   - `VITE_SUPABASE_URL` = `https://<your-project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `<your-supabase-anon-key>`
   - `SUPABASE_SERVICE_ROLE_KEY` = `<your-supabase-service-role-key>`
   - `GEMINI_API_KEY` = `<your-gemini-api-key>`
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = `montanacode953@gmail.com`
   - `SMTP_PASS` = `<your-smtp-app-password>`
   - `SMTP_FROM` = `KMFRI System <montanacode953@gmail.com>`

#### Option B: Render Static Site (Frontend-Only Direct to Supabase)
1. In Render Dashboard, select **New + → Static Site**.
2. Set **Build Command** to `npm install && npm run build` and **Publish Directory** to `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Render Environment tab — the frontend `@supabase/supabase-js` client (`src/services/supabaseClient.ts`) will read and write directly to your Supabase PostgreSQL database.

## 4. Plain PHP 8.2+ & MySQL 8+ Reference Bundle
Complete SQL migrations (`database/migrations/001_create_kmfri_schema.sql` for all 26 InnoDB `utf8mb4` tables), reference seeders (`database/seeds/001_seed_reference_data.sql`), and OOP MVC services (`ApprovalWorkflowService.php`, `CsrfAndAuthMiddleware.php`) are also bundled in `src/services/phpArchitectureBundle.ts`.
