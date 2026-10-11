import React, { useState } from 'react';
import {
  DatabaseState,
  User,
  DocumentRecord,
} from '../types/kmfri.ts';
import {
  generateUuid,
  getDirectorateById,
  getUserById,
  appendAuditLog,
} from '../services/database.ts';
import {
  canApproveOrReviewEntity,
  getUserRoleName,
  filterProjectsForUser,
  filterOutputsForUser,
} from '../services/rbacPolicy.ts';
import {
  exportToCsv,
  exportToExcel,
  exportServerPdf,
} from '../services/exportService.ts';
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Upload,
  Download,
  FileSpreadsheet,
  FileText,
  AlertCircle,
} from 'lucide-react';

interface GovernanceAndExportsModulesProps {
  db: DatabaseState;
  currentUser: User;
  mode: 'approvals' | 'documents' | 'notifications' | 'analytics';
  onUpdateDb: (next: DatabaseState) => void;
}

const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'csv', 'png', 'jpg'];

export const GovernanceAndExportsModules: React.FC<GovernanceAndExportsModulesProps> = ({
  db,
  currentUser,
  mode,
  onUpdateDb,
}) => {
  const [alertMsg, setAlertMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [exportingType, setExportingType] = useState<string | null>(null);

  // Document upload state
  const [docTitle, setDocTitle] = useState('');
  const [docFilename, setDocFilename] = useState('');
  const [docCategory, setDocCategory] =
    useState<DocumentRecord['document_category']>('Project Proposal');
  const [docSizeKb, setDocSizeKb] = useState('');
  const [docDesc, setDocDesc] = useState('');
  const [docProjectId, setDocProjectId] = useState(db.projects[0]?.id || '');

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocFilename(file.name);
    setDocSizeKb(String(Math.max(1, Math.round(file.size / 1024))));
    if (!docTitle.trim()) {
      setDocTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUploadDocument = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);

    const cleanName = docFilename.trim();
    if (cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\')) {
      setAlertMsg({
        type: 'err',
        text: 'Security block: Directory traversal characters (.., /, \\) are strictly prohibited.',
      });
      return;
    }

    const ext = cleanName.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setAlertMsg({
        type: 'err',
        text: `Security block: File extension ".${ext}" is prohibited. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}. Executable files (.php, .exe, .sh, .js) are rejected.`,
      });
      return;
    }

    const sizeBytes = (Number(docSizeKb) || 100) * 1024;
    if (sizeBytes > 25 * 1024 * 1024) {
      setAlertMsg({
        type: 'err',
        text: 'Upload rejected: File exceeds maximum configured policy limit of 25 MB.',
      });
      return;
    }

    const existingVersions = db.documents.filter(
      (d) => d.name.toLowerCase() === docTitle.trim().toLowerCase()
    );
    const nextVersion = existingVersions.length + 1;

    const safeServerKey = `storage/private/uploads/${new Date().toISOString().slice(0, 10)}/${generateUuid()}.${ext}`;
    const docRecord: DocumentRecord = {
      id: generateUuid(),
      project_id: docProjectId || db.projects[0]?.id || null,
      directorate_id: currentUser.directorate_id || db.directorates[0].id,
      uploader_id: currentUser.id,
      name: docTitle.trim() || cleanName,
      original_filename: cleanName,
      mime_type: ext === 'pdf' ? 'application/pdf' : `application/${ext}`,
      document_category: docCategory,
      secure_storage_key: safeServerKey,
      file_size_bytes: sizeBytes,
      version: nextVersion,
      linked_entity_type: 'project',
      linked_entity_id: docProjectId || db.projects[0]?.id || null,
      description: docDesc.trim(),
      created_at: new Date().toISOString(),
    };

    let nextState = {
      ...db,
      documents: [docRecord, ...db.documents],
    };
    nextState = appendAuditLog(
      nextState,
      currentUser,
      'SECURE_DOCUMENT_UPLOADED',
      'documents',
      docRecord.id,
      null,
      {
        name: docRecord.name,
        secure_storage_key: docRecord.secure_storage_key,
        version: docRecord.version,
      }
    );

    onUpdateDb(nextState);
    setDocTitle('');
    setDocFilename('');
    setDocSizeKb('');
    setDocDesc('');
    setAlertMsg({
      type: 'ok',
      text: `Document stored outside web root at "${safeServerKey}" (v${nextVersion}).`,
    });
  };

  if (mode === 'approvals') {
    const pendingProjects = db.projects.filter((p) =>
      ['Submitted', 'Under Review', 'Approved by Head of Directorate'].includes(p.status)
    );
    const pendingOutputs = db.research_outputs.filter((o) =>
      ['Submitted', 'Under Review', 'Approved by Head of Directorate'].includes(o.status)
    );
    const pendingReports = db.reports.filter((r) =>
      ['Submitted', 'Under Review'].includes(r.status)
    );

    const handleWorkflowDecision = (
      entityType: 'project' | 'output' | 'report',
      entityId: string,
      entityTitle: string,
      entityDirId: string,
      submittedBy: string,
      prevState: string,
      decision: 'Approved' | 'Changes Requested' | 'Rejected'
    ) => {
      setAlertMsg(null);
      if (decision !== 'Approved' && !reviewComment.trim()) {
        setAlertMsg({
          type: 'err',
          text: `Reviewer comments are mandatory when recording "${decision}".`,
        });
        return;
      }

      const roleName = getUserRoleName(db, currentUser);
      const newState =
        decision === 'Approved'
          ? roleName === 'director_general'
            ? ('Approved by Director General' as const)
            : ('Approved by Head of Directorate' as const)
          : decision === 'Changes Requested'
          ? ('Changes Requested' as const)
          : ('Rejected' as const);

      const now = new Date().toISOString();
      const appEntry = {
        id: generateUuid(),
        entity_type: entityType,
        entity_id: entityId,
        entity_title: entityTitle,
        directorate_id: entityDirId,
        submitted_by: submittedBy,
        reviewer_id: currentUser.id,
        reviewer_role: roleName,
        decision,
        comments: reviewComment.trim() || `${decision} by ${currentUser.full_name}.`,
        workflow_stage:
          roleName === 'director_general' ? 'Director General Executive Review' : 'Directorate Review',
        previous_state: prevState,
        new_state: newState,
        decided_at: now,
        created_at: now,
      };

      let next: DatabaseState = {
        ...db,
        projects:
          entityType === 'project'
            ? db.projects.map((proj) =>
                proj.id === entityId ? { ...proj, status: newState } : proj
              )
            : db.projects,
        research_outputs:
          entityType === 'output'
            ? db.research_outputs.map((out) =>
                out.id === entityId ? { ...out, status: newState } : out
              )
            : db.research_outputs,
        reports:
          entityType === 'report'
            ? db.reports.map((rep) =>
                rep.id === entityId
                  ? { ...rep, status: newState, reviewer_comments: appEntry.comments }
                  : rep
              )
            : db.reports,
        approvals: [appEntry, ...db.approvals],
        notifications: [
          {
            id: generateUuid(),
            user_id: submittedBy,
            title: `${entityType.toUpperCase()} Decision: ${decision}`,
            message: `"${entityTitle}" transitioned from ${prevState} to ${newState}.`,
            type: 'approval',
            related_module: 'approvals',
            related_entity_id: entityId,
            read_at: null,
            created_at: now,
          },
          ...db.notifications,
        ],
      };

      next = appendAuditLog(
        next,
        currentUser,
        `WORKFLOW_${decision.toUpperCase().replace(/\s+/g, '_')}_${entityType.toUpperCase()}`,
        entityType,
        entityId,
        { status: prevState },
        { status: newState, comments: appEntry.comments }
      );

      onUpdateDb(next);
      setReviewComment('');
      setAlertMsg({
        type: 'ok',
        text: `Recorded "${decision}" on "${entityTitle}" → ${newState}.`,
      });
    };

    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Institutional Approval Queue &amp; Traceable Workflow History ({db.approvals.length} Events)
          </h1>
          <p className="text-xs text-slate-500">
            Enforces conflict-of-interest self-approval locks, directorate boundaries, and transactional
            state logging.
          </p>
        </div>

        {alertMsg && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
              alertMsg.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
            }`}
          >
            {alertMsg.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{alertMsg.text}</span>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Submissions Awaiting Review (
            {pendingProjects.length + pendingOutputs.length + pendingReports.length})
          </h2>

          <input
            type="text"
            placeholder="Reviewer comments (mandatory for Request Changes or Reject)..."
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
          />

          {pendingProjects.length === 0 &&
          pendingOutputs.length === 0 &&
          pendingReports.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              Zero pending submissions in queue. Submit a draft Project, Research Output, or Report to
              route it here for review.
            </p>
          ) : (
            <div className="space-y-3">
              {pendingProjects.map((p) => {
                const check = canApproveOrReviewEntity(
                  db,
                  currentUser,
                  p.directorate_id,
                  p.principal_investigator_id,
                  p.status
                );
                const pi = getUserById(db, p.principal_investigator_id);
                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-[#159A9C]">{p.project_code}</span>
                      <span className="mx-1.5">·</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{p.title}</span>
                      <div className="text-slate-500 mt-0.5">
                        Project · Submitted by: {pi?.full_name} · State: <strong>{p.status}</strong>
                      </div>
                      {!check.allowed && (
                        <div className="text-amber-700 dark:text-amber-400 mt-1">{check.reason}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'project',
                            p.id,
                            p.title,
                            p.directorate_id,
                            p.principal_investigator_id,
                            p.status,
                            'Approved'
                          )
                        }
                        className="px-3 py-1.5 bg-[#16866B] disabled:opacity-40 text-white font-semibold rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'project',
                            p.id,
                            p.title,
                            p.directorate_id,
                            p.principal_investigator_id,
                            p.status,
                            'Changes Requested'
                          )
                        }
                        className="px-3 py-1.5 bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Request Changes</span>
                      </button>
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'project',
                            p.id,
                            p.title,
                            p.directorate_id,
                            p.principal_investigator_id,
                            p.status,
                            'Rejected'
                          )
                        }
                        className="px-3 py-1.5 bg-red-600 disabled:opacity-40 text-white font-semibold rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                );
              })}

              {pendingOutputs.map((o) => {
                const check = canApproveOrReviewEntity(
                  db,
                  currentUser,
                  o.directorate_id,
                  o.lead_scientist_id,
                  o.status
                );
                const lead = getUserById(db, o.lead_scientist_id);
                return (
                  <div
                    key={o.id}
                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-[#3155A4]">{o.output_type}</span>
                      <span className="mx-1.5">·</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{o.title}</span>
                      <div className="text-slate-500 mt-0.5">
                        Publication · Lead Author: {lead?.full_name} · State: <strong>{o.status}</strong>
                      </div>
                      {!check.allowed && (
                        <div className="text-amber-700 dark:text-amber-400 mt-1">{check.reason}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'output',
                            o.id,
                            o.title,
                            o.directorate_id,
                            o.lead_scientist_id,
                            o.status,
                            'Approved'
                          )
                        }
                        className="px-3 py-1.5 bg-[#16866B] disabled:opacity-40 text-white font-semibold rounded-md cursor-pointer"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'output',
                            o.id,
                            o.title,
                            o.directorate_id,
                            o.lead_scientist_id,
                            o.status,
                            'Changes Requested'
                          )
                        }
                        className="px-3 py-1.5 bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-md cursor-pointer"
                      >
                        Request Changes
                      </button>
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'output',
                            o.id,
                            o.title,
                            o.directorate_id,
                            o.lead_scientist_id,
                            o.status,
                            'Rejected'
                          )
                        }
                        className="px-3 py-1.5 bg-red-600 disabled:opacity-40 text-white font-semibold rounded-md cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}

              {pendingReports.map((r) => {
                const check = canApproveOrReviewEntity(
                  db,
                  currentUser,
                  r.directorate_id,
                  r.scientist_id,
                  r.status
                );
                const sci = getUserById(db, r.scientist_id);
                return (
                  <div
                    key={r.id}
                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-[#159A9C]">{r.report_type}</span>
                      <span className="mx-1.5">·</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{r.title}</span>
                      <div className="text-slate-500 mt-0.5">
                        Report · Submitted by: {sci?.full_name} · State: <strong>{r.status}</strong>
                      </div>
                      {!check.allowed && (
                        <div className="text-amber-700 dark:text-amber-400 mt-1">{check.reason}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'report',
                            r.id,
                            r.title,
                            r.directorate_id,
                            r.scientist_id,
                            r.status,
                            'Approved'
                          )
                        }
                        className="px-3 py-1.5 bg-[#16866B] disabled:opacity-40 text-white font-semibold rounded-md cursor-pointer"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'report',
                            r.id,
                            r.title,
                            r.directorate_id,
                            r.scientist_id,
                            r.status,
                            'Changes Requested'
                          )
                        }
                        className="px-3 py-1.5 bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-md cursor-pointer"
                      >
                        Request Changes
                      </button>
                      <button
                        type="button"
                        disabled={!check.allowed}
                        onClick={() =>
                          handleWorkflowDecision(
                            'report',
                            r.id,
                            r.title,
                            r.directorate_id,
                            r.scientist_id,
                            r.status,
                            'Rejected'
                          )
                        }
                        className="px-3 py-1.5 bg-red-600 disabled:opacity-40 text-white font-semibold rounded-md cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Complete Approval History */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xs font-bold text-slate-900 dark:text-white">
              Complete Approval Transition Ledger
            </h2>
          </div>
          {db.approvals.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No approval transitions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Entity</th>
                    <th className="py-2.5 px-4">Decision</th>
                    <th className="py-2.5 px-4">Transition</th>
                    <th className="py-2.5 px-4">Comments</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {db.approvals.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 px-4 font-mono">
                        {a.decided_at.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 px-4 font-semibold">{a.entity_title}</td>
                      <td className="py-2.5 px-4 font-semibold text-[#159A9C]">{a.decision}</td>
                      <td className="py-2.5 px-4 font-mono">
                        {a.previous_state} → {a.new_state}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                        {a.comments}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'documents') {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Secure Document Repository &amp; Version Control ({db.documents.length} Files)
          </h1>
          <p className="text-xs text-slate-500">
            Validates MIME/extensions, blocks executable uploads and directory traversal, and stores
            files outside the public web root with automatic versioning.
          </p>
        </div>

        {alertMsg && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
              alertMsg.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
            }`}
          >
            <span>{alertMsg.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
              Upload Validated Research Document
            </h2>
            <form onSubmit={handleUploadDocument} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">
                  Select File from Workstation (Auto-fills metadata)
                </label>
                <input
                  type="file"
                  onChange={handleFileInputChange}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  Document Title (Same title increments version)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter document title"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">
                  Filename (Permitted: .pdf, .docx, .xlsx, .csv, .png, .jpg)
                </label>
                <input
                  type="text"
                  required
                  placeholder="document.pdf"
                  value={docFilename}
                  onChange={(e) => setDocFilename(e.target.value)}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Document Category</label>
                  <select
                    value={docCategory}
                    onChange={(e) =>
                      setDocCategory(e.target.value as DocumentRecord['document_category'])
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="Project Proposal">Project Proposal</option>
                    <option value="MOU / Partnership Agreement">MOU / Partnership Agreement</option>
                    <option value="Technical Report">Technical Report</option>
                    <option value="Research Dataset">Research Dataset</option>
                    <option value="Publication Manuscript">Publication Manuscript</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">File Size (KB)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="250"
                    value={docSizeKb}
                    onChange={(e) => setDocSizeKb(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Validate &amp; Store in Private Vault</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                Authenticated Document Vault (`storage/private/uploads/`)
              </h2>
            </div>
            {db.documents.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No documents uploaded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                      <th className="py-2.5 px-4">Document &amp; Storage Key</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4">Version</th>
                      <th className="py-2.5 px-4 text-right">Size</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {db.documents.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {d.name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {d.secure_storage_key}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">{d.document_category}</td>
                        <td className="py-2.5 px-4 font-mono font-bold text-[#159A9C]">
                          v{d.version}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono">
                          {Math.round(d.file_size_bytes / 1024)} KB
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              exportToPdf(
                                `KMFRI_Vault_Certificate_${d.original_filename}`,
                                `KMFRI Private Vault Custody Certificate — ${d.name}`,
                                `Storage Key: ${d.secure_storage_key}`,
                                ['Field', 'Value'],
                                [
                                  ['Document Title', d.name],
                                  ['Original Filename', d.original_filename],
                                  ['Category', d.document_category],
                                  ['Version', `v${d.version}`],
                                  ['Storage Path', d.secure_storage_key],
                                  ['Uploaded At', d.created_at],
                                ]
                              );
                            }}
                            className="px-2.5 py-1 rounded bg-[#173B75]/10 hover:bg-[#173B75]/20 text-[#173B75] dark:text-sky-300 font-semibold text-[11px] cursor-pointer"
                          >
                            Download Receipt
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'notifications') {
    const myNotifications = db.notifications.filter((n) => n.user_id === currentUser.id);
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Event-Driven Notification Centre ({myNotifications.length})
            </h1>
            <p className="text-xs text-slate-500">
              Generated strictly from real account, project, approval, and assignment events.
            </p>
          </div>
          {myNotifications.some((n) => !n.read_at) && (
            <button
              type="button"
              onClick={() => {
                const now = new Date().toISOString();
                onUpdateDb({
                  ...db,
                  notifications: db.notifications.map((n) =>
                    n.user_id === currentUser.id ? { ...n, read_at: now } : n
                  ),
                });
              }}
              className="px-3.5 py-1.5 bg-[#173B75] text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Mark All as Read
            </button>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
          {myNotifications.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No notifications for your account yet.
            </div>
          ) : (
            myNotifications.map((n) => (
              <div key={n.id} className="p-4 flex items-start justify-between gap-4 text-xs">
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">{n.title}</div>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">{n.message}</p>
                  <span className="text-[11px] font-mono text-slate-400 block mt-1">
                    {n.created_at.slice(0, 19).replace('T', ' ')} UTC
                  </span>
                </div>
                {!n.read_at ? (
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateDb({
                        ...db,
                        notifications: db.notifications.map((item) =>
                          item.id === n.id
                            ? { ...item, read_at: new Date().toISOString() }
                            : item
                        ),
                      });
                    }}
                    className="px-2.5 py-1 border border-[#159A9C] text-[#159A9C] font-semibold rounded-md cursor-pointer shrink-0"
                  >
                    Mark Read
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400 font-mono shrink-0">Read</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Analytics & Real Server-Side PDF / Excel / CSV Exports
  const exportProjects = filterProjectsForUser(db, currentUser);
  const exportOutputs = filterOutputsForUser(db, currentUser);
  const currentUserRole = getUserRoleName(db, currentUser);
  const currentUserDir = getDirectorateById(db, currentUser.directorate_id);

  const handleLogAndExportProjects = async (format: 'pdf' | 'xlsx' | 'csv') => {
    setAlertMsg(null);
    const rows = exportProjects.map((p) => ({
      Project_Code: p.project_code,
      Title: p.title,
      Directorate: getDirectorateById(db, p.directorate_id)?.code || '',
      Status: p.status,
      Budget: `${p.currency} ${p.budget}`,
      Start_Date: p.start_date,
      Expected_End: p.expected_end_date,
      Progress_Calculated: `${p.calculated_progress}%`,
    }));

    try {
      if (format === 'csv') {
        exportToCsv(
          'KMFRI_Authorized_Projects',
          rows.length ? rows : [{ Notice: '0 Records' }]
        );
      } else if (format === 'xlsx') {
        exportToExcel('KMFRI_Authorized_Projects', 'Projects', rows);
      } else {
        setExportingType('projects_pdf');
        await exportServerPdf({
          type: 'projects_summary',
          user: currentUser,
          db,
          filename: `KMFRI_Authorized_Projects_Summary_${new Date().toISOString().slice(0, 10)}.pdf`,
        });
      }

      const next = appendAuditLog(
        db,
        currentUser,
        `DATA_EXPORT_PROJECTS_${format.toUpperCase()}`,
        'projects',
        'batch-export',
        null,
        { format, engine: format === 'pdf' ? 'server-pdfkit' : 'client', record_count: exportProjects.length }
      );
      onUpdateDb(next);
      setAlertMsg({
        type: 'ok',
        text: `Exported ${exportProjects.length} authorized project record(s) as ${format.toUpperCase()} respecting your ${currentUserRole} permissions.`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Export failed.',
      });
    } finally {
      setExportingType(null);
    }
  };

  const handleLogAndExportOutputs = async (format: 'pdf' | 'xlsx' | 'csv') => {
    setAlertMsg(null);
    const rows = exportOutputs.map((o) => ({
      Title: o.title,
      Output_Type: o.output_type,
      Directorate: getDirectorateById(db, o.directorate_id)?.code || '',
      Lead_Scientist: getUserById(db, o.lead_scientist_id)?.full_name || '',
      Journal_Or_Repository: o.journal_or_event,
      DOI: o.doi || 'N/A',
      Publication_Date: o.publication_date,
      Status: o.status,
    }));

    try {
      if (format === 'csv') {
        exportToCsv(
          'KMFRI_Authorized_Research_Outputs',
          rows.length ? rows : [{ Notice: '0 Records' }]
        );
      } else if (format === 'xlsx') {
        exportToExcel('KMFRI_Authorized_Research_Outputs', 'Outputs', rows);
      } else {
        setExportingType('outputs_pdf');
        await exportServerPdf({
          type: 'outputs_summary',
          user: currentUser,
          db,
          filename: `KMFRI_Research_Outputs_Summary_${new Date().toISOString().slice(0, 10)}.pdf`,
        });
      }

      const next = appendAuditLog(
        db,
        currentUser,
        `DATA_EXPORT_OUTPUTS_${format.toUpperCase()}`,
        'research_outputs',
        'batch-export',
        null,
        { format, engine: format === 'pdf' ? 'server-pdfkit' : 'client', record_count: exportOutputs.length }
      );
      onUpdateDb(next);
      setAlertMsg({
        type: 'ok',
        text: `Exported ${exportOutputs.length} authorized research output(s) as ${format.toUpperCase()} respecting your ${currentUserRole} permissions.`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Export failed.',
      });
    } finally {
      setExportingType(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Server-Side PDFKit Dossiers &amp; Institutional Data Exports
          </h1>
          <p className="text-xs text-slate-500">
            Generates formatted PDFs on the backend server via PDFKit (`POST /api/exports/pdf`),
            enforcing your role and directorate access policies (`{currentUserRole}` ·{' '}
            {currentUserDir ? currentUserDir.code : 'Institution-Wide'}).
          </p>
        </div>
        <span className="px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-xs font-mono font-bold text-[#159A9C] shrink-0">
          RBAC Scope: {currentUserDir ? `${currentUserDir.code} Directorate` : 'All 4 Directorates'}
        </span>
      </div>

      {alertMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            alertMsg.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {alertMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{alertMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              1. Research Projects Summary ({exportProjects.length} Authorized)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Server-rendered PDF dossier with KMFRI header, KPI metrics, project codes, budgets,
              investigators, objectives, and milestone schedules.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportingType === 'projects_pdf'}
              onClick={() => handleLogAndExportProjects('pdf')}
              className="px-3.5 py-2 bg-[#173B75] hover:bg-[#3155A4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>
                {exportingType === 'projects_pdf' ? 'Generating PDF...' : 'Server PDF Dossier'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleLogAndExportProjects('xlsx')}
              className="px-3 py-2 bg-[#16866B] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={() => handleLogAndExportProjects('csv')}
              className="px-3 py-2 border border-slate-300 dark:border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              2. Research Outputs &amp; Publications ({exportOutputs.length} Authorized)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Server-rendered bibliographic PDF report including ordered multi-author lists
              (`output_authors`), DOIs, journal venues, and abstracts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportingType === 'outputs_pdf'}
              onClick={() => handleLogAndExportOutputs('pdf')}
              className="px-3.5 py-2 bg-[#173B75] hover:bg-[#3155A4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>
                {exportingType === 'outputs_pdf' ? 'Generating PDF...' : 'Server PDF Summary'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleLogAndExportOutputs('xlsx')}
              className="px-3 py-2 bg-[#16866B] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={() => handleLogAndExportOutputs('csv')}
              className="px-3 py-2 border border-slate-300 dark:border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              3. Comprehensive Directorate &amp; Portfolio PDF
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Combined server-side executive PDF comparing directorate performance alongside all
              authorized projects and research outputs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={exportingType === 'dir_pdf'}
              onClick={async () => {
                try {
                  setExportingType('dir_pdf');
                  setAlertMsg(null);
                  await exportServerPdf({
                    type: 'directorate_summary',
                    user: currentUser,
                    db,
                    filename: `KMFRI_Directorate_Executive_Summary_${new Date()
                      .toISOString()
                      .slice(0, 10)}.pdf`,
                  });
                  const next = appendAuditLog(
                    db,
                    currentUser,
                    'DATA_EXPORT_DIRECTORATE_PDF',
                    'directorates',
                    'executive-summary',
                    null,
                    { engine: 'server-pdfkit' }
                  );
                  onUpdateDb(next);
                  setAlertMsg({
                    type: 'ok',
                    text: 'Comprehensive Directorate & Portfolio PDF generated by server.',
                  });
                } catch (err) {
                  setAlertMsg({
                    type: 'err',
                    text: err instanceof Error ? err.message : 'Server PDF generation failed.',
                  });
                } finally {
                  setExportingType(null);
                }
              }}
              className="px-3.5 py-2 bg-[#159A9C] hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>
                {exportingType === 'dir_pdf'
                  ? 'Generating PDF...'
                  : 'Download Combined Executive PDF'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
