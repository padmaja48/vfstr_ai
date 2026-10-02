import { QuestionConcept } from '../models/QuestionConcept';

/** Approved pilot sets after last manual cleanup (Aug 22). */
export const APPROVED_PILOT_KEEP_PREFIX: Record<string, { prefix: string; expected: number }> = {
  amazon: { prefix: '6a893c7c', expected: 28 },
  tcs: { prefix: '6a893c86', expected: 28 },
  razorpay: { prefix: '6a893c8e', expected: 28 },
  siemens: { prefix: '6a893ead', expected: 18 },
  'pennant-technologies': { prefix: '6a893eb8', expected: 9 },
};

export type ApprovedPilotRestoreCompanyReport = {
  companySlug: string;
  prefix: string;
  expected: number;
  restoreCount: number;
  priorStatuses: string[];
  wrongActiveArchivedCount: number;
  activeAfter?: number;
};

export type ApprovedPilotRestoreReport = {
  dryRun: boolean;
  companies: ApprovedPilotRestoreCompanyReport[];
  totalActive: number;
};

export const restoreApprovedPilotConcepts = async (apply: boolean): Promise<ApprovedPilotRestoreReport> => {
  const companies: ApprovedPilotRestoreCompanyReport[] = [];

  for (const [companySlug, { prefix, expected }] of Object.entries(APPROVED_PILOT_KEEP_PREFIX)) {
    const candidates = await QuestionConcept.find({ companySlug }).lean();
    const toRestore = candidates.filter((row) => String(row._id).startsWith(prefix));
    const wrongActive = candidates.filter(
      (row) => row.status === 'active' && !String(row._id).startsWith(prefix),
    );

    const report: ApprovedPilotRestoreCompanyReport = {
      companySlug,
      prefix,
      expected,
      restoreCount: toRestore.length,
      priorStatuses: [...new Set(toRestore.map((row) => String(row.status)))],
      wrongActiveArchivedCount: wrongActive.length,
    };

    if (apply) {
      if (toRestore.length) {
        await QuestionConcept.updateMany(
          { _id: { $in: toRestore.map((row) => row._id) } },
          { $set: { status: 'active' } },
        );
      }
      if (wrongActive.length) {
        await QuestionConcept.updateMany(
          { _id: { $in: wrongActive.map((row) => row._id) } },
          { $set: { status: 'archived' } },
        );
      }
      report.activeAfter = await QuestionConcept.countDocuments({ companySlug, status: 'active' });
    }

    companies.push(report);
  }

  const pilotSlugs = Object.keys(APPROVED_PILOT_KEEP_PREFIX);
  const totalActive = apply
    ? await QuestionConcept.countDocuments({ companySlug: { $in: pilotSlugs }, status: 'active' })
    : companies.reduce((sum, row) => {
        const alreadyActive = row.priorStatuses.includes('active') ? row.restoreCount : 0;
        return sum + alreadyActive;
      }, 0);

  return { dryRun: !apply, companies, totalActive };
};
