import React, { useState } from 'react';
import {
  DatabaseState,
  User,
  ResearchActivity,
  FundingRecord,
  FundingTransaction,
  Funder,
} from '../types/kmfri.ts';
import {
  generateUuid,
  getDirectorateById,
  getUserById,
  appendAuditLog,
} from '../services/database.ts';
import { filterProjectsForUser, getUserRoleName } from '../services/rbacPolicy.ts';
import {
  Plus,
  Activity,
  Landmark,
  ArrowDownRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

interface OperationsAndFundingModulesProps {
  db: DatabaseState;
  currentUser: User;
  mode: 'activities' | 'funding';
  onUpdateDb: (next: DatabaseState) => void;
}

export const OperationsAndFundingModules: React.FC<OperationsAndFundingModulesProps> = ({
  db,
  currentUser,
  mode,
  onUpdateDb,
}) => {
  const roleName = getUserRoleName(db, currentUser);
  const authorizedProjects = filterProjectsForUser(db, currentUser);
  const activityProjects = roleName === 'scientist'
    ? authorizedProjects.filter((project) =>
        project.principal_investigator_id === currentUser.id ||
        project.created_by === currentUser.id ||
        db.project_members.some((member) => member.project_id === project.id && member.user_id === currentUser.id)
      )
    : authorizedProjects;
  const visibleActivities = db.research_activities.filter((activity) =>
    roleName === 'scientist'
      ? activity.scientist_id === currentUser.id
      : authorizedProjects.some((project) => project.id === activity.project_id)
  );
  const [alertMsg, setAlertMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Activity form state (clean empty inputs — zero dummy data)
  const [actTitle, setActTitle] = useState('');
  const [actCategory, setActCategory] = useState<ResearchActivity['activity_category']>('Fieldwork');
  const [actProjectId, setActProjectId] = useState(activityProjects[0]?.id || '');
  const [actDate, setActDate] = useState('');
  const [actHours, setActHours] = useState('');
  const [actStatus, setActStatus] = useState<ResearchActivity['status']>('Completed');
  const [actDesc, setActDesc] = useState('');

  // Funding form state (clean empty inputs — zero dummy data)
  const [funderName, setFunderName] = useState('');
  const [fundingType, setFundingType] = useState<Funder['funding_type']>('International Foundation');
  const [funderCountry, setFunderCountry] = useState('');
  const [grantNumber, setGrantNumber] = useState('');
  const [fundingProjectId, setFundingProjectId] = useState(authorizedProjects[0]?.id || '');
  const [awardAmount, setAwardAmount] = useState('');
  const [allocatedAmount, setAllocatedAmount] = useState('');
  const [currency, setCurrency] = useState<FundingRecord['currency']>('KES');

  // Expenditure transaction form state (clean empty inputs — zero dummy data)
  const [selectedFundingId, setSelectedFundingId] = useState(db.funding[0]?.id || '');
  const [txAmount, setTxAmount] = useState('');
  const [txRef, setTxRef] = useState('');
  const [txDesc, setTxDesc] = useState('');

  const handleCreateActivity = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);
    const proj = activityProjects.find((p) => p.id === actProjectId);
    if (!proj) {
      setAlertMsg({
        type: 'err',
        text: 'Please create a Research Project first before logging project-linked fieldwork activities.',
      });
      return;
    }

    const activity: ResearchActivity = {
      id: generateUuid(),
      project_id: proj.id,
      scientist_id: currentUser.id,
      directorate_id: proj.directorate_id,
      title: actTitle.trim(),
      activity_category: actCategory,
      description: actDesc.trim() || actTitle.trim(),
      activity_date: actDate,
      location_id: db.locations[0]?.id || null,
      status: actStatus,
      hours: Math.max(0.5, Number(actHours) || 1),
      created_at: new Date().toISOString(),
    };

    let nextState: DatabaseState = {
      ...db,
      research_activities: [activity, ...db.research_activities],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'RESEARCH_ACTIVITY_LOGGED',
      'research_activities',
      activity.id,
      null,
      { title: activity.title, project_code: proj.project_code, hours: activity.hours }
    );

    onUpdateDb(nextState);
    setActTitle('');
    setActDesc('');
    setAlertMsg({ type: 'ok', text: `Research activity "${activity.title}" recorded.` });
  };

  const handleCreateGrant = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);
    const proj = db.projects.find((p) => p.id === fundingProjectId) || authorizedProjects[0];
    if (!proj) {
      setAlertMsg({
        type: 'err',
        text: 'Please create a Research Project first before linking a grant award.',
      });
      return;
    }

    if (db.funding.some((f) => f.grant_number.toUpperCase() === grantNumber.trim().toUpperCase())) {
      setAlertMsg({
        type: 'err',
        text: `Duplicate grant number "${grantNumber.trim()}". Enforce unique grant references.`,
      });
      return;
    }

    const awardNum = Number(awardAmount) || 0;
    const allocNum = Number(allocatedAmount) || 0;

    if (awardNum <= 0 || allocNum < 0 || allocNum > awardNum) {
      setAlertMsg({
        type: 'err',
        text: 'Validation error: Allocated funds cannot be negative or exceed the total award amount.',
      });
      return;
    }

    const now = new Date().toISOString();
    const funder: Funder = {
      id: generateUuid(),
      name: funderName.trim(),
      funding_type: fundingType,
      country: funderCountry.trim(),
      contact_person: 'Grants Programme Secretariat',
      email: 'grants@funder.org',
      phone: '+254 20 000 000',
      website: 'https://www.kmfri.go.ke',
      created_at: now,
    };

    const fundingRecord: FundingRecord = {
      id: generateUuid(),
      project_id: proj.id,
      funder_id: funder.id,
      principal_investigator_id: proj.principal_investigator_id,
      grant_number: grantNumber.trim().toUpperCase(),
      award_reference: grantNumber.trim().toUpperCase(),
      funding_source: funder.name,
      funding_type: fundingType,
      award_amount: awardNum,
      currency,
      award_date: now.slice(0, 10),
      funding_start_date: proj.start_date,
      funding_end_date: proj.expected_end_date,
      allocated_amount: allocNum,
      spent_amount: 0,
      remaining_balance: allocNum,
      status: 'Active',
      notes: 'Initial grant allocation verified.',
      created_at: now,
      updated_at: now,
    };

    let nextState: DatabaseState = {
      ...db,
      funders: [funder, ...db.funders],
      funding: [fundingRecord, ...db.funding],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'GRANT_FUNDING_AWARD_RECORDED',
      'funding',
      fundingRecord.id,
      null,
      {
        grant_number: fundingRecord.grant_number,
        award_amount: fundingRecord.award_amount,
        allocated_amount: fundingRecord.allocated_amount,
      }
    );

    onUpdateDb(nextState);
    setSelectedFundingId(fundingRecord.id);
    setGrantNumber(`WIOMSA-MASMA-2026-${nextState.funding.length + 1}`);
    setAlertMsg({
      type: 'ok',
      text: `Grant ${fundingRecord.grant_number} recorded with remaining balance ${currency} ${allocNum.toLocaleString()}.`,
    });
  };

  const handleRecordExpenditure = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);

    const targetFunding =
      db.funding.find((f) => f.id === selectedFundingId) || db.funding[0];
    if (!targetFunding) {
      setAlertMsg({ type: 'err', text: 'Select an active grant award first.' });
      return;
    }

    const amountNum = Number(txAmount) || 0;
    if (amountNum <= 0) {
      setAlertMsg({ type: 'err', text: 'Expenditure amount must be greater than zero.' });
      return;
    }

    const newSpent = targetFunding.spent_amount + amountNum;
    const newRemaining = targetFunding.allocated_amount - newSpent;

    // Section 8 Requirement: "Calculate remaining balance as allocated funds minus recorded expenditure. Validate amounts and prevent invalid or unexplained negative balances"
    if (newRemaining < 0) {
      setAlertMsg({
        type: 'err',
        text: `Policy Violation: Expenditure of ${targetFunding.currency} ${amountNum.toLocaleString()} exceeds remaining allocated balance (${targetFunding.currency} ${targetFunding.remaining_balance.toLocaleString()}). Negative balances are prohibited.`,
      });
      return;
    }

    const now = new Date().toISOString();
    const tx: FundingTransaction = {
      id: generateUuid(),
      funding_id: targetFunding.id,
      transaction_type: 'Expenditure',
      amount: amountNum,
      transaction_date: now.slice(0, 10),
      reference: txRef.trim().toUpperCase(),
      description: txDesc.trim(),
      recorded_by: currentUser.id,
      created_at: now,
    };

    const updatedFunding: FundingRecord = {
      ...targetFunding,
      spent_amount: newSpent,
      remaining_balance: newRemaining,
      status: newRemaining === 0 ? 'Exhausted' : targetFunding.status,
      updated_at: now,
    };

    let nextState: DatabaseState = {
      ...db,
      funding: db.funding.map((f) => (f.id === targetFunding.id ? updatedFunding : f)),
      funding_transactions: [tx, ...db.funding_transactions],
    };

    nextState = appendAuditLog(
      nextState,
      currentUser,
      'FUNDING_EXPENDITURE_RECORDED',
      'funding_transactions',
      tx.id,
      { spent_amount: targetFunding.spent_amount, remaining_balance: targetFunding.remaining_balance },
      { spent_amount: newSpent, remaining_balance: newRemaining, voucher: tx.reference }
    );

    onUpdateDb(nextState);
    setTxRef(`VCH-KMFRI-${nextState.funding_transactions.length + 101}`);
    setAlertMsg({
      type: 'ok',
      text: `Expenditure voucher ${tx.reference} posted. Remaining grant balance: ${targetFunding.currency} ${newRemaining.toLocaleString()}.`,
    });
  };

  if (mode === 'activities') {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Research Activities, Fieldwork & Cruises Log ({visibleActivities.length})
          </h1>
          <p className="text-xs text-slate-500">
            Record hydrographic surveys, laboratory analyses, sample collection, and stakeholder workshops.
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
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-4">
              Log Scientific Activity
            </h2>
            <form onSubmit={handleCreateActivity} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Linked Research Project</label>
                <select
                  value={actProjectId}
                  onChange={(e) => setActProjectId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white dark:bg-slate-800"
                >
                  {activityProjects.length === 0 ? (
                    <option value="">-- Create a Project First --</option>
                  ) : (
                    activityProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_code} — {p.title}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Activity Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Benthic Coral Transect Sampling at Kisite-Mpunguti"
                  value={actTitle}
                  onChange={(e) => setActTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Category</label>
                  <select
                    value={actCategory}
                    onChange={(e) =>
                      setActCategory(e.target.value as ResearchActivity['activity_category'])
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  >
                    <option value="Fieldwork">Fieldwork</option>
                    <option value="Laboratory Research">Laboratory Research</option>
                    <option value="Hydrographic Survey">Hydrographic Survey</option>
                    <option value="Sample Collection">Sample Collection</option>
                    <option value="Data Analysis">Data Analysis</option>
                    <option value="Stakeholder Meeting">Stakeholder Meeting</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    value={actDate}
                    onChange={(e) => setActDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Duration (Hours)</label>
                  <input
                    type="number"
                    min="1"
                    value={actHours}
                    onChange={(e) => setActHours(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Status</label>
                  <select
                    value={actStatus}
                    onChange={(e) => setActStatus(e.target.value as ResearchActivity['status'])}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  >
                    <option value="Completed">Completed</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Planned">Planned</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Scientific Observations & Notes</label>
                <textarea
                  rows={2}
                  value={actDesc}
                  onChange={(e) => setActDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 px-4 bg-[#0A2540] text-white font-semibold rounded-lg cursor-pointer"
              >
                Record Research Activity
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                Recorded Scientific Activities Timeline ({visibleActivities.length})
              </h2>
            </div>
            {visibleActivities.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                Zero research activities recorded yet. Use the form on the left to log fieldwork or lab
                sessions.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Activity & Category</th>
                      <th className="py-2.5 px-4">Scientist</th>
                      <th className="py-2.5 px-4 text-right">Hours</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {visibleActivities.map((a) => {
                      const sci = getUserById(db, a.scientist_id);
                      return (
                        <tr key={a.id}>
                          <td className="py-2.5 px-4 font-mono">{a.activity_date}</td>
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {a.title}
                            </div>
                            <div className="text-[11px] text-slate-500">{a.activity_category}</div>
                          </td>
                          <td className="py-2.5 px-4">{sci?.full_name}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{a.hours}h</td>
                          <td className="py-2.5 px-4">{a.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
          Grants, Donor Funding & Expenditure Ledger ({db.funding.length} Grants)
        </h1>
        <p className="text-xs text-slate-500">
          Calculates Remaining Balance = Allocated Funds − Recorded Expenditure and prevents unexplained
          negative balances.
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
        {/* Register Grant Award */}
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
            1. Register Grant Award & Allocation
          </h2>
          <form onSubmit={handleCreateGrant} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Funder / Donor Organization</label>
                <input
                  type="text"
                  required
                  value={funderName}
                  onChange={(e) => setFunderName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Unique Grant Number</label>
                <input
                  type="text"
                  required
                  value={grantNumber}
                  onChange={(e) => setGrantNumber(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">Linked KMFRI Project</label>
              <select
                value={fundingProjectId}
                onChange={(e) => setFundingProjectId(e.target.value)}
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

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold mb-1">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as FundingRecord['currency'])}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                >
                  <option value="KES">KES</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Total Award Amount</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={awardAmount}
                  onChange={(e) => setAwardAmount(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Allocated to Project</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={allocatedAmount}
                  onChange={(e) => setAllocatedAmount(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2 px-4 bg-[#0A2540] text-white font-semibold rounded-lg cursor-pointer"
            >
              Register Grant Award
            </button>
          </form>
        </div>

        {/* Record Expenditure Transaction */}
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
            2. Post Audited Expenditure Transaction
          </h2>
          <form onSubmit={handleRecordExpenditure} className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Target Grant Account</label>
              <select
                value={selectedFundingId}
                onChange={(e) => setSelectedFundingId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white dark:bg-slate-800 font-mono"
              >
                {db.funding.length === 0 ? (
                  <option value="">-- Register a Grant Award First --</option>
                ) : (
                  db.funding.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.grant_number} (Balance: {f.currency} {f.remaining_balance.toLocaleString()})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Expenditure Amount</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Financial Voucher Reference</label>
                <input
                  type="text"
                  required
                  value={txRef}
                  onChange={(e) => setTxRef(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">Expenditure Line Description</label>
              <input
                type="text"
                required
                value={txDesc}
                onChange={(e) => setTxDesc(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 px-4 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg cursor-pointer"
            >
              Post Expenditure & Recalculate Balance
            </button>
          </form>
        </div>
      </div>

      {/* Grants Ledger Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white">
            Active Grants & Real-Time Balance Sheet
          </h2>
        </div>
        {db.funding.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            Zero funding records stored. Register a grant above to track allocations and expenditures.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-4">Grant Number</th>
                  <th className="py-2.5 px-4">Funder Source</th>
                  <th className="py-2.5 px-4 text-right">Award Amount</th>
                  <th className="py-2.5 px-4 text-right">Allocated</th>
                  <th className="py-2.5 px-4 text-right">Spent</th>
                  <th className="py-2.5 px-4 text-right">Remaining Balance</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {db.funding.map((f) => (
                  <tr key={f.id}>
                    <td className="py-3 px-4 font-mono font-bold text-teal-700">{f.grant_number}</td>
                    <td className="py-3 px-4">{f.funding_source}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {f.currency} {f.award_amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {f.currency} {f.allocated_amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700">
                      {f.currency} {f.spent_amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                      {f.currency} {f.remaining_balance.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-medium">{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
