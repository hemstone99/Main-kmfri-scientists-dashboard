import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DatabaseState } from '../types/kmfri.ts';

const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
const supabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || '';

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export function isSupabaseClientConfigured(): boolean {
  return Boolean(supabase);
}

const PRIMARY_STATE_ROW_ID = 'kmfri_primary_state';

/**
 * Fetches the authoritative KMFRI DatabaseState from Supabase (either directly via
 * VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or via the Express backend /api/db/state proxy).
 */
export async function fetchDatabaseFromSupabase(): Promise<DatabaseState | null> {
  // 1. Direct Supabase client query if VITE_SUPABASE_URL is configured on the frontend
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('kmfri_app_state')
        .select('state_payload')
        .eq('id', PRIMARY_STATE_ROW_ID)
        .maybeSingle();

      if (!error && data && data.state_payload) {
        return data.state_payload as DatabaseState;
      }
    } catch (err) {
      console.warn('Supabase direct fetch fallback:', err);
    }
  }

  // 2. Fallback to backend /api/db/state proxy (when SUPABASE_URL is set on Render backend)
  try {
    const resp = await fetch('/api/db/state', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json && json.state) {
        return json.state as DatabaseState;
      }
    }
  } catch {
    // Offline or local preview without Supabase env vars configured
  }

  return null;
}

/**
 * Persists the KMFRI DatabaseState to Supabase (`kmfri_app_state` + relational tables
 * `users`, `projects`, `project_milestones`, `research_outputs`, `documents`, `audit_logs`).
 * Returns true if network sync succeeded, or false if offline/unreachable.
 */
export async function syncDatabaseToSupabase(state: DatabaseState): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }

  const now = new Date().toISOString();

  if (supabase) {
    try {
      // 1. Upsert full state snapshot for instant hydration
      const { error: snapErr } = await supabase.from('kmfri_app_state').upsert(
        {
          id: PRIMARY_STATE_ROW_ID,
          state_payload: state,
          updated_at: now,
        },
        { onConflict: 'id' }
      );
      if (snapErr) throw snapErr;

      // 2. Mirror core relational tables in Supabase PostgreSQL
      if (state.users.length > 0) {
        await supabase.from('users').upsert(
          state.users.map((u) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            phone: u.phone || '',
            password_hash: u.password_hash,
            staff_number: u.staff_number,
            position: u.position,
            directorate_id: u.directorate_id,
            research_area_id: u.research_area_id,
            role_id: u.role_id,
            account_status: u.account_status,
            failed_login_attempts: u.failed_login_attempts,
            last_login: u.last_login,
            created_at: u.created_at,
            updated_at: u.updated_at,
          })),
          { onConflict: 'id' }
        );
      }

      if (state.projects.length > 0) {
        await supabase.from('projects').upsert(
          state.projects.map((p) => ({
            id: p.id,
            project_code: p.project_code,
            title: p.title,
            summary: p.summary,
            directorate_id: p.directorate_id,
            principal_investigator_id: p.principal_investigator_id,
            start_date: p.start_date,
            expected_end_date: p.expected_end_date,
            status: p.status,
            calculated_progress: p.calculated_progress,
            budget: p.budget,
            currency: p.currency,
            created_at: p.created_at,
            updated_at: p.updated_at,
          })),
          { onConflict: 'id' }
        );
      }

      if (state.project_milestones.length > 0) {
        await supabase.from('project_milestones').upsert(
          state.project_milestones.map((m) => ({
            id: m.id,
            project_id: m.project_id,
            title: m.title,
            deliverables: m.deliverables,
            due_date: m.due_date || null,
            completion_date: m.completion_date || null,
            progress: m.progress,
            status: m.status,
            responsible_user_id: m.responsible_user_id,
            created_at: m.created_at,
          })),
          { onConflict: 'id' }
        );
      }

      if (state.research_outputs.length > 0) {
        await supabase.from('research_outputs').upsert(
          state.research_outputs.map((o) => ({
            id: o.id,
            title: o.title,
            output_type: o.output_type,
            project_id: o.project_id,
            directorate_id: o.directorate_id,
            lead_scientist_id: o.lead_scientist_id,
            journal_or_event: o.journal_or_event,
            doi: o.doi,
            publication_date: o.publication_date,
            publication_year: o.publication_year,
            status: o.status,
            abstract: o.abstract,
            manuscript_body: o.manuscript_body || null,
            references_section: o.references_section || null,
            created_at: o.created_at,
            updated_at: o.updated_at,
          })),
          { onConflict: 'id' }
        );
      }

      if (state.documents.length > 0) {
        await supabase.from('documents').upsert(
          state.documents.map((d) => ({
            id: d.id,
            title: d.title,
            category: d.category,
            project_id: d.project_id,
            directorate_id: d.directorate_id,
            uploaded_by: d.uploaded_by,
            file_name: d.file_name,
            mime_type: d.mime_type,
            file_size_bytes: d.file_size_bytes,
            version: d.version,
            version_label: d.version_label || `${d.version}.0`,
            library_folder: d.library_folder || null,
            checked_out_by: d.checked_out_by || null,
            checked_out_by_name: d.checked_out_by_name || null,
            word_content: d.word_content || null,
            created_at: d.created_at,
          })),
          { onConflict: 'id' }
        );
      }
      return true;
    } catch (err) {
      console.warn('Direct Supabase sync failed, trying backend proxy:', err);
    }
  }

  // Fallback to backend /api/db/state proxy
  try {
    const resp = await fetch('/api/db/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    return resp.ok;
  } catch {
    // Offline or network unreachable — caller will queue for auto-sync
    return false;
  }
}
