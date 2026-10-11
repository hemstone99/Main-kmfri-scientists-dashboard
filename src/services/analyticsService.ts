import {
  DatabaseState,
  Project,
  ProjectMilestone,
  ResearchOutput,
  ResearchActivity,
  FundingRecord,
  FundingTransaction,
} from '../types/kmfri.ts';

export type TrendGranularity = 'monthly' | 'quarterly' | 'yearly';

export interface ProductivityTrendSeries {
  labels: string[];
  projectsStarted: number[];
  projectsCompleted: number[];
  milestonesCompleted: number[];
  outputsPublished: number[];
  activitiesLogged: number[];
  fieldworkHours: number[];
  summary: {
    totalInitiated: number;
    totalCompleted: number;
    completionRatePct: number;
    totalOutputs: number;
    totalFieldHours: number;
  };
  hasData: boolean;
}

export interface FundingTrendSeries {
  labels: string[];
  awardedAmounts: number[];
  allocatedAmounts: number[];
  spentAmounts: number[];
  remainingBalances: number[];
  absorptionRatePct: number[];
  summary: {
    totalAwardedKes: number;
    totalAllocatedKes: number;
    totalSpentKes: number;
    totalRemainingKes: number;
    overallAbsorptionPct: number;
  };
  hasData: boolean;
}

export interface DirectorateFundingBreakdown {
  codes: string[];
  names: string[];
  allocatedByDirectorate: number[];
  spentByDirectorate: number[];
  remainingByDirectorate: number[];
  projectCountByDirectorate: number[];
}

