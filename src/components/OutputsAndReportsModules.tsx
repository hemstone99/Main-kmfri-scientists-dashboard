import React, { useState } from 'react';
import {
  DatabaseState,
  User,
  ResearchOutput,
  OutputAuthor,
  OutputType,
  ResearchReport,
  ReportType,
  ManuscriptFigure,
  GroundedCitation,
} from '../types/kmfri.ts';
import {
  generateUuid,
  getDirectorateById,
  getUserById,
  appendAuditLog,
} from '../services/database.ts';
import {
  filterOutputsForUser,
  filterReportsForUser,
  filterProjectsForUser,
} from '../services/rbacPolicy.ts';
import { exportServerPdf } from '../services/exportService.ts';
import {
  BookOpen,
  FileText,
  Send,
  CheckCircle2,
  AlertCircle,
  Users,
  Sparkles,
  ImagePlus,
  Share2,
  PenTool,
  ExternalLink,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react';

interface OutputsAndReportsModulesProps {
  db: DatabaseState;
  currentUser: User;
  mode: 'outputs' | 'reports';
  onUpdateDb: (next: DatabaseState) => void;
  onShareToChat?: (attachment: {
    type: 'document' | 'publication';
    id: string;
    title: string;
    subtitle: string;
  }) => void;
}

export const OutputsAndReportsModules: React.FC<OutputsAndReportsModulesProps> = ({
  db,
  currentUser,
  mode,
  onUpdateDb,
  onShareToChat,
}) => {
  const authorizedProjects = filterProjectsForUser(db, currentUser);
  const visibleOutputs = filterOutputsForUser(db, currentUser);
  const visibleReports = filterReportsForUser(db, currentUser);

  const [alertMsg, setAlertMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pdfExporting, setPdfExporting] = useState<string | null>(null);
  const [studioTab, setStudioTab] = useState<'studio' | 'registry'>('studio');
  const [editingOutputId, setEditingOutputId] = useState<string | null>(null);

  // Publications Authoring Studio State
  const [outTitle, setOutTitle] = useState('');
  const [outType, setOutType] = useState<OutputType>('Journal Article');
  const [outProjectId, setOutProjectId] = useState(authorizedProjects[0]?.id || '');
  const [outJournal, setOutJournal] = useState('');
  const [outDoi, setOutDoi] = useState('');
  const [outPubDate, setOutPubDate] = useState(new Date().toISOString().slice(0, 10));
  const [outKeywords, setOutKeywords] = useState('');
  const [outAbstract, setOutAbstract] = useState('');
  const [manuscriptBody, setManuscriptBody] = useState('');
  const [methodologySection, setMethodologySection] = useState('');
  const [resultsSection, setResultsSection] = useState('');
  const [discussionSection, setDiscussionSection] = useState('');
  const [referencesSection, setReferencesSection] = useState('');
  const [kmfriCoAuthorIds, setKmfriCoAuthorIds] = useState<string[]>([]);
  const [externalCoAuthors, setExternalCoAuthors] = useState('');
  const [figures, setFigures] = useState<ManuscriptFigure[]>([]);
  const [figCaption, setFigCaption] = useState('');
  const [citations, setCitations] = useState<GroundedCitation[]>([]);

  // AI Literature Grounding State
  const [groundingQuery, setGroundingQuery] = useState('');
  const [groundingMode, setGroundingMode] = useState<'citations' | 'draft_section' | 'peer_review'>(
    'citations'
  );
  const [groundingLoading, setGroundingLoading] = useState(false);
  const [groundingResult, setGroundingResult] = useState<{
    synthesis: string;
    sources: { title: string; url: string }[];
  } | null>(null);

  // Report creation state
  const [repTitle, setRepTitle] = useState('');
  const [repType, setRepType] = useState<ReportType>('Project Progress Report');
  const [repProjectId, setRepProjectId] = useState(authorizedProjects[0]?.id || '');
  const [repPeriod, setRepPeriod] = useState('');
  const [repDueDate, setRepDueDate] = useState('');
  const [repFileRef, setRepFileRef] = useState('');

  const handleLoadOutputIntoStudio = (o: ResearchOutput) => {
    setEditingOutputId(o.id);
    setOutTitle(o.title);
    setOutType(o.output_type);
    setOutProjectId(o.project_id || '');
    setOutJournal(o.journal_or_event);
    setOutDoi(o.doi);
    setOutPubDate(o.publication_date);
    setOutKeywords(o.keywords);
    setOutAbstract(o.abstract);
    setManuscriptBody(o.manuscript_body || '');
    setMethodologySection(o.methodology_section || '');
    setResultsSection(o.results_section || '');
    setDiscussionSection(o.discussion_section || '');
    setReferencesSection(o.references_section || '');
    setFigures(o.attached_figures || []);
    setCitations(o.grounded_citations || []);

    const existingAuthors = db.output_authors
      .filter((a) => a.output_id === o.id)
      .sort((a, b) => a.author_order - b.author_order);
    setKmfriCoAuthorIds(
      existingAuthors
        .filter((a) => a.user_id && a.user_id !== o.lead_scientist_id)
        .map((a) => a.user_id as string)
    );
    setExternalCoAuthors(
      existingAuthors
        .filter((a) => a.external_author_name)
        .map((a) => a.external_author_name)
        .join(', ')
    );
    setStudioTab('studio');
  };

  const handleResetStudioForm = () => {
    setEditingOutputId(null);
    setOutTitle('');
    setOutType('Journal Article');
    setOutJournal('');
    setOutDoi('');
    setOutKeywords('');
    setOutAbstract('');
    setManuscriptBody('');
    setMethodologySection('');
    setResultsSection('');
    setDiscussionSection('');
    setReferencesSection('');
    setKmfriCoAuthorIds([]);
    setExternalCoAuthors('');
    setFigures([]);
    setCitations([]);
  };

  const handleAttachFigure = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const newFig: ManuscriptFigure = {
        id: generateUuid(),
        label: `Figure ${figures.length + 1}`,
        caption: figCaption.trim() || file.name.replace(/\.[^/.]+$/, ''),
        data_url: dataUrl,
        mime_type: file.type || 'image/png',
        uploaded_at: new Date().toISOString(),
      };
      setFigures((prev) => [...prev, newFig]);
      setFigCaption('');
    };
    reader.readAsDataURL(file);
  };

  const handleRunAiGrounding = async () => {
    if (!groundingQuery.trim()) {
      setAlertMsg({
        type: 'err',
        text: 'Enter a scientific topic, species, or ecological question to run AI Literature Grounding.',
      });
      return;
    }

    setGroundingLoading(true);
    setAlertMsg(null);
    try {
      const currentDir = getDirectorateById(db, currentUser.directorate_id);
      const response = await fetch('/api/ai/literature-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: groundingQuery.trim(),
          manuscriptTitle: outTitle.trim() || 'KMFRI Scientific Study',
          directorateCode: currentDir?.code || 'KMFRI',
          mode: groundingMode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'AI Literature Grounding request failed.');
      }

      setGroundingResult({
        synthesis: data.synthesis || '',
        sources: data.sources || [],
      });
    } catch (err) {
      setAlertMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to connect to AI Literature Grounding.',
      });
    } finally {
      setGroundingLoading(false);
    }
  };

  const handleSaveManuscript = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);

    if (!outTitle.trim()) {
      setAlertMsg({ type: 'err', text: 'Manuscript / Publication title is required.' });
      return;
    }

    const doiClean = outDoi.trim();
    if (
      doiClean !== '' &&
      db.research_outputs.some(
        (o) =>
          o.id !== editingOutputId &&
          o.doi &&
          o.doi.toLowerCase() === doiClean.toLowerCase()
      )
    ) {
      setAlertMsg({
        type: 'err',
        text: `Unique DOI violation: A research output with DOI "${doiClean}" already exists in the repository.`,
      });
      return;
    }

    const now = new Date().toISOString();
    const dirId =
      currentUser.directorate_id ||
      authorizedProjects.find((p) => p.id === outProjectId)?.directorate_id ||
      db.directorates[0].id;

    const outputId = editingOutputId || generateUuid();
    const existingOutput = db.research_outputs.find((o) => o.id === editingOutputId);

    const savedOutput: ResearchOutput = {
      id: outputId,
      title: outTitle.trim(),
      output_type: outType,
      project_id: outProjectId || null,
      directorate_id: dirId,
      lead_scientist_id: existingOutput?.lead_scientist_id || currentUser.id,
      journal_or_event: outJournal.trim() || 'KMFRI Scientific Repository',
      doi: doiClean,
      url: doiClean ? `https://doi.org/${doiClean}` : '',
      publication_date: outPubDate || now.slice(0, 10),
      abstract: outAbstract.trim() || outTitle.trim(),
      keywords: outKeywords.trim(),
      attachment_name: `${outTitle.trim().replace(/\s+/g, '_').slice(0, 35)}.pdf`,
      status: existingOutput?.status || 'Draft',
      requires_dg_escalation: outType === 'Policy Brief',
      manuscript_body: manuscriptBody,
      methodology_section: methodologySection,
      results_section: resultsSection,
      discussion_section: discussionSection,
      references_section: referencesSection,
      attached_figures: figures,
      grounded_citations: citations,
      shared_on_platform: existingOutput?.shared_on_platform || false,
      created_at: existingOutput?.created_at || now,
      updated_at: now,
    };

    const authors: OutputAuthor[] = [
      {
        id: generateUuid(),
        output_id: outputId,
        user_id: savedOutput.lead_scientist_id,
        external_author_name: null,
        affiliation: 'Kenya Marine and Fisheries Research Institute (KMFRI)',
        author_order: 1,
      },
    ];

    let orderCounter = 2;
    kmfriCoAuthorIds.forEach((uid) => {
      if (uid !== savedOutput.lead_scientist_id) {
        authors.push({
          id: generateUuid(),
          output_id: outputId,
          user_id: uid,
          external_author_name: null,
          affiliation: 'Kenya Marine and Fisheries Research Institute (KMFRI)',
          author_order: orderCounter++,
        });
      }
    });

    externalCoAuthors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((extName) => {
        authors.push({
          id: generateUuid(),
          output_id: outputId,
          user_id: null,
          external_author_name: extName,
          affiliation: 'External Partner Institution',
          author_order: orderCounter++,
        });
      });

    const filteredOtherOutputs = db.research_outputs.filter((o) => o.id !== outputId);
    const filteredOtherAuthors = db.output_authors.filter((a) => a.output_id !== outputId);

    let nextState: DatabaseState = {
      ...db,
      research_outputs: [savedOutput, ...filteredOtherOutputs],
      output_authors: [...authors, ...filteredOtherAuthors],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      editingOutputId ? 'MANUSCRIPT_UPDATED_IN_STUDIO' : 'MANUSCRIPT_AUTHORED_IN_STUDIO',
      'research_outputs',
      outputId,
      null,
      {
        title: savedOutput.title,
        doi: savedOutput.doi,
        author_count: authors.length,
        figures_count: figures.length,
      }
    );

    onUpdateDb(nextState);
    setEditingOutputId(outputId);
    setAlertMsg({
      type: 'ok',
      text: `Manuscript "${savedOutput.title}" saved in Publications Authoring Studio with ${authors.length} co-author(s) and ${figures.length} figure(s).`,
    });
  };

  const handleSharePublicationAcrossPlatform = (output: ResearchOutput) => {
    const now = new Date().toISOString();
    const updated: ResearchOutput = {
      ...output,
      shared_on_platform: true,
      updated_at: now,
    };

    // Notify all active scientists across the platform
    const broadcastNotifications = db.users
      .filter((u) => u.id !== currentUser.id)
      .map((u) => ({
        id: generateUuid(),
        user_id: u.id,
        title: `Shared Publication: ${output.title}`,
        message: `${currentUser.full_name} shared "${output.title}" (${output.output_type}) across the KMFRI Research Platform.`,
        type: 'submission' as const,
        related_module: 'outputs',
        related_entity_id: output.id,
        read_at: null,
        created_at: now,
      }));

    let nextState: DatabaseState = {
      ...db,
      research_outputs: db.research_outputs.map((o) => (o.id === output.id ? updated : o)),
      notifications: [...broadcastNotifications, ...db.notifications],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'PUBLICATION_SHARED_ACROSS_PLATFORM',
      'research_outputs',
      output.id,
      null,
      { title: output.title }
    );

    onUpdateDb(nextState);

    if (onShareToChat) {
      onShareToChat({
        type: 'publication',
        id: output.id,
        title: output.title,
        subtitle: `${output.output_type} · DOI: ${output.doi || 'Pending'} · Shared by ${currentUser.full_name}`,
      });
    }

    setAlertMsg({
      type: 'ok',
      text: `Publication "${output.title}" shared across the platform and posted to Live Team Chat!`,
    });
  };

  const handleExportOutputsServerPdf = async (
    exportType: 'outputs_summary' | 'single_output',
    targetOutput?: ResearchOutput
  ) => {
    const key = targetOutput ? targetOutput.id : 'summary';
    setPdfExporting(key);
    setAlertMsg(null);
    try {
      await exportServerPdf({
        type: exportType,
        user: currentUser,
        db,
        targetId: targetOutput?.id,
        filename: targetOutput
          ? `KMFRI_Publication_${targetOutput.id.slice(0, 8)}.pdf`
          : `KMFRI_Research_Outputs_Summary_${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      const next = appendAuditLog(
        db,
        currentUser,
        exportType === 'single_output'
          ? 'SERVER_PDF_EXPORT_SINGLE_OUTPUT'
          : 'SERVER_PDF_EXPORT_OUTPUTS_SUMMARY',
        'research_outputs',
        targetOutput ? targetOutput.id : 'batch-outputs',
        null,
        {
          format: 'server-pdfkit',
          output_count: targetOutput ? 1 : visibleOutputs.length,
        }
      );
      onUpdateDb(next);
      setAlertMsg({
        type: 'ok',
        text: targetOutput
          ? `Server-side PDF summary for "${targetOutput.title}" downloaded.`
          : `Server-side PDF summary for ${visibleOutputs.length} authorized research output(s) downloaded.`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Server PDF generation failed.',
      });
    } finally {
      setPdfExporting(null);
    }
  };

  const handleSubmitOutput = (output: ResearchOutput) => {
    const now = new Date().toISOString();
    const updated: ResearchOutput = { ...output, status: 'Submitted', updated_at: now };
    const approvalEntry = {
      id: generateUuid(),
      entity_type: 'output' as const,
      entity_id: output.id,
      entity_title: output.title,
      directorate_id: output.directorate_id,
      submitted_by: currentUser.id,
      reviewer_id: null,
      reviewer_role: null,
      decision: 'Submitted' as const,
      comments: 'Research output submitted for Directorate clearance.',
      workflow_stage: 'Directorate Review Queue',
      previous_state: output.status,
      new_state: 'Submitted',
      decided_at: now,
      created_at: now,
    };

    let nextState = {
      ...db,
      research_outputs: db.research_outputs.map((o) => (o.id === output.id ? updated : o)),
      approvals: [approvalEntry, ...db.approvals],
    };
    nextState = appendAuditLog(
      nextState,
      currentUser,
      'RESEARCH_OUTPUT_SUBMITTED',
      'research_outputs',
      output.id,
      { status: output.status },
      { status: 'Submitted' }
    );
    onUpdateDb(nextState);
    setAlertMsg({ type: 'ok', text: `Output "${output.title}" submitted for review.` });
  };

  const handleCreateReport = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);
    const proj = db.projects.find((p) => p.id === repProjectId) || authorizedProjects[0];
    if (!proj) {
      setAlertMsg({
        type: 'err',
        text: 'Create a Research Project first before filing a project report.',
      });
      return;
    }

    const now = new Date().toISOString();
    const report: ResearchReport = {
      id: generateUuid(),
      project_id: proj.id,
      scientist_id: currentUser.id,
      directorate_id: proj.directorate_id,
      title: repTitle.trim(),
      report_type: repType,
      reporting_period: repPeriod.trim(),
      submission_date: now.slice(0, 10),
      due_date: repDueDate,
      status: 'Submitted',
      reviewer_id: null,
      review_comments: '',
      approval_date: null,
      file_reference: repFileRef.trim(),
      version: 1,
      created_at: now,
      updated_at: now,
    };

    const approvalEntry = {
      id: generateUuid(),
      entity_type: 'report' as const,
      entity_id: report.id,
      entity_title: report.title,
      directorate_id: report.directorate_id,
      submitted_by: currentUser.id,
      reviewer_id: null,
      reviewer_role: null,
      decision: 'Submitted' as const,
      comments: 'Periodic report submitted for review.',
      workflow_stage: 'Directorate Review Queue',
      previous_state: 'Draft',
      new_state: 'Submitted',
      decided_at: now,
      created_at: now,
    };

    let nextState: DatabaseState = {
      ...db,
      reports: [report, ...db.reports],
      approvals: [approvalEntry, ...db.approvals],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'REPORT_SUBMITTED',
      'reports',
      report.id,
      null,
      { title: report.title, report_type: report.report_type, due_date: report.due_date }
    );

    onUpdateDb(nextState);
    setRepTitle('');
    setAlertMsg({ type: 'ok', text: `Report "${report.title}" submitted for review.` });
  };

  if (mode === 'outputs') {
    return (
      <div className="space-y-6">
        {/* Top Banner & Studio / Registry Switcher */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#159A9C] font-semibold mb-1">
              <PenTool className="w-3.5 h-3.5" />
              <span>KMFRI Scientific Publishing &amp; Co-Authoring Environment</span>
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Publications Authoring Studio, Research Outputs &amp; Datasets ({visibleOutputs.length})
            </h1>
            <p className="text-xs text-slate-500">
              Write and co-author full scientific manuscripts, attach figures, use AI literature
              grounding, and share publications across the platform.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setStudioTab('studio')}
                className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 cursor-pointer ${
                  studioTab === 'studio'
                    ? 'bg-[#173B75] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>Authoring Studio</span>
              </button>
              <button
                type="button"
                onClick={() => setStudioTab('registry')}
                className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 cursor-pointer ${
                  studioTab === 'registry'
                    ? 'bg-[#173B75] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Publications Repository ({visibleOutputs.length})</span>
              </button>
            </div>

            <button
              type="button"
              disabled={pdfExporting === 'summary'}
              onClick={() => handleExportOutputsServerPdf('outputs_summary')}
              className="px-3.5 py-2 bg-[#159A9C] hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>
                {pdfExporting === 'summary'
                  ? 'Generating Server PDF...'
                  : 'Export Outputs Summary PDF'}
              </span>
            </button>
          </div>
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

        {studioTab === 'studio' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Columns: Full Scientific Manuscript Authoring Canvas */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {editingOutputId
                      ? 'Co-Authoring Active Manuscript'
                      : 'Compose New Scientific Manuscript / Dataset'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Lead Author: <strong>{currentUser.full_name}</strong> ({currentUser.staff_number})
                  </p>
                </div>
                {editingOutputId && (
                  <button
                    type="button"
                    onClick={handleResetStudioForm}
                    className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    + New Blank Manuscript
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveManuscript} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1">
                    Manuscript / Publication / Dataset Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter full scientific manuscript or dataset title..."
                    value={outTitle}
                    onChange={(e) => setOutTitle(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Publication Category</label>
                    <select
                      value={outType}
                      onChange={(e) => setOutType(e.target.value as OutputType)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      <option value="Journal Article">Journal Article</option>
                      <option value="Research Dataset">Research Dataset</option>
                      <option value="Policy Brief">Policy Brief</option>
                      <option value="Technical & Scientific Report">Technical &amp; Scientific Report</option>
                      <option value="Conference Paper / Presentation">Conference Paper</option>
                      <option value="Book / Chapter">Book / Chapter</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Linked Research Project</label>
                    <select
                      value={outProjectId}
                      onChange={(e) => setOutProjectId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      <option value="">Independent Institutional Study</option>
                      {authorizedProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.project_code} — {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Unique DOI (Optional)</label>
                    <input
                      type="text"
                      placeholder="10.4314/wiojms..."
                      value={outDoi}
                      onChange={(e) => setOutDoi(e.target.value)}
                      className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">
                      Target Journal, Conference, or Data Repository
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Western Indian Ocean Journal of Marine Science"
                      value={outJournal}
                      onChange={(e) => setOutJournal(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Keywords (Comma-separated)</label>
                    <input
                      type="text"
                      placeholder="e.g. Blue Carbon, Coral Reef Resilience, Stock Assessment"
                      value={outKeywords}
                      onChange={(e) => setOutKeywords(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Co-Author Selection */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#159A9C]" />
                    <span>Co-Authors &amp; Multi-Institutional Attribution</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">
                        Add KMFRI Scientist Co-Authors
                      </label>
                      <select
                        value=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val && !kmfriCoAuthorIds.includes(val)) {
                            setKmfriCoAuthorIds([...kmfriCoAuthorIds, val]);
                          }
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <option value="">-- Select KMFRI Researcher --</option>
                        {db.users
                          .filter((u) => u.id !== currentUser.id)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name} ({u.staff_number})
                            </option>
                          ))}
                      </select>
                      {kmfriCoAuthorIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {kmfriCoAuthorIds.map((id) => {
                            const u = getUserById(db, id);
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 text-[#159A9C] font-semibold text-[11px]"
                              >
                                <span>{u?.full_name}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setKmfriCoAuthorIds(kmfriCoAuthorIds.filter((x) => x !== id))
                                  }
                                  className="text-red-500 hover:text-red-700 cursor-pointer"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">
                        External Co-Authors (Comma-separated)
                      </label>
                      <input
                        type="text"
                        placeholder="Prof. A. Ochieng (UoN), Dr. S. Mwangi (WIOMSA)"
                        value={externalCoAuthors}
                        onChange={(e) => setExternalCoAuthors(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  </div>
                </div>

                {/* Abstract & Manuscript Sections */}
                <div>
                  <label className="block font-semibold mb-1">Structured Abstract</label>
                  <textarea
                    rows={3}
                    placeholder="Background, Objectives, Methods, Principal Findings, and Conclusions..."
                    value={outAbstract}
                    onChange={(e) => setOutAbstract(e.target.value)}
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">
                    Full Manuscript Text (Introduction, Methodology, Results &amp; Discussion)
                  </label>
                  <textarea
                    rows={9}
                    placeholder="Write or co-author your full scientific manuscript here, or insert grounded literature paragraphs from the AI Literature Grounding Assistant on the right..."
                    value={manuscriptBody}
                    onChange={(e) => setManuscriptBody(e.target.value)}
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 leading-relaxed font-sans"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">
                    References &amp; Grounded Literature Citations
                  </label>
                  <textarea
                    rows={3}
                    placeholder="APA / Harvard formatted bibliography and grounded DOIs..."
                    value={referencesSection}
                    onChange={(e) => setReferencesSection(e.target.value)}
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                  />
                </div>

                {/* Attached Figures & Scientific Imagery */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <ImagePlus className="w-4 h-4 text-[#159A9C]" />
                      <span>Attached Scientific Figures, Charts &amp; Plates ({figures.length})</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      placeholder="Figure caption (e.g. Bathymetric profile of Tudor Creek)"
                      value={figCaption}
                      onChange={(e) => setFigCaption(e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <label className="px-3 py-1.5 rounded-lg bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>Upload Figure / Chart Image</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAttachFigure}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {figures.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                      {figures.map((fig) => (
                        <div
                          key={fig.id}
                          className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1.5"
                        >
                          <img
                            src={fig.data_url}
                            alt={fig.caption}
                            className="w-full h-24 object-cover rounded"
                          />
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] font-bold text-[#159A9C]">
                              {fig.label}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setFigures((prev) => prev.filter((f) => f.id !== fig.id))
                              }
                              className="text-red-500 hover:text-red-700 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                            {fig.caption}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold rounded-lg cursor-pointer transition-colors"
                  >
                    {editingOutputId ? 'Save Manuscript Changes' : 'Save Manuscript to Repository'}
                  </button>

                  {editingOutputId && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const found = db.research_outputs.find((o) => o.id === editingOutputId);
                          if (found) handleSharePublicationAcrossPlatform(found);
                        }}
                        className="px-4 py-2.5 bg-[#159A9C] hover:bg-teal-700 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Share Publication Across Platform</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const found = db.research_outputs.find((o) => o.id === editingOutputId);
                          if (found) handleExportOutputsServerPdf('single_output', found);
                        }}
                        className="px-4 py-2.5 border border-slate-300 dark:border-slate-700 font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Export Manuscript PDF</span>
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>

            {/* Right 5 Columns: AI Literature Grounding & Quick Manuscript Switcher */}
            <div className="lg:col-span-5 space-y-6">
              {/* AI Literature Grounding Panel */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#159A9C]" />
                      <span>AI Scientific Literature Grounding</span>
                    </h2>
                    <p className="text-xs text-slate-500">
                      Search real peer-reviewed marine, fisheries, and limnological studies with
                      live web grounding and insert citations directly.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { id: 'citations', label: 'Find Grounded Citations' },
                        { id: 'draft_section', label: 'Draft Prose Section' },
                        { id: 'peer_review', label: 'Peer-Review Critique' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setGroundingMode(m.id)}
                        className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                          groundingMode === m.id
                            ? 'bg-[#173B75] text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={3}
                    placeholder="Enter research topic or hypothesis (e.g. 'Mangrove carbon sequestration in Gazi Bay and Western Indian Ocean' or 'Lake Victoria Nile perch stock dynamics')..."
                    value={groundingQuery}
                    onChange={(e) => setGroundingQuery(e.target.value)}
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />

                  <button
                    type="button"
                    disabled={groundingLoading}
                    onClick={handleRunAiGrounding}
                    className="w-full py-2.5 px-4 bg-[#159A9C] hover:bg-teal-700 disabled:opacity-50 text-white font-semibold rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {groundingLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Searching &amp; Grounding Scientific Literature...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Run Grounded Literature Synthesis</span>
                      </>
                    )}
                  </button>

                  {groundingResult && (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-white">
                          Grounded Synthesis Result
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setManuscriptBody((prev) =>
                                prev ? `${prev}\n\n${groundingResult.synthesis}` : groundingResult.synthesis
                              );
                              setAlertMsg({
                                type: 'ok',
                                text: 'Grounded synthesis inserted into Manuscript Body.',
                              });
                            }}
                            className="px-2 py-1 rounded bg-[#173B75] text-white text-[11px] font-semibold cursor-pointer"
                          >
                            + Insert into Manuscript
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const formattedSources = groundingResult.sources
                                .map((s, idx) => `[${idx + 1}] ${s.title} — ${s.url}`)
                                .join('\n');
                              setReferencesSection((prev) =>
                                prev
                                  ? `${prev}\n${formattedSources || groundingResult.synthesis}`
                                  : formattedSources || groundingResult.synthesis
                              );
                              setAlertMsg({
                                type: 'ok',
                                text: 'Grounded citations appended to References section.',
                              });
                            }}
                            className="px-2 py-1 rounded bg-[#16866B] text-white text-[11px] font-semibold cursor-pointer"
                          >
                            + Add to References
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                        {groundingResult.synthesis}
                      </div>

                      {groundingResult.sources.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                          <span className="text-[11px] font-bold text-slate-500 block">
                            Verified Grounding Web Sources ({groundingResult.sources.length}):
                          </span>
                          {groundingResult.sources.map((src, i) => (
                            <a
                              key={i}
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between gap-2 p-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-[#173B75] dark:text-sky-400 hover:underline"
                            >
                              <span className="truncate">{src.title}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick List of Existing Manuscripts to Load & Co-Author */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 shadow-xs">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Recent Manuscripts &amp; Outputs ({visibleOutputs.length}) — Click to Co-Author
                </h3>
                {visibleOutputs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    No manuscripts saved yet. Compose your first manuscript on the left.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {visibleOutputs.map((o) => {
                      const dir = getDirectorateById(db, o.directorate_id);
                      return (
                        <div
                          key={o.id}
                          className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-[#159A9C] flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-white truncate">
                              {o.title}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {dir?.code} · {o.output_type} · {o.status}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleLoadOutputIntoStudio(o)}
                              className="px-2.5 py-1 rounded bg-[#173B75] text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSharePublicationAcrossPlatform(o)}
                              title="Share across platform"
                              className="p-1.5 rounded border border-slate-300 dark:border-slate-700 hover:border-[#159A9C] text-[#159A9C] cursor-pointer"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Registry View */
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                Registered Research Outputs, Manuscripts &amp; Author Order
              </h2>
              <button
                type="button"
                onClick={() => {
                  handleResetStudioForm();
                  setStudioTab('studio');
                }}
                className="px-3 py-1.5 rounded-lg bg-[#173B75] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Write New Manuscript</span>
              </button>
            </div>
            {visibleOutputs.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                Zero publications or research outputs recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleOutputs.map((o) => {
                  const authors = db.output_authors
                    .filter((a) => a.output_id === o.id)
                    .sort((a, b) => a.author_order - b.author_order);
                  const dir = getDirectorateById(db, o.directorate_id);
                  return (
                    <div key={o.id} className="p-5 text-xs space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[#159A9C] font-bold">
                          {o.output_type} · {dir?.code} · DOI: {o.doi || 'Pending'}
                        </span>
                        <div className="flex items-center gap-2">
                          {o.shared_on_platform && (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                              Shared on Platform
                            </span>
                          )}
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {o.status}
                          </span>
                        </div>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{o.title}</h3>
                      <p className="text-slate-600 dark:text-slate-400">{o.abstract}</p>

                      {o.attached_figures && o.attached_figures.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {o.attached_figures.map((fig) => (
                            <div
                              key={fig.id}
                              className="flex items-center gap-2 p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                            >
                              <img
                                src={fig.data_url}
                                alt={fig.caption}
                                className="w-10 h-10 object-cover rounded"
                              />
                              <div>
                                <div className="font-mono text-[10px] font-bold">{fig.label}</div>
                                <div className="text-[11px] text-slate-500">{fig.caption}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 pt-1">
                        <Users className="w-3.5 h-3.5 text-teal-600" />
                        <span>
                          Authors in Order:{' '}
                          {authors
                            .map((a) => {
                              const u = getUserById(db, a.user_id);
                              return `[${a.author_order}] ${u ? u.full_name : a.external_author_name}`;
                            })
                            .join(' · ')}
                        </span>
                      </div>
                      <div className="pt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleLoadOutputIntoStudio(o)}
                          className="px-3 py-1 bg-[#0A2540] text-white text-xs font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer"
                        >
                          <PenTool className="w-3 h-3" />
                          <span>Open in Authoring Studio</span>
                        </button>
                        <button
                          type="button"
                          disabled={pdfExporting === o.id}
                          onClick={() => handleExportOutputsServerPdf('single_output', o)}
                          className="px-3 py-1 bg-[#173B75] hover:bg-[#3155A4] disabled:opacity-50 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileText className="w-3 h-3" />
                          <span>
                            {pdfExporting === o.id ? 'Generating...' : 'Export Output Summary PDF'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSharePublicationAcrossPlatform(o)}
                          className="px-3 py-1 bg-[#159A9C] hover:bg-teal-700 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Share2 className="w-3 h-3" />
                          <span>Share Across Platform</span>
                        </button>
                        {o.status === 'Draft' && o.lead_scientist_id === currentUser.id && (
                          <button
                            type="button"
                            onClick={() => handleSubmitOutput(o)}
                            className="px-3 py-1 bg-emerald-700 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Send className="w-3 h-3" />
                            <span>Submit for Approval</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
          Reporting &amp; Deadline Management ({visibleReports.length} Reports)
        </h1>
        <p className="text-xs text-slate-500">
          Submit progress, annual, technical, fieldwork, and financial reports with deadline alerts.
        </p>
      </div>

      {alertMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            alertMsg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {alertMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600" />
          )}
          <span>{alertMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
            Submit Project or Institutional Report
          </h2>
          <form onSubmit={handleCreateReport} className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Linked Project</label>
              <select
                value={repProjectId}
                onChange={(e) => setRepProjectId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white dark:bg-slate-800"
              >
                {authorizedProjects.length === 0 ? (
                  <option value="">-- Create a Project First --</option>
                ) : (
                  authorizedProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_code} — {p.title}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Report Title</label>
              <input
                type="text"
                required
                placeholder="e.g. Q3 Hydro-Ecological Progress Report"
                value={repTitle}
                onChange={(e) => setRepTitle(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Report Category</label>
                <select
                  value={repType}
                  onChange={(e) => setRepType(e.target.value as ReportType)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                >
                  <option value="Project Progress Report">Project Progress Report</option>
                  <option value="Annual Research Report">Annual Research Report</option>
                  <option value="Technical Report">Technical Report</option>
                  <option value="Fieldwork Report">Fieldwork Report</option>
                  <option value="Financial Report">Financial Report</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Reporting Period</label>
                <input
                  type="text"
                  value={repPeriod}
                  onChange={(e) => setRepPeriod(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Statutory Due Date</label>
                <input
                  type="date"
                  value={repDueDate}
                  onChange={(e) => setRepDueDate(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Document Reference</label>
                <input
                  type="text"
                  value={repFileRef}
                  onChange={(e) => setRepFileRef(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-2 px-4 bg-[#0A2540] text-white font-semibold rounded-lg cursor-pointer"
            >
              Submit Report to Workflow Queue
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xs font-bold text-slate-900 dark:text-white">
              Report Submissions &amp; Statutory Deadlines
            </h2>
          </div>
          {visibleReports.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              Zero reports filed yet. Submit a report on the left to track review turnaround.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-4">Report Title &amp; Type</th>
                    <th className="py-2.5 px-4">Period</th>
                    <th className="py-2.5 px-4">Due Date</th>
                    <th className="py-2.5 px-4">Version</th>
                    <th className="py-2.5 px-4">Workflow Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {visibleReports.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{r.title}</div>
                        <div className="text-[11px] text-slate-500">{r.report_type}</div>
                      </td>
                      <td className="py-2.5 px-4">{r.reporting_period}</td>
                      <td className="py-2.5 px-4 font-mono">{r.due_date}</td>
                      <td className="py-2.5 px-4 font-mono">v{r.version}</td>
                      <td className="py-2.5 px-4 font-semibold">{r.status}</td>
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
};
