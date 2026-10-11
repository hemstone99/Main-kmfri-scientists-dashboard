import React, { useState } from 'react';
import {
  DatabaseState,
  User,
  ResearchArea,
} from '../types/kmfri.ts';
import {
  generateUuid,
  hashPasswordSync,
  appendAuditLog,
  createInitialCleanDatabase,
  getRoleById,
  getDirectorateById,
} from '../services/database.ts';
import {
  Lock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Search,
  Save,
  Plus,
  UserCheck,
  Trash2,
  KeyRound,
  Mail,
} from 'lucide-react';

interface AdminAuditAndPhpModulesProps {
  db: DatabaseState;
  currentUser: User;
  mode: 'administration' | 'audit_logs';
  onUpdateDb: (next: DatabaseState) => void;
}

export const AdminAuditAndPhpModules: React.FC<AdminAuditAndPhpModulesProps> = ({
  db,
  currentUser,
  mode,
  onUpdateDb,
}) => {
  const [alertMsg, setAlertMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [csvInput, setCsvInput] = useState(
    'full_name,email,staff_number,directorate_code,position\n'
  );
  const [csvPreviewRows, setCsvPreviewRows] = useState<
    {
      full_name: string;
      email: string;
      staff_number: string;
      directorate_code: string;
      position: string;
      duplicate: boolean;
    }[]
  >([]);

  // New Research Area state
  const [areaName, setAreaName] = useState('');
  const [areaDesc, setAreaDesc] = useState('');
  const [areaDirId, setAreaDirId] = useState(db.directorates[0]?.id || '');

  // Editable System Settings values
  const [settingEdits, setSettingEdits] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    db.system_settings.forEach((s) => {
      map[s.id] = s.json_value;
    });
    return map;
  });

  // Audit Log search & filter
  const [auditSearch, setAuditSearch] = useState('');
  const [auditRoleFilter, setAuditRoleFilter] = useState('ALL');
  const [userSearch, setUserSearch] = useState('');

  // Admin Password Reset Modal state (supports SMTP 2FA email verification)
  const [pwdModalUser, setPwdModalUser] = useState<User | null>(null);
  const [newAdminUserPwd, setNewAdminUserPwd] = useState('');
  const [twoFaCodeInput, setTwoFaCodeInput] = useState('');
  const [twoFaSent, setTwoFaSent] = useState(false);
  const [twoFaSending, setTwoFaSending] = useState(false);
  const [requireTwoFaForAdminReset, setRequireTwoFaForAdminReset] = useState(true);

  const handleSaveSetting = (settingId: string) => {
    const target = db.system_settings.find((s) => s.id === settingId);
    if (!target) return;
    const newVal = settingEdits[settingId] ?? target.json_value;
    const now = new Date().toISOString();

    let nextState: DatabaseState = {
      ...db,
      system_settings: db.system_settings.map((s) =>
        s.id === settingId ? { ...s, json_value: newVal, updated_at: now } : s
      ),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'SYSTEM_SETTING_UPDATED',
      'system_settings',
      target.setting_key,
      { value: target.json_value },
      { value: newVal }
    );

    onUpdateDb(nextState);
    setAlertMsg({
      type: 'ok',
      text: `System policy "${target.setting_label}" updated to ${newVal}.`,
    });
  };

  const handleCreateResearchArea = (e: React.FormEvent) => {
    e.preventDefault();
    if (!areaName.trim()) return;

    const newArea: ResearchArea = {
      id: generateUuid(),
      name: areaName.trim(),
      description: areaDesc.trim() || areaName.trim(),
      directorate_id: areaDirId,
      created_at: new Date().toISOString(),
    };

    let nextState: DatabaseState = {
      ...db,
      research_areas: [...db.research_areas, newArea],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'RESEARCH_AREA_CREATED',
      'research_areas',
      newArea.id,
      null,
      { name: newArea.name, directorate_id: newArea.directorate_id }
    );

    onUpdateDb(nextState);
    setAreaName('');
    setAreaDesc('');
    setAlertMsg({
      type: 'ok',
      text: `Reference Research Area "${newArea.name}" added.`,
    });
  };

  const handleToggleUserStatus = (targetUser: User) => {
    if (targetUser.id === currentUser.id) {
      setAlertMsg({
        type: 'err',
        text: 'Self-lockout guard: You cannot deactivate your own active session.',
      });
      return;
    }

    const nextStatus: User['account_status'] =
      targetUser.account_status === 'Active' ? 'Inactive' : 'Active';

    let nextState: DatabaseState = {
      ...db,
      users: db.users.map((u) =>
        u.id === targetUser.id
          ? {
              ...u,
              account_status: nextStatus,
              failed_login_attempts: 0,
              updated_at: new Date().toISOString(),
            }
          : u
      ),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'USER_ACCOUNT_STATUS_CHANGED',
      'users',
      targetUser.id,
      { account_status: targetUser.account_status },
      { account_status: nextStatus }
    );

    onUpdateDb(nextState);
    setAlertMsg({
      type: 'ok',
      text: `Account ${targetUser.full_name} (${targetUser.staff_number}) set to ${nextStatus}.`,
    });
  };

  const handleChangeUserRole = (targetUser: User, nextRoleId: string) => {
    const newRole = getRoleById(db, nextRoleId);
    if (!newRole) return;

    const isInstWide =
      newRole.name === 'director_general' || newRole.name === 'system_admin';
    const nextDirId = isInstWide
      ? null
      : targetUser.directorate_id || db.directorates[0]?.id || null;

    let nextState: DatabaseState = {
      ...db,
      users: db.users.map((u) =>
        u.id === targetUser.id
          ? {
              ...u,
              role_id: nextRoleId,
              directorate_id: nextDirId,
              position: newRole.label,
              updated_at: new Date().toISOString(),
            }
          : u
      ),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'USER_ROLE_CHANGED',
      'users',
      targetUser.id,
      { role_id: targetUser.role_id },
      { role_id: nextRoleId, role_name: newRole.name }
    );

    onUpdateDb(nextState);
    setAlertMsg({
      type: 'ok',
      text: `Updated role for ${targetUser.full_name} to ${newRole.label}.`,
    });
  };

  const handleChangeUserDirectorate = (targetUser: User, nextDirId: string) => {
    const dirVal = nextDirId === 'HQ' ? null : nextDirId;
    let nextState: DatabaseState = {
      ...db,
      users: db.users.map((u) =>
        u.id === targetUser.id
          ? {
              ...u,
              directorate_id: dirVal,
              updated_at: new Date().toISOString(),
            }
          : u
      ),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'USER_DIRECTORATE_CHANGED',
      'users',
      targetUser.id,
      { directorate_id: targetUser.directorate_id },
      { directorate_id: dirVal }
    );

    onUpdateDb(nextState);
    setAlertMsg({
      type: 'ok',
      text: `Updated directorate assignment for ${targetUser.full_name}.`,
    });
  };

  const handleDeleteUserAccount = (targetUser: User) => {
    if (targetUser.id === currentUser.id) {
      setAlertMsg({
        type: 'err',
        text: 'Self-deletion guard: You cannot delete your own active System Administrator account.',
      });
      return;
    }

    let nextState: DatabaseState = {
      ...db,
      users: db.users.filter((u) => u.id !== targetUser.id),
      researcher_profiles: db.researcher_profiles.filter((p) => p.user_id !== targetUser.id),
      directorates: db.directorates.map((d) =>
        d.head_user_id === targetUser.id ? { ...d, head_user_id: null } : d
      ),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'USER_ACCOUNT_DELETED',
      'users',
      targetUser.id,
      {
        full_name: targetUser.full_name,
        email: targetUser.email,
        staff_number: targetUser.staff_number,
      },
      null
    );

    onUpdateDb(nextState);
    setAlertMsg({
      type: 'ok',
      text: `Deleted user account ${targetUser.full_name} (${targetUser.staff_number}) from the institutional directory.`,
    });
  };

  const handleSend2FaCodeForUser = async (targetUser: User) => {
    setTwoFaSending(true);
    setAlertMsg(null);
    try {
      const resp = await fetch('/api/auth/send-2fa-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetUser.email,
          fullName: targetUser.full_name,
          staffNumber: targetUser.staff_number,
          purpose: 'Password Change Verification',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to dispatch 2FA verification email.');
      }
      setTwoFaSent(true);
      setTwoFaCodeInput('');
      setAlertMsg({
        type: 'ok',
        text:
          data.message ||
          `6-digit 2FA verification code sent via SMTP to ${targetUser.email}.`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to send 2FA email.',
      });
    } finally {
      setTwoFaSending(false);
    }
  };

  const handleConfirmAdminPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdModalUser) return;
    if (newAdminUserPwd.length < 8) {
      setAlertMsg({
        type: 'err',
        text: 'New password must be at least 8 characters.',
      });
      return;
    }

    if (requireTwoFaForAdminReset) {
      if (!twoFaCodeInput.trim()) {
        setAlertMsg({
          type: 'err',
          text: 'Please enter the 6-digit 2FA verification code sent to the user email.',
        });
        return;
      }
      try {
        const resp = await fetch('/api/auth/verify-2fa-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: pwdModalUser.email,
            code: twoFaCodeInput.trim(),
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.verified) {
          setAlertMsg({
            type: 'err',
            text: data.error || 'Invalid or expired 2FA verification code.',
          });
          return;
        }
      } catch (err) {
        setAlertMsg({
          type: 'err',
          text: err instanceof Error ? err.message : '2FA verification failed.',
        });
        return;
      }
    }

    const now = new Date().toISOString();
    let nextState: DatabaseState = {
      ...db,
      users: db.users.map((u) =>
        u.id === pwdModalUser.id
          ? {
              ...u,
              password_hash: hashPasswordSync(newAdminUserPwd),
              failed_login_attempts: 0,
              account_status: 'Active',
              updated_at: now,
            }
          : u
      ),
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'USER_PASSWORD_CHANGED',
      'users',
      pwdModalUser.id,
      null,
      {
        target_email: pwdModalUser.email,
        verified_via_smtp_2fa: requireTwoFaForAdminReset,
      }
    );

    onUpdateDb(nextState);
    setAlertMsg({
      type: 'ok',
      text: `Password updated for ${pwdModalUser.full_name} (${pwdModalUser.email}).`,
    });
    setPwdModalUser(null);
    setNewAdminUserPwd('');
    setTwoFaCodeInput('');
    setTwoFaSent(false);
  };

  const handlePreviewCsv = () => {
    setAlertMsg(null);
    const lines = csvInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      setAlertMsg({
        type: 'err',
        text: 'CSV must contain a header row and at least one data row.',
      });
      return;
    }

    const header = lines[0].toLowerCase();
    if (
      !header.includes('full_name') ||
      !header.includes('email') ||
      !header.includes('staff_number')
    ) {
      setAlertMsg({
        type: 'err',
        text: 'CSV column validation failed: Required columns are full_name, email, staff_number, directorate_code, position.',
      });
      return;
    }

    const parsed = lines.slice(1).map((line) => {
      const [
        full_name = '',
        email = '',
        staff_number = '',
        directorate_code = 'OCS',
        position = 'Scientist',
      ] = line.split(',').map((s) => s.trim());
      const duplicate = db.users.some(
        (u) =>
          u.email.toLowerCase() === email.toLowerCase() ||
          u.staff_number.toUpperCase() === staff_number.toUpperCase()
      );
      return {
        full_name,
        email,
        staff_number,
        directorate_code,
        position,
        duplicate,
      };
    });

    setCsvPreviewRows(parsed);
  };

  const handleCommitCsvImport = () => {
    const validRows = csvPreviewRows.filter(
      (r) => !r.duplicate && r.full_name && r.email
    );
    if (validRows.length === 0) {
      setAlertMsg({
        type: 'err',
        text: 'No non-duplicate verified rows available to commit.',
      });
      return;
    }

    const now = new Date().toISOString();
    const sciRole = db.roles.find((r) => r.name === 'scientist') || db.roles[0];

    const importedUsers: User[] = validRows.map((r) => {
      const dir =
        db.directorates.find((d) => d.code === r.directorate_code.toUpperCase()) ||
        db.directorates[0];
      return {
        id: generateUuid(),
        full_name: r.full_name,
        email: r.email.toLowerCase(),
        phone: '',
        password_hash: hashPasswordSync('Kmfri@2026!'),
        staff_number: r.staff_number.toUpperCase(),
        profile_photo: '',
        position: r.position,
        directorate_id: dir.id,
        research_area_id: null,
        role_id: sciRole.id,
        account_status: 'Active',
        failed_login_attempts: 0,
        last_login: null,
        created_at: now,
        updated_at: now,
      };
    });

    let nextState = {
      ...db,
      users: [...db.users, ...importedUsers],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'CSV_BATCH_IMPORT_COMMITTED',
      'users',
      'import-batch',
      null,
      { imported_count: importedUsers.length }
    );

    onUpdateDb(nextState);
    setCsvPreviewRows([]);
    setAlertMsg({
      type: 'ok',
      text: `Transaction-safe CSV import committed: ${importedUsers.length} researcher accounts added.`,
    });
  };

  if (mode === 'administration') {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              System Administration, Policy Governance &amp; Reference Data
            </h1>
            <p className="text-xs text-slate-500">
              Manage institutional user roles, security policies, research areas, protected core
              directorates, and CSV batch imports.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const clean = createInitialCleanDatabase();
              onUpdateDb(clean);
            }}
            className="px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset to Clean Initial DB</span>
          </button>
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

        {/* User Account Role, Password & Deletion Governance */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-[#159A9C]" />
              <span>
                Institutional User Management — Roles, Passwords, Lockout &amp; Deletion ({db.users.length})
              </span>
            </h2>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2" />
              <input
                type="text"
                placeholder="Filter users by name, email, staff no..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="pl-8 pr-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                  <th className="py-2.5 px-4">Staff No.</th>
                  <th className="py-2.5 px-4">User &amp; Email</th>
                  <th className="py-2.5 px-4">Directorate</th>
                  <th className="py-2.5 px-4">Assigned Role</th>
                  <th className="py-2.5 px-4">Account Status</th>
                  <th className="py-2.5 px-4 text-right">Manage User Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {db.users
                  .filter((u) => {
                    if (!userSearch.trim()) return true;
                    const q = userSearch.toLowerCase();
                    return (
                      u.full_name.toLowerCase().includes(q) ||
                      u.email.toLowerCase().includes(q) ||
                      u.staff_number.toLowerCase().includes(q)
                    );
                  })
                  .map((u) => {
                    return (
                      <tr key={u.id}>
                        <td className="py-2.5 px-4 font-mono font-bold text-[#159A9C]">
                          {u.staff_number}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {u.full_name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">{u.email}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            value={u.directorate_id || 'HQ'}
                            onChange={(e) => handleChangeUserDirectorate(u, e.target.value)}
                            className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                          >
                            <option value="HQ">HQ (Institution-Wide)</option>
                            {db.directorates.map((dir) => (
                              <option key={dir.id} value={dir.id}>
                                {dir.code} — {dir.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            value={u.role_id}
                            onChange={(e) => handleChangeUserRole(u, e.target.value)}
                            className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
                          >
                            {db.roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 font-semibold">
                          <span
                            className={
                              u.account_status === 'Active'
                                ? 'text-emerald-600'
                                : 'text-red-600'
                            }
                          >
                            {u.account_status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setPwdModalUser(u);
                                setNewAdminUserPwd('');
                                setTwoFaCodeInput('');
                                setTwoFaSent(false);
                              }}
                              className="px-2.5 py-1 rounded border border-[#173B75]/30 dark:border-sky-500/40 bg-[#173B75]/10 hover:bg-[#173B75] text-[#173B75] dark:text-sky-300 hover:text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                              title="Change user password (with 2FA email verification)"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>Change Password</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleUserStatus(u)}
                              className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-semibold cursor-pointer"
                            >
                              {u.account_status === 'Active' ? 'Deactivate' : 'Activate'}
                            </button>

                            {u.id !== currentUser.id && (
                              <button
                                type="button"
                                onClick={() => handleDeleteUserAccount(u)}
                                className="px-2.5 py-1 rounded border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/40 hover:bg-red-600 text-red-700 dark:text-red-300 hover:text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                title="Delete user account"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Change User Password with SMTP 2FA Verification */}
        {pwdModalUser && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
              <div>
                <span className="text-[11px] font-mono uppercase text-[#159A9C] font-bold">
                  SMTP 2FA Security Verification
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-display mt-0.5">
                  Change Password — {pwdModalUser.full_name}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Target Email: <span className="font-mono font-semibold">{pwdModalUser.email}</span>
                </p>
              </div>

              <form onSubmit={handleConfirmAdminPasswordChange} className="space-y-3.5 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Step 1: Send 6-Digit 2FA Code via Email
                    </span>
                    <button
                      type="button"
                      disabled={twoFaSending}
                      onClick={() => handleSend2FaCodeForUser(pwdModalUser)}
                      className="px-2.5 py-1 rounded-lg bg-[#159A9C] hover:bg-teal-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Mail className="w-3 h-3" />
                      <span>{twoFaSending ? 'Sending...' : twoFaSent ? 'Resend 2FA Code' : 'Send 2FA Code'}</span>
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={requireTwoFaForAdminReset}
                      onChange={(e) => setRequireTwoFaForAdminReset(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Require 6-digit SMTP email 2FA verification before resetting</span>
                  </label>
                </div>

                {requireTwoFaForAdminReset && (
                  <div>
                    <label className="block font-semibold mb-1">
                      6-Digit Email 2FA Verification Code
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      placeholder="Enter 6-digit code sent to email"
                      value={twoFaCodeInput}
                      onChange={(e) => setTwoFaCodeInput(e.target.value)}
                      className="w-full px-3 py-2 font-mono text-sm tracking-widest rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                )}

                <div>
                  <label className="block font-semibold mb-1">
                    New Institutional Password (min 8 chars)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Enter new strong password"
                    value={newAdminUserPwd}
                    onChange={(e) => setNewAdminUserPwd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setPwdModalUser(null)}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold cursor-pointer"
                  >
                    Verify &amp; Update Password
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* System Settings & Research Areas Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Interactive System Settings Editor */}
          <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Security, Upload &amp; Workflow Threshold Settings
            </h2>
            <div className="space-y-2.5 text-xs">
              {db.system_settings.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {s.setting_label}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">{s.setting_key}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="text"
                      value={settingEdits[s.id] ?? s.json_value}
                      onChange={(e) =>
                        setSettingEdits((prev) => ({ ...prev, [s.id]: e.target.value }))
                      }
                      className="w-36 px-2.5 py-1 font-mono text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveSetting(s.id)}
                      className="px-2.5 py-1 bg-[#173B75] hover:bg-[#3155A4] text-white rounded font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Save className="w-3 h-3" />
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reference Research Areas Manager */}
          <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Institutional Research Areas ({db.research_areas.length})
            </h2>
            <form onSubmit={handleCreateResearchArea} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <input
                type="text"
                required
                placeholder="New research area title"
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <select
                value={areaDirId}
                onChange={(e) => setAreaDirId(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                {db.directorates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 bg-[#159A9C] hover:bg-teal-700 text-white font-semibold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Area</span>
              </button>
            </form>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs max-h-52 overflow-y-auto">
              {db.research_areas.map((a) => {
                const d = getDirectorateById(db, a.directorate_id);
                return (
                  <div key={a.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {a.name}
                      </span>
                      <p className="text-[11px] text-slate-500">{a.description}</p>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-[#159A9C] shrink-0">
                      {d?.code}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Protected Core Directorates */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Four Protected Core KMFRI Directorates (Deletion &amp; Duplication Guard Enabled)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {db.directorates.map((d) => {
              const head = db.users.find((u) => u.id === d.head_user_id);
              return (
                <div
                  key={d.id}
                  className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
                >
                  <div>
                    <span className="font-mono font-bold text-[#159A9C]">{d.code}</span>
                    <span className="mx-1.5">·</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{d.name}</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">{d.description}</p>
                    <p className="text-[11px] font-mono text-teal-700 dark:text-teal-400 mt-1">
                      Head of Directorate: {head ? head.full_name : 'Assign via Scientists tab'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAlertMsg({
                        type: 'err',
                        text: `Institutional Protection Policy: Core directorate "${d.code} — ${d.name}" is protected against accidental deletion or duplication.`,
                      })
                    }
                    className="px-2.5 py-1 border border-slate-200 dark:border-slate-700 text-slate-500 rounded-md text-[11px] font-mono shrink-0 cursor-pointer"
                  >
                    Protected
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Transaction-Safe CSV Import with Preview & Duplicate Detection */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Transaction-Safe CSV Batch Import (Column Validation + Duplicate Detection + Preview)
          </h2>
          <textarea
            rows={3}
            placeholder="full_name,email,staff_number,directorate_code,position"
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
            className="w-full p-3 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handlePreviewCsv}
              className="px-3.5 py-1.5 bg-[#173B75] hover:bg-[#3155A4] text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Validate Columns &amp; Preview Batch
            </button>
            {csvPreviewRows.length > 0 && (
              <button
                type="button"
                onClick={handleCommitCsvImport}
                className="px-3.5 py-1.5 bg-[#16866B] text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Commit Verified Rows to Database
              </button>
            )}
          </div>

          {csvPreviewRows.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-500">
                    <th className="py-2 px-3">Full Name</th>
                    <th className="py-2 px-3">Email</th>
                    <th className="py-2 px-3">Staff Number</th>
                    <th className="py-2 px-3">Directorate</th>
                    <th className="py-2 px-3">Duplicate Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {csvPreviewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2 px-3 font-semibold">{r.full_name}</td>
                      <td className="py-2 px-3 font-mono">{r.email}</td>
                      <td className="py-2 px-3 font-mono">{r.staff_number}</td>
                      <td className="py-2 px-3 font-mono">{r.directorate_code}</td>
                      <td className="py-2 px-3 font-semibold">
                        {r.duplicate ? (
                          <span className="text-red-600">Duplicate Detected (Skipped)</span>
                        ) : (
                          <span className="text-emerald-700">Ready to Import</span>
                        )}
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

  // Audit Logs View with Search & Role Filtering
  const filteredAuditLogs = db.audit_logs.filter((log) => {
    if (auditRoleFilter !== 'ALL' && log.user_role !== auditRoleFilter) return false;
    if (auditSearch.trim() !== '') {
      const q = auditSearch.toLowerCase();
      return (
        log.action.toLowerCase().includes(q) ||
        log.user_email.toLowerCase().includes(q) ||
        log.user_role.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Immutable Security &amp; Workflow Audit Trail ({filteredAuditLogs.length} Events)
          </h1>
          <p className="text-xs text-slate-500">
            Append-only cryptographic security log capturing actor identity, assigned role, verified
            action, and UTC timestamps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search security action or actor..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <select
            value={auditRoleFilter}
            onChange={(e) => setAuditRoleFilter(e.target.value)}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800"
          >
            <option value="ALL">All Actor Roles</option>
            <option value="system_admin">system_admin</option>
            <option value="director_general">director_general</option>
            <option value="head_of_directorate">head_of_directorate</option>
            <option value="directorate_admin">directorate_admin</option>
            <option value="scientist">scientist</option>
          </select>

          <span className="text-xs font-mono text-[#159A9C] flex items-center gap-1">
            <Lock className="w-3.5 h-3.5" />
            Append-Only · Tamper-Protected
          </span>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                <th className="py-3 px-4">UTC Timestamp</th>
                <th className="py-3 px-4">Actor &amp; Email</th>
                <th className="py-3 px-4">Authorized Role</th>
                <th className="py-3 px-4">Security / Workflow Action</th>
                <th className="py-3 px-4 text-right">Integrity Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredAuditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 font-mono whitespace-nowrap">
                    {log.created_at.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {log.user_email}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                    {log.user_role}
                  </td>
                  <td className="py-2.5 px-4 font-mono font-bold text-[#159A9C]">
                    {log.action}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                    Verified · Immutable
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