function formatTimeBucket(
  isoDate: string | null | undefined,
  granularity: TrendGranularity
): string | null {
  if (!isoDate || isoDate.length < 7) return null;
  const year = isoDate.slice(0, 4);
  const month = parseInt(isoDate.slice(5, 7), 10);
  if (Number.isNaN(month) || month < 1 || month > 12) return null;

  if (granularity === 'yearly') return year;
  if (granularity === 'quarterly') {
    const q = Math.floor((month - 1) / 3) + 1;
    return `${year}-Q${q}`;
  }
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${year}-${String(month).padStart(2, '0')} (${monthNames[month - 1]})`;
}

function getDefaultEmptyBuckets(granularity: TrendGranularity): string[] {
  const currentYear = new Date().getFullYear().toString();
  if (granularity === 'yearly') {
    return [currentYear];
  }
  if (granularity === 'quarterly') {
    return [`${currentYear}-Q1`, `${currentYear}-Q2`, `${currentYear}-Q3`, `${currentYear}-Q4`];
  }
  return [
    `${currentYear}-01 (Jan)`,
    `${currentYear}-02 (Feb)`,
    `${currentYear}-03 (Mar)`,
    `${currentYear}-04 (Apr)`,
    `${currentYear}-05 (May)`,
    `${currentYear}-06 (Jun)`,
  ];
}

/**
 * Real-time analytical calculation of research productivity trends from stored
 * project, milestone, publication output, and fieldwork activity records.
 */
export function computeProjectProductivityTrends(
  projects: Project[],
  outputs: ResearchOutput[],
  activities: ResearchActivity[],
  granularity: TrendGranularity = 'quarterly',
  milestones: ProjectMilestone[] = []
): ProductivityTrendSeries {
  const bucketSet = new Set<string>();

  projects.forEach((p) => {
    const bStart = formatTimeBucket(p.start_date, granularity);
    if (bStart) bucketSet.add(bStart);
    const compDate =
      p.actual_completion_date || (p.status === 'Completed' ? p.expected_end_date : null);
    const bEnd = formatTimeBucket(compDate, granularity);
    if (bEnd) bucketSet.add(bEnd);
  });

  milestones.forEach((m) => {
    const bMs = formatTimeBucket(m.completed_date || m.due_date, granularity);
    if (bMs) bucketSet.add(bMs);
  });

  outputs.forEach((o) => {
    const bOut = formatTimeBucket(o.publication_date, granularity);
    if (bOut) bucketSet.add(bOut);
  });

  activities.forEach((a) => {
    const bAct = formatTimeBucket(a.activity_date, granularity);
    if (bAct) bucketSet.add(bAct);
  });

  const hasData = bucketSet.size > 0;
  const labels = hasData
    ? Array.from(bucketSet).sort()
    : getDefaultEmptyBuckets(granularity);

  const projectsStarted = labels.map(
    (lbl) => projects.filter((p) => formatTimeBucket(p.start_date, granularity) === lbl).length
  );

  const projectsCompleted = labels.map(
    (lbl) =>
      projects.filter((p) => {
        if (p.status !== 'Completed') return false;
        const compDate = p.actual_completion_date || p.expected_end_date;
        return formatTimeBucket(compDate, granularity) === lbl;
      }).length
  );

  const milestonesCompleted = labels.map(
    (lbl) =>
      milestones.filter(
        (m) =>
          m.status === 'Completed' &&
          formatTimeBucket(m.completed_date || m.due_date, granularity) === lbl
      ).length
  );

  const outputsPublished = labels.map(
    (lbl) =>
      outputs.filter((o) => formatTimeBucket(o.publication_date, granularity) === lbl).length
  );

  const activitiesLogged = labels.map(
    (lbl) =>
      activities.filter((a) => formatTimeBucket(a.activity_date, granularity) === lbl).length
  );

  const fieldworkHours = labels.map((lbl) =>
    activities
      .filter((a) => formatTimeBucket(a.activity_date, granularity) === lbl)
      .reduce((sum, a) => sum + (Number(a.hours) || 0), 0)
  );

  const totalInitiated = projects.length;
  const totalCompleted = projects.filter((p) => p.status === 'Completed').length;
  const completionRatePct =
    totalInitiated > 0 ? Math.round((totalCompleted / totalInitiated) * 100) : 0;
  const totalOutputs = outputs.length;
  const totalFieldHours = activities.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);

  return {
    labels,
    projectsStarted,
    projectsCompleted,
    milestonesCompleted,
    outputsPublished,
    activitiesLogged,
    fieldworkHours,
    summary: {
      totalInitiated,
      totalCompleted,
      completionRatePct,
      totalOutputs,
      totalFieldHours,
    },
    hasData,
  };
}

/**
 * Real-time analytical calculation of funding awards, budget allocations,
 * recorded expenditures, remaining balances, and absorption rates.
 * Combines explicit grant records (`funding`) and project budgets (`projects.budget`)
 * so newly created projects or grants immediately reflect in real time.
 */
export function computeFundingAllocationTrends(
  fundingRecords: FundingRecord[],
  granularity: TrendGranularity = 'quarterly',
  projects: Project[] = [],
  transactions: FundingTransaction[] = []
): FundingTrendSeries {
  const bucketSet = new Set<string>();

  // Identify projects that do not yet have a dedicated FundingRecord entry
  const fundedProjectIds = new Set(fundingRecords.map((f) => f.project_id));
  const standaloneBudgetProjects = projects.filter(
    (p) => !fundedProjectIds.has(p.id) && p.budget > 0
  );

  fundingRecords.forEach((f) => {
    const b = formatTimeBucket(f.award_date || f.funding_start_date, granularity);
    if (b) bucketSet.add(b);
  });

  standaloneBudgetProjects.forEach((p) => {
    const b = formatTimeBucket(p.start_date, granularity);
    if (b) bucketSet.add(b);
  });

  transactions.forEach((tx) => {
    const b = formatTimeBucket(tx.transaction_date, granularity);
    if (b) bucketSet.add(b);
  });

  const hasData = bucketSet.size > 0;
  const labels = hasData
    ? Array.from(bucketSet).sort()
    : getDefaultEmptyBuckets(granularity);

  const awardedAmounts = labels.map((lbl) => {
    const fromGrants = fundingRecords
      .filter((f) => formatTimeBucket(f.award_date || f.funding_start_date, granularity) === lbl)
      .reduce((sum, f) => sum + f.award_amount, 0);
    const fromProjects = standaloneBudgetProjects
      .filter((p) => formatTimeBucket(p.start_date, granularity) === lbl)
      .reduce((sum, p) => sum + p.budget, 0);
    return fromGrants + fromProjects;
  });

  const allocatedAmounts = labels.map((lbl) => {
    const fromGrants = fundingRecords
      .filter((f) => formatTimeBucket(f.award_date || f.funding_start_date, granularity) === lbl)
      .reduce((sum, f) => sum + f.allocated_amount, 0);
    const fromProjects = standaloneBudgetProjects
      .filter((p) => formatTimeBucket(p.start_date, granularity) === lbl)
      .reduce((sum, p) => sum + p.budget, 0);
    return fromGrants + fromProjects;
  });

  const spentAmounts = labels.map((lbl) => {
    const fromGrants = fundingRecords
      .filter((f) => formatTimeBucket(f.award_date || f.funding_start_date, granularity) === lbl)
      .reduce((sum, f) => sum + f.spent_amount, 0);
    return fromGrants;
  });

  const remainingBalances = labels.map((_, idx) =>
    Math.max(0, allocatedAmounts[idx] - spentAmounts[idx])
  );

  const absorptionRatePct = labels.map((_, idx) =>
    allocatedAmounts[idx] > 0
      ? Math.min(100, Math.round((spentAmounts[idx] / allocatedAmounts[idx]) * 100))
      : 0
  );

  const totalAwardedKes = awardedAmounts.reduce((a, b) => a + b, 0);
  const totalAllocatedKes = allocatedAmounts.reduce((a, b) => a + b, 0);
  const totalSpentKes = spentAmounts.reduce((a, b) => a + b, 0);
  const totalRemainingKes = Math.max(0, totalAllocatedKes - totalSpentKes);
  const overallAbsorptionPct =
    totalAllocatedKes > 0 ? Math.round((totalSpentKes / totalAllocatedKes) * 100) : 0;

  return {
    labels,
    awardedAmounts,
    allocatedAmounts,
    spentAmounts,
    remainingBalances,
    absorptionRatePct,
    summary: {
      totalAwardedKes,
      totalAllocatedKes,
      totalSpentKes,
      totalRemainingKes,
      overallAbsorptionPct,
    },
    hasData,
  };
}

/**
 * Computes directorate-level funding allocation vs. expenditure from actual DB records.
 */
export function computeDirectorateFundingBreakdown(
  db: DatabaseState,
  authorizedProjects: Project[],
  authorizedFunding: FundingRecord[]
): DirectorateFundingBreakdown {
  const codes = db.directorates.map((d) => d.code);
  const names = db.directorates.map((d) => d.name);
  const fundedProjectIds = new Set(authorizedFunding.map((f) => f.project_id));

  const allocatedByDirectorate = db.directorates.map((d) => {
    const dirProjs = authorizedProjects.filter((p) => p.directorate_id === d.id);
    const dirProjIds = new Set(dirProjs.map((p) => p.id));
    const grantAllocated = authorizedFunding
      .filter((f) => dirProjIds.has(f.project_id))
      .reduce((sum, f) => sum + f.allocated_amount, 0);
    const standaloneBudget = dirProjs
      .filter((p) => !fundedProjectIds.has(p.id))
      .reduce((sum, p) => sum + p.budget, 0);
    return grantAllocated + standaloneBudget;
  });

  const spentByDirectorate = db.directorates.map((d) => {
    const dirProjIds = new Set(
      authorizedProjects.filter((p) => p.directorate_id === d.id).map((p) => p.id)
    );
    return authorizedFunding
      .filter((f) => dirProjIds.has(f.project_id))
      .reduce((sum, f) => sum + f.spent_amount, 0);
  });

  const remainingByDirectorate = db.directorates.map((_, idx) =>
    Math.max(0, allocatedByDirectorate[idx] - spentByDirectorate[idx])
  );

  const projectCountByDirectorate = db.directorates.map(
    (d) => authorizedProjects.filter((p) => p.directorate_id === d.id).length
  );

  return {
    codes,
    names,
    allocatedByDirectorate,
    spentByDirectorate,
    remainingByDirectorate,
    projectCountByDirectorate,
  };
}
