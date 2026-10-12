import React, { useState, useEffect, useRef } from 'react';
import {
  DatabaseState,
  User,
  DocumentRecord,
  DocumentVersionEntry,
  ChatMessageItem,
} from '../types/kmfri.ts';
import {
  generateUuid,
  getDirectorateById,
  appendAuditLog,
} from '../services/database.ts';
import {
  canViewResearcherProfile,
  filterDocumentsForUser,
  filterProjectsForUser,
  getUserRoleName,
} from '../services/rbacPolicy.ts';
import {
  FolderKanban,
  FileText,
  Lock,
  Unlock,
  History,
  MessageSquare,
  Send,
  Share2,
  Plus,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Users,
  Save,
  Upload,
  Eye,
  RotateCcw,
  Sparkles,
  BookOpen,
  FolderOpen,
  Search,
  Download,
} from 'lucide-react';

interface SharePointCollaborationHubProps {
  db: DatabaseState;
  currentUser: User;
  onUpdateDb: (next: DatabaseState) => void;
  initialSharedAttachment?: {
    type: 'document' | 'publication';
    id: string;
    title: string;
    subtitle: string;
  } | null;
  onClearSharedAttachment?: () => void;
  initialTab?: 'drive' | 'word_studio' | 'imagery';
  initialDocumentId?: string | null;
  openCreateInitially?: boolean;
  onClearInitialCreate?: () => void;
}

const DEFAULT_LIBRARIES = [
  'Marine & Coastal Manuscripts',
  'Oceanographic Cruise SOPs',
  'Freshwater Stock Assessments',
  'Aquaculture Genetics Protocols',
  'Research Imagery & Bathymetry',
];

const INITIAL_CHAT_STORAGE_KEY = 'kmfri_sharepoint_live_chat_v1';

