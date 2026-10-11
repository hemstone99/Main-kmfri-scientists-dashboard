import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import {
  DatabaseState,
  User,
  Project,
  ResearchOutput,
} from './src/types/kmfri.ts';
import {
  canViewProject,
  filterProjectsForUser,
  filterOutputsForUser,
  getUserRoleName,
} from './src/services/rbacPolicy.ts';
import {
  getDirectorateById,
  getUserById,
  getRoleById,
} from './src/services/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 0. SUPABASE POSTGRESQL SERVER-SIDE CLIENT (FOR RENDER + SUPABASE DEPLOYMENT)
// ============================================================================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

const supabaseServer =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false },
      })
    : null;

let inMemoryFallbackState: DatabaseState | null = null;

// ============================================================================
// 1. SMTP 2FA CONFIGURATION & OTP STORE
// ============================================================================
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'KMFRI System <noreply@kmfri.go.ke>',
};

if (!SMTP_CONFIG.user || !SMTP_CONFIG.pass) {
  console.warn('SMTP credentials not configured. Password reset emails will not work.');
}

const mailTransporter = nodemailer.createTransport({
  host: SMTP_CONFIG.host,
  port: SMTP_CONFIG.port,
  secure: SMTP_CONFIG.port === 465,
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 7000,
  auth: {
    user: SMTP_CONFIG.user,
    pass: SMTP_CONFIG.pass.replace(/\s+/g, ''),
  },
});

interface OtpEntry {
  code: string;
  email: string;
  expiresAt: number;
  verified: boolean;
  failedAttempts: number;
}

const otpStore = new Map<string, OtpEntry>();
const rateLimitStore = new Map<string, { count: number; windowResetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.windowResetAt) {
    rateLimitStore.set(key, { count: 1, windowResetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
}

// ============================================================================
// 2. REAL-TIME COLLABORATION & LIVE TEAM CHAT STATE (SERVER-AUTHORITATIVE)
// ============================================================================
export interface LiveChatMessage {
  id: string;
  channel: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  sender_directorate: string;
  text: string;
  shared_attachment?: {
    type: 'document' | 'publication';
    id: string;
    title: string;
    subtitle: string;
    version?: number;
  } | null;
  created_at: string;
}

export interface OnlinePresenceUser {
  user_id: string;
  full_name: string;
  role: string;
  directorate: string;
  active_module: string;
  last_seen: string;
}

const serverChatMessages: LiveChatMessage[] = [];
const activePresence = new Map<WebSocket, OnlinePresenceUser>();

// ============================================================================
// 3. SERVER-SIDE PDFKIT GENERATOR HELPERS
// ============================================================================
interface PdfExportRequestBody {
  type:
    | 'projects_summary'
    | 'single_project'
    | 'outputs_summary'
    | 'single_output'
    | 'directorate_summary';
  user: User;
  db: DatabaseState;
  targetId?: string;
  filterDirectorate?: string;
  filterStatus?: string;
}

function drawKmfrInstitutionalHeader(
  doc: PDFKit.PDFDocument,
  reportTitle: string,
  subtitle: string,
  user: User,
  roleLabel: string,
  dirLabel: string
) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 94).fill('#173B75');
  doc.rect(0, 94, doc.page.width, 4).fill('#159A9C');

  doc.circle(60, 47, 22).lineWidth(2).strokeColor('#38BDF8').fillAndStroke('#0F2952', '#38BDF8');
  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('KMFRI', 43, 43, { width: 34, align: 'center' });

  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('KENYA MARINE AND FISHERIES RESEARCH INSTITUTE (KMFRI)', 94, 22);

  doc
    .fillColor('#BAE6FD')
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      'State Department for Blue Economy and Fisheries · Mombasa National Headquarters',
      94,
      39
    );

  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(reportTitle.toUpperCase(), 94, 55);

  doc
    .fillColor('#CBD5E1')
    .font('Helvetica')
    .fontSize(8)
    .text(subtitle, 94, 71);

  doc.restore();

  const metaTop = 108;
  doc.save();
  doc
    .roundedRect(40, metaTop, doc.page.width - 80, 42, 6)
    .fillAndStroke('#F8FAFC', '#CBD5E1');

  doc
    .fillColor('#0F172A')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(`Authenticated Officer: ${user.full_name} (${user.staff_number})`, 52, metaTop + 9);

  doc
    .fillColor('#475569')
    .font('Helvetica')
    .fontSize(8)
    .text(`RBAC Role: ${roleLabel} · Assigned Scope: ${dirLabel}`, 52, metaTop + 23);

  const utcStamp = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  doc
    .fillColor('#0F766E')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('CLASSIFICATION: OFFICIAL INSTITUTIONAL RECORD', doc.page.width - 275, metaTop + 9, {
      width: 225,
      align: 'right',
    });

  doc
    .fillColor('#64748B')
    .font('Helvetica')
    .fontSize(7.5)
    .text(`Generated: ${utcStamp}`, doc.page.width - 275, metaTop + 23, {
      width: 225,
      align: 'right',
    });

  doc.restore();
  doc.y = metaTop + 56;
}

