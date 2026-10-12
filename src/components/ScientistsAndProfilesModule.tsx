import React, { useState } from 'react';
import {
  DatabaseState,
  User,
  ResearcherProfile,
} from '../types/kmfri.ts';
import {
  generateUuid,
  hashPasswordAsync,
  getRoleById,
  getDirectorateById,
  appendAuditLog,
} from '../services/database.ts';
import { canViewResearcherProfile, getUserRoleName } from '../services/rbacPolicy.ts';
import {
  UserPlus,
  Search,
  Building2,
  Mail,
  CheckCircle2,
  AlertCircle,
  Edit3,
  ShieldCheck,
  Eye,
  EyeOff,
  Trash2,
  KeyRound,
  GraduationCap,
  MapPin,
  Fingerprint,
  Lock,
} from 'lucide-react';

interface ScientistsAndProfilesModuleProps {
  db: DatabaseState;
  currentUser: User;
  mode: 'scientists' | 'profiles';
  onUpdateDb: (next: DatabaseState) => void;
}

export const ScientistsAndProfilesModule: React.FC<ScientistsAndProfilesModuleProps> = ({
  db,
  currentUser,
  mode,
  onUpdateDb,
}) => {
  const roleName = getUserRoleName(db, currentUser);
  const canProvisionStaff = ['system_admin', 'directorate_admin'].includes(roleName);

  const [searchQuery, setSearchQuery] = useState('');
  const [dirFilter, setDirFilter] = useState('ALL');
  const [selectedUserId, setSelectedUserId] = useState<string>(currentUser.id);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Add Account form (System Admin can create DG, Heads of the 4 Directorates, Directorate Admins, and Scientists)
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newStaffNo, setNewStaffNo] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRoleId, setNewRoleId] = useState(db.roles[0]?.id || '');
  const [newDirectorateId, setNewDirectorateId] = useState(
    currentUser.directorate_id || db.directorates[0]?.id || ''
  );
  const [newPosition, setNewPosition] = useState('');
  const [newSpecialization, setNewSpecialization] = useState('');
  const [newOrcid, setNewOrcid] = useState('');

  const selectedRoleToCreate = db.roles.find((r) => r.id === newRoleId);
  const isInstitutionWideRole =
    selectedRoleToCreate?.name === 'director_general' ||
    selectedRoleToCreate?.name === 'system_admin';

  const openProvisionModalForRole = (targetRoleName: string, targetDirId?: string) => {
    const foundRole = db.roles.find((r) => r.name === targetRoleName);
    if (foundRole) {
      setNewRoleId(foundRole.id);
      if (targetRoleName === 'director_general') {
        setNewPosition('Director General');
      } else if (targetRoleName === 'head_of_directorate') {
        setNewPosition('Head of Directorate');
      } else if (targetRoleName === 'directorate_admin') {
        setNewPosition('Directorate Administrator');
      } else if (targetRoleName === 'scientist') {
        setNewPosition('Research Scientist');
      } else {
        setNewPosition('');
      }
    }
    if (targetDirId) {
      setNewDirectorateId(targetDirId);
    }
    setShowAddStaffModal(true);
  };

  // Edit own profile form
  const activeProfile =
    db.researcher_profiles.find((p) => p.user_id === selectedUserId) ||
    db.researcher_profiles.find((p) => p.user_id === currentUser.id);

  const [editSpec, setEditSpec] = useState(activeProfile?.specialization || '');
  const [editRank, setEditRank] = useState(activeProfile?.academic_rank || '');
  const [editQual, setEditQual] = useState(activeProfile?.qualifications || '');
  const [editOrcid, setEditOrcid] = useState(activeProfile?.orcid || '');
  const [editOffice, setEditOffice] = useState(activeProfile?.office_location || '');
  const [editInterests, setEditInterests] = useState(activeProfile?.research_interests || '');
  const [editBio, setEditBio] = useState(activeProfile?.biography || '');
  const [editExpertise, setEditExpertise] = useState(activeProfile?.areas_of_expertise || '');
  const [editProfilePhone, setEditProfilePhone] = useState(activeProfile?.phone || currentUser.phone);
  const [editYearsExperience, setEditYearsExperience] = useState(activeProfile?.years_experience || 0);
  // Editing is locked until the profile has been saved at least once, so a
  // scientist must complete their profile before it can be modified.
  const [profileSaved, setProfileSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  // A brand-new scientist with no profile record yet starts unlocked so they
  // can complete the initial save; after that, edits require explicitly
  // unlocking the form.
  const editable = !profileSaved || editing;
  const showEditButton =
    selectedUserId === currentUser.id || ['system_admin', 'directorate_admin'].includes(roleName);

  React.useEffect(() => {
    const prof = db.researcher_profiles.find((p) => p.user_id === selectedUserId);
    if (prof) {
      setEditSpec(prof.specialization);
      setEditRank(prof.academic_rank);
      setEditQual(prof.qualifications);
      setEditOrcid(prof.orcid);
      setEditOffice(prof.office_location);
      setEditInterests(prof.research_interests);
      setEditBio(prof.biography);
      setEditExpertise(prof.areas_of_expertise);
      setEditProfilePhone(prof.phone || currentUser.phone);
      setEditYearsExperience(prof.years_experience || 0);
      // Editing is locked once a profile has been saved. A scientist with no
      // profile record yet starts unlocked so they can complete the initial
      // save; after that, edits require explicitly unlocking the form.
      setProfileSaved(true);
    } else {
      setProfileSaved(false);
    }
  }, [selectedUserId, db.researcher_profiles, currentUser.phone]);

  const visibleScientists = db.users.filter((u) => {
    if (!canViewResearcherProfile(db, currentUser, u)) return false;
    if (roleName === 'scientist') return mode === 'profiles' && u.id === currentUser.id;
    if (roleName === 'head_of_directorate' || roleName === 'directorate_admin') {
      if (u.directorate_id !== currentUser.directorate_id) return false;
    }
    if (dirFilter !== 'ALL') {
      if (dirFilter === 'HQ_OVERALL') {
        if (u.directorate_id !== null) return false;
      } else if (u.directorate_id !== dirFilter) {
        return false;
      }
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.staff_number.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleProvisionAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMsg(null);

    const emailClean = newEmail.trim().toLowerCase();
    const staffClean = newStaffNo.trim().toUpperCase();

    if (newPassword.length < 8) {
      setFeedbackMsg({
        type: 'err',
        text: 'Account password must be at least 8 characters.',
      });
      return;
    }

    if (db.users.some((u) => u.email.toLowerCase() === emailClean)) {
      setFeedbackMsg({
        type: 'err',
        text: `Unique constraint violation: Email "${emailClean}" already exists.`,
      });
      return;
    }
    if (db.users.some((u) => u.staff_number.toUpperCase() === staffClean)) {
      setFeedbackMsg({
        type: 'err',
        text: `Unique constraint violation: Staff number "${staffClean}" already exists.`,
      });
      return;
    }

    const assignedDirId = isInstitutionWideRole ? null : newDirectorateId;
    const now = new Date().toISOString();

    const user: User = {
      id: generateUuid(),
      full_name: newName.trim(),
      email: emailClean,
      phone: '',
      password_hash: await hashPasswordAsync(newPassword),
      staff_number: staffClean,
      profile_photo: '',
      position: newPosition.trim() || selectedRoleToCreate?.label || 'Research Staff',
      directorate_id: assignedDirId,
      research_area_id: assignedDirId
        ? db.research_areas.find((a) => a.directorate_id === assignedDirId)?.id || null
        : null,
      role_id: newRoleId,
      account_status: 'Active',
      failed_login_attempts: 0,
      last_login: null,
      created_at: now,
      updated_at: now,
    };

    const profile: ResearcherProfile = {
      id: generateUuid(),
      user_id: user.id,
      specialization: newSpecialization.trim(),
      academic_rank: user.position,
      qualifications: '',
      biography: '',
      orcid: newOrcid.trim(),
      phone: '',
      office_location: assignedDirId
        ? `${getDirectorateById(db, assignedDirId)?.code} Directorate`
        : 'KMFRI Headquarters, Mombasa',
      research_interests: newSpecialization.trim(),
      areas_of_expertise: newSpecialization.trim(),
      years_experience: 0,
      created_at: now,
      updated_at: now,
    };

    // If provisioning a Head of Directorate, link them as head_user_id on that Directorate
    const updatedDirectorates =
      selectedRoleToCreate?.name === 'head_of_directorate' && assignedDirId
        ? db.directorates.map((d) =>
            d.id === assignedDirId ? { ...d, head_user_id: user.id } : d
          )
        : db.directorates;

    let nextState: DatabaseState = {
      ...db,
      directorates: updatedDirectorates,
      users: [...db.users, user],
      researcher_profiles: [...db.researcher_profiles, profile],
      notifications: [
        {
          id: generateUuid(),
          user_id: user.id,
          title: 'KMFRI Institutional Account Provisioned',
          message: `Your ${selectedRoleToCreate?.label} account (${user.staff_number}) has been created by the System Administrator.`,
          type: 'system',
          related_module: 'profiles',
          related_entity_id: user.id,
          read_at: null,
          created_at: now,
        },
        ...db.notifications,
      ],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'PROVISION_USER_ACCOUNT',
      'users',
      user.id,
      null,
      {
        staff_number: user.staff_number,
        email: user.email,
        role: selectedRoleToCreate?.name,
        directorate_id: user.directorate_id,
      }
    );

    onUpdateDb(nextState);
    setShowAddStaffModal(false);
    setNewName('');
    setNewEmail('');
    setNewStaffNo('');
    setNewPassword('');
    setNewPosition('');
    setNewSpecialization('');
    setNewOrcid('');
    setFeedbackMsg({
      type: 'ok',
      text: `${selectedRoleToCreate?.label} account for ${user.full_name} (${user.staff_number}) created.`,
    });
  };

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      selectedUserId !== currentUser.id &&
      !['system_admin', 'directorate_admin'].includes(roleName)
    ) {
      setFeedbackMsg({
        type: 'err',
        text: 'Access denied: Scientists can only modify their own researcher profile.',
      });
      return;
    }

    const existing = db.researcher_profiles.find((p) => p.user_id === selectedUserId);
    const now = new Date().toISOString();

    const updated: ResearcherProfile = {
      ...(existing || {
        id: generateUuid(),
        user_id: selectedUserId,
        created_at: now,
      }),
      specialization: editSpec.trim(),
      academic_rank: editRank.trim(),
      qualifications: editQual.trim(),
      orcid: editOrcid.trim(),
      phone: editProfilePhone.trim(),
      office_location: editOffice.trim(),
      research_interests: editInterests.trim(),
      areas_of_expertise: editExpertise.trim(),
      years_experience: Math.max(0, Number(editYearsExperience) || 0),
      biography: editBio.trim(),
      updated_at: now,
    };

    let nextState: DatabaseState = {
      ...db,
      researcher_profiles: existing
        ? db.researcher_profiles.map((p) => (p.id === existing.id ? updated : p))
        : [...db.researcher_profiles, updated],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'RESEARCHER_PROFILE_UPDATED',
      'researcher_profiles',
      updated.id,
      { specialization: existing?.specialization || '', orcid: existing?.orcid || '' },
      { specialization: updated.specialization, orcid: updated.orcid }
    );

    onUpdateDb(nextState);
    setFeedbackMsg({ type: 'ok', text: 'Researcher academic profile updated and logged.' });
    setEditing(false);
    setProfileSaved(true);
  };

  const handleAdminDeleteUser = (targetUser: User) => {
    if (targetUser.id === currentUser.id) {
      setFeedbackMsg({
        type: 'err',
        text: 'Self-deletion guard: You cannot delete your own active session.',
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
      'ADMIN_DELETED_USER',
      'users',
      targetUser.id,
      { full_name: targetUser.full_name, staff_number: targetUser.staff_number },
      null
    );

    onUpdateDb(nextState);
    if (selectedUserId === targetUser.id) {
      setSelectedUserId(currentUser.id);
    }
    setFeedbackMsg({
      type: 'ok',
      text: `Deleted user account ${targetUser.full_name} (${targetUser.staff_number}).`,
    });
  };

  const inspectedUser = db.users.find((u) => u.id === selectedUserId) || currentUser;
  const inspectedDir = getDirectorateById(db, inspectedUser.directorate_id);
  const inspectedRole = getRoleById(db, inspectedUser.role_id);
  const userProjects = db.projects.filter(
    (p) =>
      p.principal_investigator_id === inspectedUser.id ||
      db.project_members.some((member) => member.project_id === p.id && member.user_id === inspectedUser.id)
  );
  const userOutputs = db.research_outputs.filter(
    (o) => o.lead_scientist_id === inspectedUser.id
  );

  const dgUser = db.users.find(
    (u) => getRoleById(db, u.role_id)?.name === 'director_general'
  );

  return (
    <div className="space-y-6">
      {/* System Administrator Quick Hierarchy Provisioning Bar (DG + 4 Directorate Heads + Scientists) */}
      {roleName === 'system_admin' && mode === 'scientists' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-teal-700 dark:text-teal-400 font-semibold block">
                Overall System Controller · Institutional Hierarchy Provisioning
              </span>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Director General (DG), Heads of the 4 Directorates & Scientists
              </h2>
            </div>
            <button
              type="button"
              onClick={() => openProvisionModalForRole('scientist', db.directorates[0]?.id)}
              className="px-3.5 py-2 bg-[#2E4B9E] hover:bg-[#1E3A8A] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Scientist Account</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
            {/* Director General Slot */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[11px] font-bold text-[#2E4B9E] dark:text-sky-400">
                    INSTITUTIONAL HQ
                  </span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#2E4B9E] dark:text-sky-400" />
                </div>
                <p className="font-bold text-slate-900 dark:text-white mb-1">
                  Director General (DG)
                </p>
                {dgUser ? (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium truncate">
                    {dgUser.full_name} ({dgUser.staff_number})
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">Not yet provisioned</p>
                )}
              </div>
              {!dgUser && (
                <button
                  type="button"
                  onClick={() => openProvisionModalForRole('director_general')}
                  className="mt-3 w-full py-1.5 px-2.5 rounded-lg bg-[#2E4B9E]/10 hover:bg-[#2E4B9E]/20 text-[#2E4B9E] dark:text-sky-300 font-semibold text-[11px] cursor-pointer"
                >
                  + Provision DG Account
                </button>
              )}
            </div>

            {/* 4 Core Directorates Head Slots */}
            {db.directorates.map((dir) => {
              const headUser = db.users.find(
                (u) =>
                  u.directorate_id === dir.id &&
                  getRoleById(db, u.role_id)?.name === 'head_of_directorate'
              );
              const dirScientistsCount = db.users.filter(
                (u) =>
                  u.directorate_id === dir.id &&
                  getRoleById(db, u.role_id)?.name === 'scientist'
              ).length;

              return (
                <div
                  key={dir.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[11px] font-bold text-teal-700 dark:text-teal-400">
                        {dir.code} DIRECTORATE
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {dirScientistsCount} Scientists
                      </span>
                    </div>
                    <p className="font-bold text-slate-900 dark:text-white line-clamp-1 mb-1">
                      {dir.name}
                    </p>
                    {headUser ? (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium truncate">
                        Head: {headUser.full_name}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-500">Head not yet assigned</p>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    {!headUser && (
                      <button
                        type="button"
                        onClick={() => openProvisionModalForRole('head_of_directorate', dir.id)}
                        className="flex-1 py-1.5 px-2 rounded-lg bg-teal-600/10 hover:bg-teal-600/20 text-teal-700 dark:text-teal-300 font-semibold text-[11px] cursor-pointer"
                      >
                        + Assign Head
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openProvisionModalForRole('scientist', dir.id)}
                      className="flex-1 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-[11px] cursor-pointer"
                    >
                      + Scientist
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            {mode === 'scientists'
              ? `KMFRI Institutional Accounts & Scientists Directory (${visibleScientists.length})`
              : roleName === 'scientist'
                ? 'My Researcher Profile'
                : 'Comprehensive Researcher Academic & ORCID Profile'}
          </h1>
          <p className="text-xs text-slate-500">
            Enforces unique staff numbers, institutional emails, and role-scoped directorate assignments.
          </p>
        </div>

        {!(roleName === 'scientist' && mode === 'profiles') && <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search name, staff no, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <select
            value={dirFilter}
            onChange={(e) => setDirFilter(e.target.value)}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800"
          >
            <option value="ALL">All Directorates & HQ</option>
            <option value="HQ_OVERALL">HQ / Institution-Wide (SysAdmin & DG)</option>
            {db.directorates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>

          {canProvisionStaff && (
            <button
              type="button"
              onClick={() => setShowAddStaffModal(true)}
              className="px-3.5 py-1.5 bg-[#0A2540] hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Institutional Account</span>
            </button>
          )}
        </div>}
      </div>

      {feedbackMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            feedbackMsg.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {feedbackMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Scientists Directory Table */}
        {!(roleName === 'scientist' && mode === 'profiles') && <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 dark:text-white">
              Registered Institutional Users & Scientists
            </h2>
            <span className="text-[11px] text-slate-500">Click row to inspect profile</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                  <th className="py-2.5 px-4">Staff No.</th>
                  <th className="py-2.5 px-4">Name & Email</th>
                  <th className="py-2.5 px-4">Scope / Directorate</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Status</th>
                  {roleName === 'system_admin' && (
                    <th className="py-2.5 px-4 text-right">Admin Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleScientists.map((u) => {
                  const d = getDirectorateById(db, u.directorate_id);
                  const r = getRoleById(db, u.role_id);
                  const isSelected = u.id === selectedUserId;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-teal-50/70 dark:bg-teal-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-teal-700 dark:text-teal-400">
                        {u.staff_number}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {u.full_name}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {d ? d.code : 'HQ (Institution-Wide)'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {r?.label || r?.name}
                      </td>
                      <td className="py-3 px-4 font-medium">{u.account_status}</td>
                      {roleName === 'system_admin' && (
                        <td
                          className="py-3 px-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedUserId(u.id)}
                              className="px-2 py-1 rounded bg-[#173B75]/10 hover:bg-[#173B75] text-[#173B75] dark:text-sky-300 hover:text-white text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                              title="Inspect or Reset Password"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>Password</span>
                            </button>
                            {u.id !== currentUser.id && (
                              <button
                                type="button"
                                onClick={() => handleAdminDeleteUser(u)}
                                className="px-2 py-1 rounded bg-red-50 dark:bg-red-950/50 hover:bg-red-600 text-red-600 dark:text-red-300 hover:text-white text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                title="Delete User Account"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>}

        {/* Comprehensive Researcher Profile Inspector & Editor */}
        <div className={`${roleName === 'scientist' && mode === 'profiles' ? 'lg:col-span-12' : 'lg:col-span-5'} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5`}>
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400">
                {inspectedUser.staff_number}
              </span>
              <span className="text-xs text-slate-500">{inspectedRole?.label}</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              {inspectedUser.full_name}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">{inspectedUser.position}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-teal-600" />
                {inspectedDir
                  ? `${inspectedDir.code} — ${inspectedDir.name}`
                  : 'Institution-Wide Authority (All 4 Directorates)'}
              </span>
              <span className="flex items-center gap-1 font-mono">
                <Mail className="w-3.5 h-3.5 text-teal-600" />
                {inspectedUser.email}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 block">Led Projects</span>
              <span className="text-base font-bold font-mono">{userProjects.length}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 block">Lead Publications</span>
              <span className="text-base font-bold font-mono">{userOutputs.length}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border-b border-slate-200 dark:border-slate-800 pb-4">
            <div><span className="text-slate-500 block">Contact phone</span><span className="font-medium">{activeProfile?.phone || inspectedUser.phone || 'Not provided'}</span></div>
            <div><span className="text-slate-500 block">Years of experience</span><span className="font-medium">{activeProfile?.years_experience || 0}</span></div>
            <div className="sm:col-span-2"><span className="text-slate-500 block">Research interests</span><span className="font-medium">{activeProfile?.research_interests || 'Not provided'}</span></div>
            <div className="sm:col-span-2"><span className="text-slate-500 block">Areas of expertise</span><span className="font-medium">{activeProfile?.areas_of_expertise || 'Not provided'}</span></div>
          </div>

          {editable ? (
            <form onSubmit={handleUpdateProfile} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Academic Rank / Title
                  </label>
                  <input
                    type="text"
                    value={editRank}
                    onChange={(e) => setEditRank(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    ORCID Identifier
                  </label>
                  <input
                    type="text"
                    placeholder="0000-0000-0000-0000"
                    value={editOrcid}
                    onChange={(e) => setEditOrcid(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Specialization & Research Domain
                </label>
                <input
                  type="text"
                  value={editSpec}
                  onChange={(e) => setEditSpec(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Academic Qualifications
                </label>
                <input
                  type="text"
                  value={editQual}
                  onChange={(e) => setEditQual(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Areas of Expertise</label>
                  <input type="text" value={editExpertise} onChange={(e) => setEditExpertise(e.target.value)} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Years of Experience</label>
                  <input type="number" min="0" value={editYearsExperience} onChange={(e) => setEditYearsExperience(Number(e.target.value))} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Phone</label>
                  <input type="text" value={editProfilePhone} onChange={(e) => setEditProfilePhone(e.target.value)} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Office & Station Location
                </label>
                <input
                  type="text"
                  value={editOffice}
                  onChange={(e) => setEditOffice(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Biography & Institutional Contributions
                </label>
                <textarea
                  rows={3}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              {showEditButton && (
                <button
                  type="submit"
                  className="w-full py-2 px-4 bg-[#0A2540] hover:bg-slate-800 text-white font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Save Permitted Profile Fields</span>
                </button>
              )}
            </form>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <Lock className="w-4 h-4 shrink-0" />
                <span className="text-xs font-semibold">
                  Profile editing is locked. Complete your profile first, then enable editing to make changes.
                </span>
              </div>
              {showEditButton && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="w-full py-2 px-4 bg-[#173B75] hover:bg-[#3155A4] text-white font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Enable Editing</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Provision Institutional Account Modal (DG, Head of Directorate, Directorate Admin, Scientist) */}
      {showAddStaffModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-xl">
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display mb-1">
              Create KMFRI Institutional Account
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Provision accounts for the Director General, Heads of the 4 Directorates (OCS, FWS, ARD, SED), Directorate Administrators, or Scientists.
            </p>
            <form onSubmit={handleProvisionAccount} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">System Role</label>
                  <select
                    value={newRoleId}
                    onChange={(e) => setNewRoleId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {db.roles
                      .filter((r) =>
                        roleName === 'system_admin'
                          ? true
                          : r.name === 'scientist'
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                  </select>
                </div>

                {!isInstitutionWideRole ? (
                  <div>
                    <label className="block font-semibold mb-1">Assigned Directorate</label>
                    <select
                      value={newDirectorateId}
                      onChange={(e) => setNewDirectorateId(e.target.value)}
                      disabled={roleName === 'directorate_admin'}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      {db.directorates.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block font-semibold mb-1">Authority Scope</label>
                    <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 font-mono text-[11px] text-teal-700 dark:text-teal-400">
                      Institution-Wide (All 4 Directorates)
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Full Name & Title</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter full name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Official Position / Title</label>
                  <input
                    type="text"
                    placeholder={selectedRoleToCreate?.label || 'Position title'}
                    value={newPosition}
                    onChange={(e) => setNewPosition(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Unique Institutional Email</label>
                  <input
                    type="email"
                    required
                    placeholder="name@kmfri.go.ke"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Unique Staff Number</label>
                  <input
                    type="text"
                    required
                    placeholder="KMFRI/..."
                    value={newStaffNo}
                    onChange={(e) => setNewStaffNo(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  Account Password (minimum 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Set login password for this user"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-3 pr-9 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Specialization (Optional)</label>
                  <input
                    type="text"
                    placeholder="Research specialization"
                    value={newSpecialization}
                    onChange={(e) => setNewSpecialization(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">ORCID (Optional)</label>
                  <input
                    type="text"
                    placeholder="0000-0000-0000-0000"
                    value={newOrcid}
                    onChange={(e) => setNewOrcid(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddStaffModal(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#2E4B9E] hover:bg-[#1E3A8A] text-white rounded-lg font-semibold cursor-pointer"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