export const SharePointCollaborationHub: React.FC<SharePointCollaborationHubProps> = ({
  db,
  currentUser,
  onUpdateDb,
  initialSharedAttachment,
  onClearSharedAttachment,
  initialTab = 'drive',
  initialDocumentId,
  openCreateInitially = false,
  onClearInitialCreate,
}) => {
  const roleName = getUserRoleName(db, currentUser);
  const currentDir = getDirectorateById(db, currentUser.directorate_id);
  const visibleDocuments = filterDocumentsForUser(db, currentUser);
  const authorizedProjects = filterProjectsForUser(db, currentUser);
  const visibleUsers = db.users.filter((user) => canViewResearcherProfile(db, currentUser, user));

  const [activeTab, setActiveTab] = useState<'drive' | 'word_studio' | 'imagery'>(initialTab);
  const [selectedLibrary, setSelectedLibrary] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Currently active document in Word Co-Authoring Studio
  const [activeDocId, setActiveDocId] = useState<string>(
    visibleDocuments.some((document) => document.id === initialDocumentId)
      ? initialDocumentId || ''
      : visibleDocuments[0]?.id || ''
  );
  const activeDoc = visibleDocuments.find((d) => d.id === activeDocId) || visibleDocuments[0] || null;

  // Word Studio Editor state
  const [editorTitle, setEditorTitle] = useState(activeDoc?.title || '');
  const [editorContent, setEditorContent] = useState(
    activeDoc?.word_content ||
      `# ${activeDoc?.title || 'KMFRI Collaborative Research Document'}\n\n## 1. Executive Summary & Institutional Context\nThis collaborative research document is maintained in the KMFRI SharePoint & Word Studio Hub. Authorised scientists can check out this file for exclusive locking or co-author in real time with automatic version tracking.\n\n## 2. Methodology & Field Observations\n- Sampling Station: Mombasa Headquarters / RV Mtafiti\n- Quality Assurance: ISO/IEC 17025 Marine Analytical Standard\n\n## 3. Preliminary Findings & Synthesis\nEnter collaborative scientific findings, tables, and policy recommendations here...`
  );
  const [versionComment, setVersionComment] = useState('');
  const [versionBumpType, setVersionBumpType] = useState<'minor' | 'major'>('minor');
  const [selectedCoAuthors, setSelectedCoAuthors] = useState<string[]>(
    activeDoc?.co_authors || [currentUser.id]
  );

  // New Document / Upload modal state
  const [showNewDocModal, setShowNewDocModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocCategory, setNewDocCategory] = useState<DocumentRecord['category']>('Technical');
  const [newDocLibrary, setNewDocLibrary] = useState(DEFAULT_LIBRARIES[0]);
  const [newDocProjectId, setNewDocProjectId] = useState(authorizedProjects[0]?.id || '');
  const [newDocIsImage, setNewDocIsImage] = useState(false);
  const [newDocImageUrl, setNewDocImageUrl] = useState('');

  // Live Team Chat state (persisted in localStorage + synchronized via WebSocket)
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>(() => {
    try {
      const raw = localStorage.getItem(INITIAL_CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return [
      {
        id: 'welcome-msg-1',
        sender_id: 'system',
        sender_name: 'KMFRI Collaboration Hub',
        sender_role: 'Institutional Workspace',
        sender_directorate: 'HQ',
        message:
          'Welcome to the KMFRI SharePoint & Word Collaboration Hub. Check out documents to prevent edit conflicts, co-author manuscripts in Word Studio, and share documents or publications directly with your team.',
        created_at: new Date().toISOString(),
      },
    ];
  });
  const [chatInput, setChatInput] = useState('');
  const [onlinePeers, setOnlinePeers] = useState<number>(1);
  const wsRef = useRef<WebSocket | null>(null);
  const visibleChatMessages = roleName === 'scientist'
    ? chatMessages.filter((message) => message.sender_id === currentUser.id)
    : chatMessages;

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (openCreateInitially) {
      setShowNewDocModal(true);
      onClearInitialCreate?.();
    }
  }, [openCreateInitially, onClearInitialCreate]);

  useEffect(() => {
    if (initialDocumentId && visibleDocuments.some((document) => document.id === initialDocumentId)) {
      setActiveDocId(initialDocumentId);
      setActiveTab('word_studio');
    }
  }, [initialDocumentId, visibleDocuments]);

  // Sync Word Studio editor when activeDocId changes
  useEffect(() => {
    if (activeDoc) {
      setEditorTitle(activeDoc.title);
      setEditorContent(
        activeDoc.word_content ||
          `# ${activeDoc.title}\n\n## 1. Executive Summary\nCollaborative scientific document managed under ${
            getDirectorateById(db, activeDoc.directorate_id)?.name || 'KMFRI Headquarters'
          }.\n\n## 2. Technical Observations & Data Notes\nAdd structured findings, analytical notes, and co-author commentary below.`
      );
      setSelectedCoAuthors(activeDoc.co_authors || [activeDoc.uploaded_by]);
    }
  }, [activeDocId, activeDoc?.id]);

  // Handle incoming shared attachment from Publications Studio
  useEffect(() => {
    if (initialSharedAttachment) {
      const msg: ChatMessageItem = {
        id: generateUuid(),
        sender_id: currentUser.id,
        sender_name: currentUser.full_name,
        sender_role: roleName,
        sender_directorate: currentDir?.code || 'HQ',
        message: `Shared a ${initialSharedAttachment.type} with the research team: "${initialSharedAttachment.title}"`,
        shared_attachment: initialSharedAttachment,
        created_at: new Date().toISOString(),
      };
      appendChatMessage(msg, true);
      onClearSharedAttachment?.();
    }
  }, [initialSharedAttachment]);

  // Connect to WebSocket `/ws/collaboration` for real-time team chat & co-authoring updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/collaboration`;
    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setOnlinePeers((p) => Math.max(1, p));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (
            (data.type === 'chat:message' || data.type === 'CHAT_MESSAGE') &&
            (data.message || data.payload)
          ) {
            const payload = data.message || data.payload;
            // Only surface messages from the current user's own directorate
            // (or institution-wide senders), so scientists never see another
            // directorate's research chatter.
            const senderDir = payload.sender_directorate || payload.directorate || 'HQ';
            const userDir = currentDir?.code || 'HQ';
            if (senderDir !== userDir && senderDir !== 'HQ') return;
            setChatMessages((prev) => {
              if (prev.some((m) => m.id === payload.id)) return prev;
              const updated = [...prev, payload];
              try {
                localStorage.setItem(INITIAL_CHAT_STORAGE_KEY, JSON.stringify(updated.slice(-80)));
              } catch {
                // ignore
              }
              return updated;
            });
          } else if (
            (data.type === 'document:sync' || data.type === 'DOC_COAUTHOR_UPDATE') &&
            data.payload
          ) {
            const { docId, content, updatedBy } = data.payload;
            if (docId === activeDocId && updatedBy !== currentUser.id) {
              setEditorContent(content);
            }
          }
        } catch {
          // ignore malformed ws message
        }
      };
    } catch {
      // fallback to local state if WebSocket is unavailable
    }

    return () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [activeDocId, currentUser.id]);

  const appendChatMessage = (msg: ChatMessageItem, broadcast = true) => {
    setChatMessages((prev) => {
      const next = [...prev, msg];
      try {
        localStorage.setItem(INITIAL_CHAT_STORAGE_KEY, JSON.stringify(next.slice(-80)));
      } catch {
        // ignore
      }
      return next;
    });

    if (broadcast && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'CHAT_MESSAGE',
          payload: msg,
        })
      );
    }
  };

  // Filter documents by library and search query
  const filteredDocs = visibleDocuments.filter((doc) => {
    if (selectedLibrary !== 'ALL' && (doc.library_folder || DEFAULT_LIBRARIES[0]) !== selectedLibrary) {
      return false;
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.file_name.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q) ||
        (doc.checked_out_by_name && doc.checked_out_by_name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const imageryDocs = visibleDocuments.filter(
    (d) =>
      d.category === 'Imagery' ||
      d.mime_type.startsWith('image/') ||
      Boolean(d.image_preview_url)
  );

  // SharePoint Check-Out / Check-In Locking
  const handleToggleCheckOutLock = (doc: DocumentRecord) => {
    setFeedback(null);
    const isLockedByOther =
      doc.checked_out_by &&
      doc.checked_out_by !== currentUser.id &&
      roleName !== 'system_admin';

    if (isLockedByOther) {
      setFeedback({
        type: 'err',
        text: `Document Lock Conflict: "${doc.title}" is currently checked out by ${doc.checked_out_by_name}. Only ${doc.checked_out_by_name} or the System Administrator can check it back in.`,
      });
      return;
    }

    const now = new Date().toISOString();
    const isCheckingOut = !doc.checked_out_by;

    const updatedDoc: DocumentRecord = {
      ...doc,
      checked_out_by: isCheckingOut ? currentUser.id : null,
      checked_out_by_name: isCheckingOut ? currentUser.full_name : null,
      checked_out_at: isCheckingOut ? now : null,
    };

    let nextState: DatabaseState = {
      ...db,
      documents: db.documents.map((d) => (d.id === doc.id ? updatedDoc : d)),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      isCheckingOut ? 'SHAREPOINT_DOC_CHECKED_OUT' : 'SHAREPOINT_DOC_CHECKED_IN',
      'documents',
      doc.id,
      { checked_out_by: doc.checked_out_by_name },
      { checked_out_by: updatedDoc.checked_out_by_name }
    );

    onUpdateDb(nextState);
    setFeedback({
      type: 'ok',
      text: isCheckingOut
        ? `Checked out "${doc.title}" with exclusive edit lock for ${currentUser.full_name}.`
        : `Checked in "${doc.title}" — lock released for team co-authoring.`,
    });
  };

  // Save new SharePoint version in Word Co-Authoring Studio
  const handleSaveWordStudioVersion = (releaseCheckOutAfterSave = false) => {
    if (!activeDoc) return;
    setFeedback(null);

    if (
      activeDoc.checked_out_by &&
      activeDoc.checked_out_by !== currentUser.id &&
      roleName !== 'system_admin'
    ) {
      setFeedback({
        type: 'err',
        text: `Cannot save changes: This document is checked out and locked by ${activeDoc.checked_out_by_name}.`,
      });
      return;
    }

    const currentLabel = activeDoc.version_label || `${activeDoc.version}.0`;
    const [majStr, minStr] = currentLabel.split('.');
    const maj = parseInt(majStr || '1', 10) || 1;
    const min = parseInt(minStr || '0', 10) || 0;

    const nextVersionLabel =
      versionBumpType === 'major' ? `${maj + 1}.0` : `${maj}.${min + 1}`;
    const now = new Date().toISOString();

    const newHistoryEntry: DocumentVersionEntry = {
      version_label: nextVersionLabel,
      saved_by_id: currentUser.id,
      saved_by_name: currentUser.full_name,
      comment:
        versionComment.trim() ||
        (versionBumpType === 'major'
          ? 'Published major milestone version in Word Studio'
          : 'Co-authoring incremental revision'),
      content_snapshot: editorContent,
      saved_at: now,
    };

    const existingHistory = activeDoc.version_history || [];

    const updatedDoc: DocumentRecord = {
      ...activeDoc,
      title: editorTitle.trim() || activeDoc.title,
      version: versionBumpType === 'major' ? maj + 1 : activeDoc.version,
      version_label: nextVersionLabel,
      word_content: editorContent,
      co_authors: Array.from(new Set([...selectedCoAuthors, currentUser.id])),
      version_history: [newHistoryEntry, ...existingHistory],
      checked_out_by: releaseCheckOutAfterSave ? null : activeDoc.checked_out_by,
      checked_out_by_name: releaseCheckOutAfterSave ? null : activeDoc.checked_out_by_name,
      checked_out_at: releaseCheckOutAfterSave ? null : activeDoc.checked_out_at,
    };

    let nextState: DatabaseState = {
      ...db,
      documents: db.documents.map((d) => (d.id === activeDoc.id ? updatedDoc : d)),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'SHAREPOINT_WORD_VERSION_SAVED',
      'documents',
      activeDoc.id,
      { version_label: currentLabel },
      {
        version_label: nextVersionLabel,
        comment: newHistoryEntry.comment,
        released_lock: releaseCheckOutAfterSave,
      }
    );

    onUpdateDb(nextState);
    setVersionComment('');
    setFeedback({
      type: 'ok',
      text: `Saved SharePoint Version v${nextVersionLabel} of "${updatedDoc.title}"${
        releaseCheckOutAfterSave ? ' and checked document in.' : '.'
      }`,
    });
  };

  const handleRestoreVersion = (entry: DocumentVersionEntry) => {
    if (!activeDoc) return;
    setEditorContent(entry.content_snapshot);
    setFeedback({
      type: 'ok',
      text: `Restored manuscript content from Version v${entry.version_label} (${entry.saved_by_name}). Click Save Version to commit.`,
    });
  };

  const handleShareDocToTeamChat = (doc: DocumentRecord) => {
    const now = new Date().toISOString();
    const msg: ChatMessageItem = {
      id: generateUuid(),
      sender_id: currentUser.id,
      sender_name: currentUser.full_name,
      sender_role: roleName,
      sender_directorate: currentDir?.code || 'HQ',
      message: `Shared document "${doc.title}" (v${doc.version_label || `${doc.version}.0`}) for collaborative review.`,
      shared_attachment: {
        type: 'document',
        id: doc.id,
        title: doc.title,
        subtitle: `${doc.category} · v${doc.version_label || `${doc.version}.0`} · ${doc.file_name}`,
      },
      created_at: now,
    };

    appendChatMessage(msg, true);

    const nextState = appendAuditLog(
      db,
      currentUser,
      'SHAREPOINT_DOCUMENT_SHARED_IN_CHAT',
      'documents',
      doc.id,
      null,
      { title: doc.title, version: doc.version_label || `${doc.version}.0` }
    );
    onUpdateDb(nextState);

    setFeedback({
      type: 'ok',
      text: `Shared "${doc.title}" to the Live Team Collaboration Chat.`,
    });
  };

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const msg: ChatMessageItem = {
      id: generateUuid(),
      sender_id: currentUser.id,
      sender_name: currentUser.full_name,
      sender_role: roleName,
      sender_directorate: currentDir?.code || 'HQ',
      message: chatInput.trim(),
      created_at: new Date().toISOString(),
    };

    appendChatMessage(msg, true);
    setChatInput('');
  };

  const handleCreateNewSharePointDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocTitle.trim()) return;

    const now = new Date().toISOString();
    const cleanFileName =
      newDocTitle
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_') + (newDocIsImage ? '.jpg' : '.docx');

    const initialContent = `# ${newDocTitle.trim()}\n\n## 1. Document Purpose & Scope\nCreated by ${
      currentUser.full_name
    } (${currentUser.staff_number}) in library "${newDocLibrary}".\n\n## 2. Scientific Content & Findings\nBegin co-authoring here...`;

    const newDoc: DocumentRecord = {
      id: generateUuid(),
      title: newDocTitle.trim(),
      category: newDocIsImage ? 'Imagery' : newDocCategory,
      project_id: newDocProjectId || null,
      directorate_id: currentUser.directorate_id || db.directorates[0]?.id || 'dir-ocs',
      uploaded_by: currentUser.id,
      file_name: cleanFileName,
      mime_type: newDocIsImage
        ? 'image/jpeg'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size_bytes: newDocIsImage ? 1480200 : 284500,
      version: 1,
      version_label: '1.0',
      access_level: 'Directorate Scoped',
      created_at: now,
      library_folder: newDocLibrary,
      checked_out_by: null,
      checked_out_by_name: null,
      checked_out_at: null,
      word_content: initialContent,
      co_authors: [currentUser.id],
      image_preview_url: newDocIsImage
        ? newDocImageUrl.trim() ||
          'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1000&q=80'
        : undefined,
      version_history: [
        {
          version_label: '1.0',
          saved_by_id: currentUser.id,
          saved_by_name: currentUser.full_name,
          comment: 'Initial SharePoint document provisioning',
          content_snapshot: initialContent,
          saved_at: now,
        },
      ],
    };

    let nextState: DatabaseState = {
      ...db,
      documents: [newDoc, ...db.documents],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'SHAREPOINT_DOCUMENT_CREATED',
      'documents',
      newDoc.id,
      null,
      { title: newDoc.title, library: newDocLibrary, version_label: '1.0' }
    );

    onUpdateDb(nextState);
    setShowNewDocModal(false);
    setNewDocTitle('');
    setNewDocImageUrl('');
    setActiveDocId(newDoc.id);
    if (!newDocIsImage) {
      setActiveTab('word_studio');
    } else {
      setActiveTab('imagery');
    }
    setFeedback({
      type: 'ok',
      text: `Created "${newDoc.title}" (v1.0) in ${newDocLibrary}.`,
    });
  };

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setNewDocImageUrl(reader.result);
        setNewDocIsImage(true);
        if (!newDocTitle) {
          setNewDocTitle(file.name.replace(/\.[^/.]+$/, ''));
        }
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Executive Header Banner */}
      <div className="bg-gradient-to-r from-[#0A2540] via-[#173B75] to-[#159A9C] text-white rounded-2xl p-6 shadow-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/10 text-teal-200 text-xs font-mono font-semibold mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>SharePoint &amp; Word Collaboration Hub · Document Libraries &amp; Co-Authoring</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold font-display tracking-tight">
              Research Drive, Collaborative Documents &amp; Imagery
            </h1>
            <p className="text-xs sm:text-sm text-sky-100/90 mt-1 max-w-3xl">
              SharePoint-style versioning, document check-out locking, co-authoring in Word Studio,
              and live team chat sharing whereby scientists can share documents and publications in
              real time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setNewDocIsImage(false);
                setShowNewDocModal(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-white text-[#173B75] hover:bg-sky-50 text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Word Document</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setNewDocIsImage(true);
                setNewDocLibrary('Research Imagery & Bathymetry');
                setShowNewDocModal(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/25 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ImageIcon className="w-4 h-4" />
              <span>Upload Research Imagery</span>
            </button>
          </div>
        </div>

        {/* Navigation Sub-Tabs */}
        <div className="mt-5 pt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('drive')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
                activeTab === 'drive'
                  ? 'bg-white text-[#0A2540] shadow-xs'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>SharePoint Document Libraries ({visibleDocuments.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('word_studio')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
                activeTab === 'word_studio'
                  ? 'bg-white text-[#0A2540] shadow-xs'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Word Co-Authoring Studio &amp; Versioning</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('imagery')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
                activeTab === 'imagery'
                  ? 'bg-white text-[#0A2540] shadow-xs'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Scientific Imagery &amp; Bathymetry Vault ({imageryDocs.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-sky-100 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live Collaboration Sync Active ({onlinePeers} Online)
            </span>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] underline opacity-75 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main 12-Column Split: Left 8 Cols = Active Workspace | Right 4 Cols = Live Team Chat & Document Sharing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          {/* TAB 1: SHAREPOINT DOCUMENT LIBRARIES & CHECK-OUT LOCKING */}
          {activeTab === 'drive' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
              {/* Library Folder Pills & Search */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    <FolderOpen className="w-4 h-4 text-[#159A9C]" />
                    <span>Research Drive Document Libraries</span>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Filter documents, locks, versions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedLibrary('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      selectedLibrary === 'ALL'
                        ? 'bg-[#173B75] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    All Libraries ({visibleDocuments.length})
                  </button>
                  {DEFAULT_LIBRARIES.map((lib) => (
                    <button
                      key={lib}
                      type="button"
                      onClick={() => setSelectedLibrary(lib)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        selectedLibrary === lib
                          ? 'bg-[#159A9C] text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {lib}
                    </button>
                  ))}
                </div>
              </div>

              {/* Document Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                      <th className="py-3 px-4">Document &amp; Library</th>
                      <th className="py-3 px-4">Version</th>
                      <th className="py-3 px-4">Check-Out Lock Status</th>
                      <th className="py-3 px-4 text-right">Collaboration Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredDocs.map((doc) => {
                      const d = getDirectorateById(db, doc.directorate_id);
                      const isCheckedOut = Boolean(doc.checked_out_by);
                      const isCheckedOutByMe = doc.checked_out_by === currentUser.id;
                      const verLabel = doc.version_label || `${doc.version}.0`;

                      return (
                        <tr
                          key={doc.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-[#173B75] dark:text-sky-400 shrink-0" />
                              <span>{doc.title}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              {doc.library_folder || DEFAULT_LIBRARIES[0]} · {d?.code || 'HQ'} ·{' '}
                              {doc.file_name}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span className="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 font-bold">
                              v{verLabel}
                            </span>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {(doc.version_history?.length || 1)} rev(s)
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {isCheckedOut ? (
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-medium text-[11px]">
                                <Lock className="w-3 h-3 text-amber-600 shrink-0" />
                                <span>
                                  Locked by{' '}
                                  {isCheckedOutByMe ? 'You' : doc.checked_out_by_name}
                                </span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium text-[11px]">
                                <Unlock className="w-3 h-3 text-emerald-600 shrink-0" />
                                <span>Available for Co-Authoring</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDocId(doc.id);
                                  setActiveTab('word_studio');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                              >
                                <FileText className="w-3 h-3" />
                                <span>Open in Word Studio</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleCheckOutLock(doc)}
                                className={`px-2.5 py-1.5 rounded-lg border font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer ${
                                  isCheckedOut
                                    ? 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                                }`}
                                title={
                                  isCheckedOut
                                    ? 'Check in document and release lock'
                                    : 'Check out document for exclusive editing'
                                }
                              >
                                {isCheckedOut ? (
                                  <>
                                    <Unlock className="w-3 h-3" />
                                    <span>Check In</span>
                                  </>
                                ) : (
                                  <>
                                    <Lock className="w-3 h-3" />
                                    <span>Check Out</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleShareDocToTeamChat(doc)}
                                className="px-2.5 py-1.5 rounded-lg bg-teal-600/10 hover:bg-teal-600/20 text-teal-700 dark:text-teal-300 font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                title="Share document to Live Team Chat"
                              >
                                <Share2 className="w-3 h-3" />
                                <span>Share</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: WORD CO-AUTHORING STUDIO & SHAREPOINT VERSION HISTORY */}
          {activeTab === 'word_studio' && activeDoc && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-[#173B75] text-white font-mono text-[11px] font-bold">
                      WORD STUDIO · v{activeDoc.version_label || `${activeDoc.version}.0`}
                    </span>
                    {activeDoc.checked_out_by ? (
                      <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[11px] font-semibold flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Checked out by {activeDoc.checked_out_by_name}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        Live Multi-Scientist Co-Authoring Ready
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white mt-1.5">
                    {activeDoc.title}
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={activeDoc.id}
                    onChange={(e) => setActiveDocId(e.target.value)}
                    className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 font-medium"
                  >
                    {visibleDocuments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} (v{d.version_label || `${d.version}.0`})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleToggleCheckOutLock(activeDoc)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {activeDoc.checked_out_by ? (
                      <>
                        <Unlock className="w-3.5 h-3.5 text-amber-600" />
                        <span>Check In &amp; Unlock</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5 text-teal-600" />
                        <span>Check Out Document</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleShareDocToTeamChat(activeDoc)}
                    className="px-3 py-1.5 rounded-lg bg-[#159A9C] hover:bg-teal-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share in Team Chat</span>
                  </button>
                </div>
              </div>

              {/* Co-Authoring Canvas & Version Control */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-8 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Document Title
                    </label>
                    <input
                      type="text"
                      value={editorTitle}
                      onChange={(e) => setEditorTitle(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>

                  {/* Quick Formatting Insert Bar */}
                  <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setEditorContent((prev) => `${prev}\n\n## New Section Heading\n`)
                      }
                      className="px-2 py-1 rounded bg-white dark:bg-slate-900 font-semibold cursor-pointer"
                    >
                      + H2 Section
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditorContent(
                          (prev) =>
                            `${prev}\n\n| Station | Parameter | Value | Standard |\n| --- | --- | --- | --- |\n| Mombasa HQ | Dissolved Oxygen | 6.8 mg/L | ISO 17025 |\n`
                        )
                      }
                      className="px-2 py-1 rounded bg-white dark:bg-slate-900 font-semibold cursor-pointer"
                    >
                      + Data Table
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditorContent(
                          (prev) =>
                            `${prev}\n\n> [Co-Author Review Note — ${currentUser.full_name} (${new Date()
                              .toISOString()
                              .slice(0, 10)})]: Verified methodology and sampling coordinates.`
                        )
                      }
                      className="px-2 py-1 rounded bg-white dark:bg-slate-900 font-semibold cursor-pointer"
                    >
                      + Co-Author Stamp
                    </button>
                  </div>

                  <textarea
                    rows={14}
                    value={editorContent}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditorContent(val);
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(
                          JSON.stringify({
                            type: 'DOC_COAUTHOR_UPDATE',
                            payload: {
                              docId: activeDoc.id,
                              content: val,
                              updatedBy: currentUser.id,
                            },
                          })
                        );
                      }
                    }}
                    className="w-full p-4 text-xs font-mono leading-relaxed rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#159A9C]"
                  />

                  {/* Commit New Version Bar */}
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <div className="sm:col-span-2">
                        <label className="block font-semibold mb-1">
                          SharePoint Version Check-In Comment
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., Added hydrographic nutrient tables and updated discussion"
                          value={versionComment}
                          onChange={(e) => setVersionComment(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold mb-1">Version Increment</label>
                        <select
                          value={versionBumpType}
                          onChange={(e) =>
                            setVersionBumpType(e.target.value as 'minor' | 'major')
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        >
                          <option value="minor">Minor Draft (+0.1)</option>
                          <option value="major">Major Published (+1.0)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveWordStudioVersion(false)}
                        className="px-4 py-2 rounded-lg bg-[#173B75] hover:bg-[#3155A4] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save New SharePoint Version</span>
                      </button>

                      {activeDoc.checked_out_by === currentUser.id && (
                        <button
                          type="button"
                          onClick={() => handleSaveWordStudioVersion(true)}
                          className="px-4 py-2 rounded-lg bg-[#16866B] hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Save Version &amp; Check In</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column of Word Studio: Co-Authors & SharePoint Version History */}
                <div className="lg:col-span-4 space-y-4">
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5 text-xs">
                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#159A9C]" />
                      <span>Assigned Co-Authors ({selectedCoAuthors.length})</span>
                    </h3>
                    <div className="max-h-36 overflow-y-auto space-y-1.5">
                      {visibleUsers.map((u) => {
                        const checked = selectedCoAuthors.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className="flex items-center gap-2 text-[11px] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCoAuthors((prev) => [...prev, u.id]);
                                } else {
                                  setSelectedCoAuthors((prev) =>
                                    prev.filter((id) => id !== u.id)
                                  );
                                }
                              }}
                              className="rounded border-slate-300"
                            />
                            <span className="truncate font-medium">
                              {u.full_name} ({u.staff_number})
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5 text-xs">
                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-[#159A9C]" />
                      <span>SharePoint Version History</span>
                    </h3>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {(activeDoc.version_history && activeDoc.version_history.length > 0
                        ? activeDoc.version_history
                        : [
                            {
                              version_label: activeDoc.version_label || `${activeDoc.version}.0`,
                              saved_by_id: activeDoc.uploaded_by,
                              saved_by_name: 'Initial Author',
                              comment: 'Baseline document version',
                              content_snapshot: editorContent,
                              saved_at: activeDoc.created_at,
                            },
                          ]
                      ).map((ver, i) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-[#173B75] dark:text-sky-400">
                              v{ver.version_label}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRestoreVersion(ver)}
                              className="text-[10px] font-semibold text-teal-700 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              Restore
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-700 dark:text-slate-300">
                            {ver.comment}
                          </p>
                          <div className="text-[10px] font-mono text-slate-400">
                            {ver.saved_by_name} · {ver.saved_at.slice(0, 16).replace('T', ' ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SCIENTIFIC IMAGERY & BATHYMETRY VAULT */}
          {activeTab === 'imagery' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Collaborative Research Imagery, Specimen Photography &amp; Bathymetric Maps
                  </h2>
                  <p className="text-xs text-slate-500">
                    High-resolution imagery assets available for attachment in Publications Authoring
                    Studio and Live Team Chat.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewDocIsImage(true);
                    setNewDocLibrary('Research Imagery & Bathymetry');
                    setShowNewDocModal(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#173B75] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Add Imagery Asset</span>
                </button>
              </div>

              {imageryDocs.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-2">
                  <ImageIcon className="w-7 h-7 text-teal-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    No Research Imagery Uploaded Yet
                  </p>
                  <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                    Click &ldquo;Add Imagery Asset&rdquo; above to upload specimen photos, coral reef
                    transects, or satellite chlorophyll maps to share with your team.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {imageryDocs.map((imgDoc) => (
                    <div
                      key={imgDoc.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-slate-800/50 flex flex-col justify-between"
                    >
                      {imgDoc.image_preview_url && (
                        <img
                          src={imgDoc.image_preview_url}
                          alt={imgDoc.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-44 object-cover"
                        />
                      )}
                      <div className="p-3.5 space-y-2 text-xs">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {imgDoc.title}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          v{imgDoc.version_label || '1.0'} · {imgDoc.file_name}
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => handleShareDocToTeamChat(imgDoc)}
                            className="px-2.5 py-1 rounded bg-teal-600 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Share2 className="w-3 h-3" />
                            <span>Share to Team Chat</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT 4 COLUMNS: LIVE TEAM CHAT & DOCUMENT / PUBLICATION SHARING HUB */}
        <div className="lg:col-span-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col h-[640px] shadow-xs">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#159A9C]" />
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Live Scientist Team Chat &amp; Document Sharing
                  </h2>
                  <p className="text-[10px] text-slate-500">
                    Share SharePoint documents &amp; manuscripts instantly
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-bold">
                LIVE
              </span>
            </div>

            {/* Quick Share Document Bar */}
            <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-500 truncate">Quick share active doc:</span>
              {activeDoc && (
                <button
                  type="button"
                  onClick={() => handleShareDocToTeamChat(activeDoc)}
                  className="px-2 py-1 rounded bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Share2 className="w-3 h-3" />
                  <span className="truncate max-w-[140px]">{activeDoc.title}</span>
                </button>
              )}
            </div>

            {/* Chat Messages Feed */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
              {visibleChatMessages.map((m) => {
                const isMe = m.sender_id === currentUser.id;
                return (
                  <div
                    key={m.id}
                    className={`p-3 rounded-xl border ${
                      isMe
                        ? 'bg-teal-50/70 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800/70 ml-4'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 mr-4'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-bold text-slate-900 dark:text-white text-[11px]">
                        {m.sender_name}{' '}
                        <span className="font-mono text-[10px] text-teal-700 dark:text-teal-400">
                          ({m.sender_directorate})
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {m.created_at.slice(11, 16)}
                      </span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                      {m.message}
                    </p>

                    {m.shared_attachment && (
                      <div className="mt-2 p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-[#159A9C] font-bold">
                            {m.shared_attachment.type === 'publication' ? (
                              <BookOpen className="w-3 h-3" />
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            <span>Shared {m.shared_attachment.type}</span>
                          </div>
                          <div className="font-bold text-slate-900 dark:text-white truncate text-[11px]">
                            {m.shared_attachment.title}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {m.shared_attachment.subtitle}
                          </div>
                        </div>
                        {m.shared_attachment.type === 'document' && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDocId(m.shared_attachment!.id);
                              setActiveTab('word_studio');
                            }}
                            className="px-2 py-1 rounded bg-[#173B75] text-white text-[10px] font-semibold shrink-0 cursor-pointer"
                          >
                            Open
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Chat Input Box */}
            <form
              onSubmit={handleSendChatMessage}
              className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
            >
              <input
                type="text"
                placeholder="Message scientists or discuss manuscript..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg bg-[#173B75] hover:bg-[#3155A4] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Modal: Create New Collaborative Word Document or Upload Research Imagery */}
      {showNewDocModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              {newDocIsImage
                ? 'Upload Research Imagery to SharePoint Vault'
                : 'Create New Collaborative Word Document'}
            </h2>
            <form onSubmit={handleCreateNewSharePointDocument} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Document / Imagery Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Western Indian Ocean Tuna Stock Synthesis 2026"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">SharePoint Document Library</label>
                  <select
                    value={newDocLibrary}
                    onChange={(e) => setNewDocLibrary(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {DEFAULT_LIBRARIES.map((lib) => (
                      <option key={lib} value={lib}>
                        {lib}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Classification Category</label>
                  <select
                    value={newDocCategory}
                    onChange={(e) =>
                      setNewDocCategory(e.target.value as DocumentRecord['category'])
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="Technical">Technical Manuscript</option>
                    <option value="Proposal">Project Proposal</option>
                    <option value="Ethics">Ethics Clearance</option>
                    <option value="SOP">Cruise / Lab SOP</option>
                    <option value="Dataset">Dataset Documentation</option>
                    <option value="Imagery">Scientific Imagery</option>
                  </select>
                </div>
              </div>

              {newDocIsImage && (
                <div className="space-y-2">
                  <label className="block font-semibold">
                    Select Local Image File or Paste High-Res Image URL
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileUpload}
                    className="w-full text-xs"
                  />
                  <input
                    type="url"
                    placeholder="https://images.unsplash.com/..."
                    value={newDocImageUrl}
                    onChange={(e) => setNewDocImageUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewDocModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold cursor-pointer"
                >
                  Create &amp; Open in Hub
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