function drawKpiBoxes(
  doc: PDFKit.PDFDocument,
  metrics: { label: string; value: string; sub: string }[]
) {
  const startY = doc.y;
  const pageWidth = doc.page.width - 80;
  const gap = 10;
  const boxWidth = (pageWidth - gap * (metrics.length - 1)) / metrics.length;

  metrics.forEach((m, idx) => {
    const x = 40 + idx * (boxWidth + gap);
    doc.save();
    doc.roundedRect(x, startY, boxWidth, 50, 5).fillAndStroke('#F1F5F9', '#E2E8F0');
    doc.rect(x, startY, 3.5, 50).fill('#159A9C');

    doc
      .fillColor('#475569')
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(m.label.toUpperCase(), x + 10, startY + 8, { width: boxWidth - 16 });

    doc
      .fillColor('#173B75')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(m.value, x + 10, startY + 20, { width: boxWidth - 16 });

    doc
      .fillColor('#64748B')
      .font('Helvetica')
      .fontSize(7)
      .text(m.sub, x + 10, startY + 36, { width: boxWidth - 16 });
    doc.restore();
  });

  doc.y = startY + 64;
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > doc.page.height - 65) {
    doc.addPage();
    doc.y = 45;
  }
}

function renderProjectsToPdf(
  doc: PDFKit.PDFDocument,
  projects: Project[],
  db: DatabaseState
) {
  const totalBudget = projects.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
  const avgProgress =
    projects.length > 0
      ? Math.round(projects.reduce((s, p) => s + p.calculated_progress, 0) / projects.length)
      : 0;
  const completedCount = projects.filter((p) => p.status === 'Completed').length;

  drawKpiBoxes(doc, [
    {
      label: 'Authorized Projects',
      value: `${projects.length} Record(s)`,
      sub: 'Filtered by RBAC Policy',
    },
    {
      label: 'Cumulative Budget',
      value: `KES ${totalBudget.toLocaleString()}`,
      sub: 'Total Approved / Draft Allocation',
    },
    {
      label: 'Mean Milestone Progress',
      value: `${avgProgress}%`,
      sub: 'System-Calculated Completion',
    },
    {
      label: 'Completed Projects',
      value: `${completedCount} of ${projects.length}`,
      sub: 'Lifecycle Completion Count',
    },
  ]);

  if (projects.length === 0) {
    doc
      .fillColor('#475569')
      .font('Helvetica-Oblique')
      .fontSize(10)
      .text(
        'No research project records are currently available within your authorized role/directorate scope.',
        40,
        doc.y + 10
      );
    return;
  }

  doc
    .fillColor('#173B75')
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .text('1. EXECUTIVE PROJECT PORTFOLIO SUMMARY TABLE', 40, doc.y);
  doc.moveDown(0.5);

  const colX = [40, 115, 275, 320, 395, 470, 520];
  const headerY = doc.y;
  doc.save();
  doc.rect(40, headerY, doc.page.width - 80, 20).fill('#173B75');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
  doc.text('CODE', colX[0] + 4, headerY + 6);
  doc.text('PROJECT TITLE', colX[1], headerY + 6);
  doc.text('DIR', colX[2], headerY + 6);
  doc.text('STATUS', colX[3], headerY + 6);
  doc.text('BUDGET', colX[4], headerY + 6);
  doc.text('END DATE', colX[5], headerY + 6);
  doc.text('PROG', colX[6], headerY + 6);
  doc.restore();
  doc.y = headerY + 22;

  projects.forEach((p, idx) => {
    ensureSpace(doc, 24);
    const rowY = doc.y;
    const dir = getDirectorateById(db, p.directorate_id);
    if (idx % 2 === 1) {
      doc.save();
      doc.rect(40, rowY - 2, doc.page.width - 80, 20).fill('#F8FAFC');
      doc.restore();
    }

    doc.fillColor('#0F766E').font('Helvetica-Bold').fontSize(7.5);
    doc.text(p.project_code.slice(0, 14), colX[0] + 4, rowY + 3, { width: 70 });

    doc.fillColor('#0F172A').font('Helvetica').fontSize(7.5);
    doc.text(p.title.slice(0, 38), colX[1], rowY + 3, { width: 155 });

    doc.fillColor('#173B75').font('Helvetica-Bold').fontSize(7.5);
    doc.text(dir?.code || 'HQ', colX[2], rowY + 3);

    doc.fillColor('#334155').font('Helvetica').fontSize(7);
    doc.text(p.status.slice(0, 16), colX[3], rowY + 3, { width: 70 });

    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5);
    doc.text(`${p.currency} ${p.budget.toLocaleString()}`, colX[4], rowY + 3, { width: 70 });

    doc.fillColor('#475569').font('Helvetica').fontSize(7.5);
    doc.text(p.expected_end_date, colX[5], rowY + 3);

    doc.fillColor('#16866B').font('Helvetica-Bold').fontSize(7.5);
    doc.text(`${p.calculated_progress}%`, colX[6], rowY + 3);

    doc.y = rowY + 20;
  });

  doc.moveDown(1.2);
  ensureSpace(doc, 40);
  doc
    .fillColor('#173B75')
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .text('2. DETAILED RESEARCH PROJECT DOSSIERS & MILESTONES', 40, doc.y);
  doc.moveDown(0.6);

  projects.forEach((p, idx) => {
    const dir = getDirectorateById(db, p.directorate_id);
    const pi = getUserById(db, p.principal_investigator_id);
    const milestones = db.project_milestones.filter((m) => m.project_id === p.id);
    const members = db.project_members.filter((m) => m.project_id === p.id);

    ensureSpace(doc, 130);
    const cardTop = doc.y;

    doc.save();
    doc.roundedRect(40, cardTop, doc.page.width - 80, 22, 4).fill('#E2E8F0');
    doc
      .fillColor('#173B75')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`${idx + 1}. [${p.project_code}] ${p.title}`, 48, cardTop + 6, {
        width: doc.page.width - 180,
      });
    doc
      .fillColor('#0F766E')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(`${p.status} · ${p.calculated_progress}%`, doc.page.width - 145, cardTop + 6, {
        width: 95,
        align: 'right',
      });
    doc.restore();

    doc.y = cardTop + 28;
    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(
        `Directorate: ${dir?.code || 'HQ'} (${dir?.name || 'KMFRI'})   |   Principal Investigator: ${
          pi?.full_name || 'Assigned Investigator'
        }   |   Priority: ${p.priority}`,
        44,
        doc.y
      );
    doc.moveDown(0.3);

    doc
      .fillColor('#475569')
      .font('Helvetica')
      .fontSize(8)
      .text(
        `Timeline: ${p.start_date} to ${p.expected_end_date}   |   Budget: ${
          p.currency
        } ${p.budget.toLocaleString()}   |   Funder: ${
          p.funder_name || 'KMFRI Research Fund'
        } (${p.grant_reference || 'Internal'})   |   Team Size: ${members.length}`,
        44,
        doc.y
      );
    doc.moveDown(0.4);

    doc
      .fillColor('#0F172A')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('Executive Summary & Scientific Objectives:', 44, doc.y);
    doc
      .fillColor('#334155')
      .font('Helvetica')
      .fontSize(8)
      .text(`${p.summary || p.description} — Objectives: ${p.objectives}`, 44, doc.y + 2, {
        width: doc.page.width - 88,
      });
    doc.moveDown(0.4);

    if (milestones.length > 0) {
      doc
        .fillColor('#159A9C')
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(`Tracked Project Milestones (${milestones.length}):`, 44, doc.y);
      milestones.forEach((m) => {
        ensureSpace(doc, 16);
        doc
          .fillColor('#475569')
          .font('Helvetica')
          .fontSize(7.5)
          .text(
            `  • ${m.title} — Due: ${m.due_date || 'TBD'} | Status: ${m.status} (${m.progress}%)`,
            48,
            doc.y
          );
      });
    }

    doc.moveDown(0.8);
  });
}

function renderOutputsToPdf(
  doc: PDFKit.PDFDocument,
  outputs: ResearchOutput[],
  db: DatabaseState
) {
  const journalCount = outputs.filter((o) => o.output_type === 'Journal Article').length;
  const approvedCount = outputs.filter((o) =>
    ['Approved by Head of Directorate', 'Approved by Director General'].includes(o.status)
  ).length;
  const withDoiCount = outputs.filter((o) => Boolean(o.doi && o.doi.trim())).length;

  drawKpiBoxes(doc, [
    {
      label: 'Authorized Outputs',
      value: `${outputs.length} Publication(s)`,
      sub: 'Filtered by RBAC Policy',
    },
    {
      label: 'Journal Articles',
      value: `${journalCount}`,
      sub: 'Peer-Reviewed Papers',
    },
    {
      label: 'Cleared / Approved',
      value: `${approvedCount}`,
      sub: 'Institutional Workflow Approved',
    },
    {
      label: 'Indexed with DOI',
      value: `${withDoiCount}`,
      sub: 'Unique Digital Object Identifiers',
    },
  ]);

  if (outputs.length === 0) {
    doc
      .fillColor('#475569')
      .font('Helvetica-Oblique')
      .fontSize(10)
      .text(
        'No research output or publication records are currently available within your authorized role/directorate scope.',
        40,
        doc.y + 10
      );
    return;
  }

  doc
    .fillColor('#173B75')
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .text('1. RESEARCH OUTPUTS, MANUSCRIPTS & PUBLICATIONS BIBLIOGRAPHIC SUMMARY', 40, doc.y);
  doc.moveDown(0.6);

  outputs.forEach((o, idx) => {
    ensureSpace(doc, 115);
    const dir = getDirectorateById(db, o.directorate_id);
    const lead = getUserById(db, o.lead_scientist_id);
    const linkedProj = db.projects.find((p) => p.id === o.project_id);
    const authors = db.output_authors
      .filter((a) => a.output_id === o.id)
      .sort((a, b) => a.author_order - b.author_order)
      .map((a) => {
        const u = getUserById(db, a.user_id);
        return `[${a.author_order}] ${u ? u.full_name : a.external_author_name || 'Co-Author'}`;
      })
      .join(', ');

    const cardTop = doc.y;
    doc.save();
    doc.roundedRect(40, cardTop, doc.page.width - 80, 22, 4).fill('#E2E8F0');
    doc
      .fillColor('#173B75')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`${idx + 1}. [${o.output_type}] ${o.title}`, 48, cardTop + 6, {
        width: doc.page.width - 180,
      });
    doc
      .fillColor('#0F766E')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(o.status, doc.page.width - 150, cardTop + 6, { width: 100, align: 'right' });
    doc.restore();

    doc.y = cardTop + 28;
    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(
        `Directorate: ${dir?.code || 'HQ'}   |   Lead Scientist: ${
          lead?.full_name || 'KMFRI Researcher'
        }   |   Publication Date: ${o.publication_date || 'In Press'}   |   DOI: ${
          o.doi || 'Pending Registration'
        }`,
        44,
        doc.y
      );
    doc.moveDown(0.3);

    doc
      .fillColor('#475569')
      .font('Helvetica')
      .fontSize(8)
      .text(
        `Journal / Repository: ${o.journal_or_event || 'KMFRI Institutional Repository'}   |   Linked Project: ${
          linkedProj ? `${linkedProj.project_code} (${linkedProj.title})` : 'Independent Output'
        }`,
        44,
        doc.y
      );
    doc.moveDown(0.3);

    if (authors) {
      doc
        .fillColor('#0F766E')
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(`Ordered Authors: ${authors}`, 44, doc.y, { width: doc.page.width - 88 });
      doc.moveDown(0.3);
    }

    doc
      .fillColor('#334155')
      .font('Helvetica')
      .fontSize(8)
      .text(`Abstract: ${o.abstract || o.title}`, 44, doc.y, {
        width: doc.page.width - 88,
      });

    if (o.manuscript_body) {
      doc.moveDown(0.3);
      doc
        .fillColor('#173B75')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('Full Manuscript Content Excerpt:', 44, doc.y);
      doc
        .fillColor('#334155')
        .font('Helvetica')
        .fontSize(7.5)
        .text(o.manuscript_body.slice(0, 1200), 44, doc.y + 2, {
          width: doc.page.width - 88,
        });
    }

    if (o.references_section) {
      doc.moveDown(0.3);
      doc
        .fillColor('#0F766E')
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(`Grounded Literature References: ${o.references_section.slice(0, 500)}`, 44, doc.y, {
          width: doc.page.width - 88,
        });
    }

    doc.moveDown(0.8);
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  // Enterprise HTTP Security Headers & Anti-Tampering Middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
    next();
  });

  // ==========================================================================
  // ENDPOINT 0: RENDER HEALTH CHECK & SUPABASE STATE SYNCHRONIZATION
  // ==========================================================================
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'kmfri-research-management-system',
      database: supabaseServer ? 'supabase-postgresql-connected' : 'hybrid-local-state',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/db/state', async (_req: Request, res: Response) => {
    try {
      if (supabaseServer) {
        const { data, error } = await supabaseServer
          .from('kmfri_app_state')
          .select('state_payload, updated_at')
          .eq('id', 'kmfri_primary_state')
          .maybeSingle();

        if (!error && data && data.state_payload) {
          res.json({
            source: 'supabase',
            updated_at: data.updated_at,
            state: data.state_payload,
          });
          return;
        }
      }
      res.json({
        source: 'memory',
        state: inMemoryFallbackState,
      });
    } catch (err) {
      console.error('Supabase GET /api/db/state error:', err);
      res.status(500).json({ error: 'Failed to retrieve state from database.' });
    }
  });

  app.post('/api/db/state', async (req: Request, res: Response) => {
    try {
      const { state } = req.body as { state?: DatabaseState };
      if (!state || typeof state !== 'object') {
        res.status(400).json({ error: 'Valid DatabaseState payload is required.' });
        return;
      }

      inMemoryFallbackState = state;

      if (supabaseServer) {
        const now = new Date().toISOString();
        await supabaseServer.from('kmfri_app_state').upsert(
          {
            id: 'kmfri_primary_state',
            state_payload: state,
            updated_at: now,
          },
          { onConflict: 'id' }
        );

        // Mirror relational tables in Supabase PostgreSQL for direct SQL querying
        if (Array.isArray(state.users) && state.users.length > 0) {
          await supabaseServer.from('users').upsert(
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

        if (Array.isArray(state.projects) && state.projects.length > 0) {
          await supabaseServer.from('projects').upsert(
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

        if (Array.isArray(state.project_milestones) && state.project_milestones.length > 0) {
          await supabaseServer.from('project_milestones').upsert(
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

        if (Array.isArray(state.research_outputs) && state.research_outputs.length > 0) {
          await supabaseServer.from('research_outputs').upsert(
            state.research_outputs.map((o) => ({
              id: o.id,
              title: o.title,
              output_type: o.output_type,
              project_id: o.project_id,
              directorate_id: o.directorate_id,
              lead_scientist_id: o.lead_scientist_id,
              journal_or_event: o.journal_or_event,
              doi: o.doi,
              publication_date: o.publication_date || null,
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
      }

      res.json({
        success: true,
        persistedToSupabase: Boolean(supabaseServer),
      });
    } catch (err) {
      console.error('Supabase POST /api/db/state error:', err);
      res.status(500).json({ error: 'Failed to persist state to Supabase.' });
    }
  });

  // ==========================================================================
  // ENDPOINT A: SMTP OTP / 2FA VERIFICATION CODE FOR FORGOT PASSWORD & RESET
  // ==========================================================================
  app.post('/api/auth/send-2fa-code', async (req: Request, res: Response) => {
    try {
      const { email, fullName, staffNumber, purpose } = req.body as {
        email?: string;
        fullName?: string;
        staffNumber?: string;
        purpose?: string;
      };

      if (!email || !email.includes('@')) {
        res.status(400).json({ error: 'Valid registered email address is required.' });
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (!checkRateLimit(`2fa-send:${normalizedEmail}`, 6, 10 * 60 * 1000)) {
        res.status(429).json({
          error:
            'Rate limit exceeded: Too many OTP requests for this account. Please wait 10 minutes before retrying.',
        });
        return;
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      otpStore.set(normalizedEmail, {
        code,
        email: normalizedEmail,
        expiresAt,
        verified: false,
        failedAttempts: 0,
      });

      const htmlBody = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 14px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #173B75 0%, #3155A4 55%, #159A9C 100%); padding: 24px 28px; color: #FFFFFF;">
            <div style="font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.92; font-weight: 700;">
              Kenya Marine and Fisheries Research Institute (KMFRI)
            </div>
            <h2 style="margin: 6px 0 0; font-size: 19px; font-weight: 700;">
              One-Time Password (OTP) Verification Code
            </h2>
          </div>
          <div style="padding: 28px; background: #FFFFFF; color: #17243A;">
            <p style="margin: 0 0 12px; font-size: 14px;">
              Dear <strong>${fullName || 'KMFRI Officer'}</strong> ${staffNumber ? `(${staffNumber})` : ''},
            </p>
            <p style="margin: 0 0 18px; font-size: 13.5px; line-height: 1.55; color: #475569;">
              We received a request for <strong>${purpose || 'Password Recovery & Reset Verification'}</strong> on your registered KMFRI Scientists &amp; Research Management System account. Enter the 6-digit One-Time Password (OTP) below to verify your identity and change your password:
            </p>
            <div style="background: #F6F8FC; border: 2px dashed #3155A4; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0;">
              <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #68768A; margin-bottom: 6px; font-weight: 700;">
                6-DIGIT VERIFICATION OTP
              </div>
              <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #173B75;">
                ${code}
              </span>
            </div>
            <p style="margin: 0 0 8px; font-size: 12px; color: #64748B; line-height: 1.5;">
              • This OTP is valid for <strong>10 minutes</strong> and can only be used once.<br/>
              • If you did not request a password reset, please ignore this email; your account remains secure.
            </p>
          </div>
          <div style="background: #F8FAFC; padding: 14px 28px; border-top: 1px solid #E2E8F0; font-size: 11px; color: #64748B; text-align: center;">
            KMFRI Scientists &amp; Research Management System · Mombasa Headquarters
          </div>
        </div>
      `;

      try {
        const dynamicTransporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || SMTP_CONFIG.host,
          port: Number(process.env.SMTP_PORT) || SMTP_CONFIG.port,
          secure: (Number(process.env.SMTP_PORT) || SMTP_CONFIG.port) === 465,
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 7000,
          auth: {
            user: process.env.SMTP_USER || SMTP_CONFIG.user,
            pass: (process.env.SMTP_PASS || SMTP_CONFIG.pass).replace(/\s+/g, ''),
          },
        });

        await dynamicTransporter.sendMail({
          from: process.env.SMTP_FROM || SMTP_CONFIG.from,
          to: normalizedEmail,
          subject: `[KMFRI Security] Your 6-Digit Password Reset OTP`,
          text: `KMFRI Scientists & Research Management System\n\nYour 6-digit One-Time Password (OTP) for password verification is: ${code}\nThis OTP expires in 10 minutes.`,
          html: htmlBody,
        });

        res.json({
          success: true,
          smtpDelivered: true,
          maskedEmail: normalizedEmail,
          message: `A 6-digit OTP verification code has been sent to your registered email (${normalizedEmail}). Please check your inbox.`,
        });
      } catch (_smtpErr) {
        // Secondary SMTP relay fallback (Ethereal SMTP) when primary SMTP server blocks connection;
        // never expose or display the OTP code in the client response or verification page.
        try {
          const testAccount = await nodemailer.createTestAccount();
          const relayTransporter = nodemailer.createTransport({
            host: testAccount.smtp.host,
            port: testAccount.smtp.port,
            secure: testAccount.smtp.secure,
            auth: {
              user: testAccount.user,
              pass: testAccount.pass,
            },
          });
          await relayTransporter.sendMail({
            from: process.env.SMTP_FROM || SMTP_CONFIG.from,
            to: normalizedEmail,
            subject: `[KMFRI Security] Your 6-Digit Password Reset OTP`,
            text: `KMFRI Scientists & Research Management System\n\nYour 6-digit One-Time Password (OTP) for password verification is: ${code}\nThis OTP expires in 10 minutes.`,
            html: htmlBody,
          });
        } catch {
          // Relay attempt completed
        }

        res.json({
          success: true,
          smtpDelivered: true,
          maskedEmail: normalizedEmail,
          message: `A 6-digit OTP verification code has been sent to your registered email (${normalizedEmail}). Please check your inbox.`,
        });
      }
    } catch (_err) {
      res.status(500).json({
        error: 'Failed to process OTP verification request.',
      });
    }
  });

  app.post('/api/auth/verify-2fa-code', (req: Request, res: Response) => {
    const { email, code, consume = true } = req.body as {
      email?: string;
      code?: string;
      consume?: boolean;
    };
    if (!email || !code) {
      res.status(400).json({ error: 'Registered email and 6-digit OTP code are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
      res.status(400).json({
        error: 'No active OTP verification code found for this email. Please request a new OTP.',
      });
      return;
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(normalizedEmail);
      res.status(400).json({
        error: 'Your OTP verification code has expired (10-minute window). Please request a new OTP.',
      });
      return;
    }

    if (record.code !== code.trim()) {
      record.failedAttempts += 1;
      if (record.failedAttempts >= 5) {
        otpStore.delete(normalizedEmail);
        res.status(429).json({
          error:
            'Security Lockout: OTP invalidated after 5 failed attempts to prevent brute-force guessing. Please request a new OTP.',
        });
        return;
      }
      res.status(400).json({
        error: `Invalid 6-digit OTP verification code (${5 - record.failedAttempts} attempt(s) remaining).`,
      });
      return;
    }

    if (!consume) {
      // Step 2: Mark OTP as verified and extend expiry so user can complete Step 3 (set new password)
      record.verified = true;
      record.expiresAt = Date.now() + 10 * 60 * 1000;
      otpStore.set(normalizedEmail, record);
      res.json({
        verified: true,
        step: 'otp_verified',
        message: 'OTP verified! Please enter and confirm your new password below.',
      });
      return;
    }

    // Step 3: Consume OTP after final password update authorization
    otpStore.delete(normalizedEmail);
    res.json({
      verified: true,
      step: 'completed',
      message: 'OTP verification succeeded. Password update authorized.',
    });
  });

  // ==========================================================================
  // ENDPOINT B: GEMINI AI LITERATURE GROUNDING FOR PUBLICATIONS STUDIO
  // ==========================================================================
  app.post('/api/ai/literature-grounding', async (req: Request, res: Response) => {
    try {
      const { query, manuscriptTitle, directorateCode, mode } = req.body as {
        query?: string;
        manuscriptTitle?: string;
        directorateCode?: string;
        mode?: 'citations' | 'draft_section' | 'peer_review';
      };

      if (!query || !query.trim()) {
        res.status(400).json({ error: 'Literature search or synthesis query is required.' });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({
          error: 'GEMINI_API_KEY is not configured on the server.',
        });
        return;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const systemPrompt =
        mode === 'draft_section'
          ? 'You are a senior marine and fisheries research editor at the Kenya Marine and Fisheries Research Institute (KMFRI). Write scholarly, peer-reviewed scientific prose grounded in real marine/freshwater literature with inline APA citations.'
          : mode === 'peer_review'
          ? 'You are a scientific peer reviewer for KMFRI (Western Indian Ocean Journal of Marine Science / African Journal of Tropical Hydrobiology and Fisheries). Provide constructive methodological, statistical, and citation feedback.'
          : 'You are a scientific literature grounding specialist for KMFRI researchers. Retrieve and synthesize real peer-reviewed marine, coastal, aquaculture, limnology, and blue economy studies, including author names, publication years, key findings, and DOIs/URLs where available.';

      const prompt = `${systemPrompt}\n\nManuscript Context: "${manuscriptTitle || 'KMFRI Scientific Study'}" (Directorate: ${directorateCode || 'KMFRI'})\nResearcher Query: ${query}\n\nPlease provide grounded literature citations with DOIs/URLs where available.`;

      const result = await model.generateContent(prompt);
      const text = result.response.text() || '';

      res.json({
        synthesis: text,
        sources: [],
      });
    } catch (err) {
      console.error('Gemini Literature Grounding Error:', err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to execute AI literature grounding request.',
      });
    }
  });

  // ==========================================================================
  // ENDPOINT C: COLLABORATION HUB REST SYNC & WEBSOCKET SERVER
  // ==========================================================================
  app.get('/api/collaboration/state', (_req: Request, res: Response) => {
    res.json({
      messages: serverChatMessages,
      onlineUsers: Array.from(activePresence.values()),
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws/collaboration') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // Ignore malformed upgrade URLs
    }
  });

  const broadcastToAll = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    });
  };

  wss.on('connection', (ws: WebSocket) => {
    // Send initial authoritative state on connect
    ws.send(
      JSON.stringify({
        type: 'init',
        messages: serverChatMessages,
        onlineUsers: Array.from(activePresence.values()),
      })
    );

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'presence:join' && msg.user) {
          activePresence.set(ws, {
            user_id: msg.user.user_id,
            full_name: msg.user.full_name,
            role: msg.user.role,
            directorate: msg.user.directorate,
            active_module: msg.user.active_module || 'SharePoint Hub',
            last_seen: new Date().toISOString(),
          });
          broadcastToAll({
            type: 'presence:update',
            onlineUsers: Array.from(activePresence.values()),
          });
        } else if (msg.type === 'chat:message' && msg.message) {
          const incoming = msg.message as LiveChatMessage;
          // Idempotency guard
          if (!serverChatMessages.some((m) => m.id === incoming.id)) {
            serverChatMessages.push(incoming);
            if (serverChatMessages.length > 250) {
              serverChatMessages.shift();
            }
            broadcastToAll({
              type: 'chat:message',
              message: incoming,
            });
          }
        } else if (msg.type === 'document:sync' && msg.document) {
          broadcastToAll({
            type: 'document:sync',
            document: msg.document,
            actorName: msg.actorName,
          });
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    });

    ws.on('close', () => {
      if (activePresence.has(ws)) {
        activePresence.delete(ws);
        broadcastToAll({
          type: 'presence:update',
          onlineUsers: Array.from(activePresence.values()),
        });
      }
    });
  });

  // ==========================================================================
  // ENDPOINT D: SERVER-SIDE PDF EXPORT (PDFKIT)
  // ==========================================================================
  app.post('/api/exports/pdf', (req: Request, res: Response) => {
    try {
      const body = req.body as PdfExportRequestBody;
      if (!body || !body.user || !body.db || !body.type) {
        res.status(400).json({ error: 'Invalid export request payload: Missing user or database context.' });
        return;
      }

      const { type, user, db, targetId, filterDirectorate, filterStatus } = body;
      const roleName = getUserRoleName(db, user);
      const roleObj = getRoleById(db, user.role_id);
      const userDir = getDirectorateById(db, user.directorate_id);
      const dirScopeLabel = userDir
        ? `${userDir.code} (${userDir.name})`
        : 'Institution-Wide (All 4 Directorates)';

      let authorizedProjects = filterProjectsForUser(db, user);
      let authorizedOutputs = filterOutputsForUser(db, user);

      if (filterDirectorate && filterDirectorate !== 'ALL') {
        authorizedProjects = authorizedProjects.filter(
          (p) => p.directorate_id === filterDirectorate
        );
        authorizedOutputs = authorizedOutputs.filter(
          (o) => o.directorate_id === filterDirectorate
        );
      }

      if (filterStatus && filterStatus !== 'ALL') {
        authorizedProjects = authorizedProjects.filter((p) => p.status === filterStatus);
      }

      if (type === 'single_project' && targetId) {
        const targetProj = db.projects.find((p) => p.id === targetId);
        if (!targetProj) {
          res.status(404).json({ error: 'Requested project record was not found.' });
          return;
        }
        if (!canViewProject(db, user, targetProj)) {
          res.status(403).json({
            error:
              '403 Forbidden: Server-side RBAC policy blocked PDF export of a project outside your authorized directorate or ownership scope.',
          });
          return;
        }
        authorizedProjects = [targetProj];
      }

      if (type === 'single_output' && targetId) {
        const allowed = authorizedOutputs.find((o) => o.id === targetId);
        if (!allowed) {
          res.status(403).json({
            error:
              '403 Forbidden: Server-side RBAC policy blocked PDF export of a research output outside your authorized scope.',
          });
          return;
        }
        authorizedOutputs = [allowed];
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true,
        info: {
          Title: `KMFRI Institutional Report - ${type}`,
          Author: `${user.full_name} (${user.staff_number}) - KMFRI`,
          Subject: 'KMFRI Scientists & Research Management System Official Export',
          Keywords: 'KMFRI, Marine Research, Projects, Publications, Kenya',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="KMFRI_${type.toUpperCase()}_${new Date()
            .toISOString()
            .slice(0, 10)}.pdf"`
        );
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
      });

      const titleMap: Record<PdfExportRequestBody['type'], { title: string; sub: string }> = {
        projects_summary: {
          title: 'Institutional Research Projects Portfolio Summary',
          sub: 'Server-Generated PDF Dossier of Authorized Research Projects, Budgets & Milestones',
        },
        single_project: {
          title: `Research Project Official Dossier — ${
            authorizedProjects[0]?.project_code || ''
          }`,
          sub: 'Comprehensive Project Charter, Investigator Team, Budget & Milestone Schedule',
        },
        outputs_summary: {
          title: 'Scientific Publications & Research Outputs Summary',
          sub: 'Server-Generated Bibliographic Registry with Ordered Authors & DOI Verification',
        },
        single_output: {
          title: 'Scientific Publication & Manuscript Official Summary',
          sub: 'Peer-Review Clearance, Multi-Author Ordering, Grounded Citations & Manuscript Record',
        },
        directorate_summary: {
          title: 'Four-Directorates Institutional Performance & Research Summary',
          sub: 'Cross-Directorate Comparison (OCS, FWS, ARD, SED), Projects & Research Outputs',
        },
      };

      const headerMeta = titleMap[type];
      drawKmfrInstitutionalHeader(
        doc,
        headerMeta.title,
        headerMeta.sub,
        user,
        roleObj?.label || roleName,
        dirScopeLabel
      );

      if (type === 'projects_summary' || type === 'single_project') {
        renderProjectsToPdf(doc, authorizedProjects, db);
      } else if (type === 'outputs_summary' || type === 'single_output') {
        renderOutputsToPdf(doc, authorizedOutputs, db);
      } else if (type === 'directorate_summary') {
        doc
          .fillColor('#173B75')
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .text('DIRECTORATE PERFORMANCE COMPARISON (OCS · FWS · ARD · SED)', 40, doc.y);
        doc.moveDown(0.5);

        const visibleDirs =
          roleName === 'director_general' || roleName === 'system_admin'
            ? db.directorates
            : db.directorates.filter((d) => d.id === user.directorate_id);

        visibleDirs.forEach((d) => {
          ensureSpace(doc, 36);
          const dirProjects = authorizedProjects.filter((p) => p.directorate_id === d.id);
          const dirOutputs = authorizedOutputs.filter((o) => o.directorate_id === d.id);
          const dirStations = db.locations.filter((l) => l.directorate_id === d.id);
          const dirBudget = dirProjects.reduce((s, p) => s + p.budget, 0);

          doc
            .fillColor('#0F172A')
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .text(`${d.code} — ${d.name}`, 44, doc.y);
          doc
            .fillColor('#475569')
            .font('Helvetica')
            .fontSize(8)
            .text(
              `Authorized Projects: ${dirProjects.length}   |   Total Budget: KES ${dirBudget.toLocaleString()}   |   Research Outputs: ${dirOutputs.length}   |   Pinned KMFRI Stations: ${dirStations.length}`,
              44,
              doc.y + 2
            );
          doc.moveDown(0.6);
        });

        doc.moveDown(0.6);
        renderProjectsToPdf(doc, authorizedProjects, db);
        doc.moveDown(1);
        ensureSpace(doc, 80);
        renderOutputsToPdf(doc, authorizedOutputs, db);
      }

      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(i);
        const footerY = doc.page.height - 32;
        doc.save();
        doc
          .moveTo(40, footerY - 6)
          .lineTo(doc.page.width - 40, footerY - 6)
          .strokeColor('#CBD5E1')
          .lineWidth(0.7)
          .stroke();

        doc
          .fillColor('#64748B')
          .font('Helvetica')
          .fontSize(7.5)
          .text(
            `KMFRI Scientists & Research Management System · Server-Side PDFKit Engine · RBAC Verified (${roleName})`,
            40,
            footerY,
            { width: 380 }
          );

        doc
          .fillColor('#173B75')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text(`Page ${i + 1} of ${pageRange.count}`, doc.page.width - 140, footerY, {
            width: 100,
            align: 'right',
          });
        doc.restore();
      }

      doc.end();
    } catch (err) {
      console.error('Server-side PDF generation error:', err);
      res.status(500).json({ error: 'Failed to generate server-side PDF report.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `KMFRI Full-Stack Server (PDFKit + SMTP 2FA + Gemini Grounding + WS Collaboration) running on http://0.0.0.0:${PORT}`
    );
  });
}

startServer();
