/**
 * Regenerate templated-fragment padded role concept sections (no fallback padding).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/regenerateAffectedRoleConceptSections.ts --audit
 *   npx ts-node --transpile-only scripts/regenerateAffectedRoleConceptSections.ts --dry-run
 *   npx ts-node --transpile-only scripts/regenerateAffectedRoleConceptSections.ts --apply
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';
import { QuestionConcept } from '../src/models/QuestionConcept';
import {
  getRoleConceptEntry,
  isTemplatedRoleFallbackLabel,
  roleCategoryTargets,
  type RoleConceptKey,
} from '../src/data/roleConceptCatalog';
import type { ConceptCategory } from '../src/models/QuestionConcept';
import {
  regenerateRoleConceptSections,
  type RoleSectionRegenerationPlan,
} from '../src/services/questionConcept.service';

const REGENERATION_PLANS: RoleSectionRegenerationPlan[] = [
  { role: 'data_analyst', categories: ['Behavioral', 'Culture'] },
  { role: 'frontend', categories: ['Behavioral', 'Culture'] },
  { role: 'backend', categories: ['Behavioral', 'Coding', 'Culture'] },
  { role: 'qa', categories: ['Behavioral', 'Coding', 'Culture', 'Technical'] },
  { role: 'hr_behavioral', fullRegenerate: true },
];

const SKIP_ROLES: RoleConceptKey[] = ['sde', 'ai_ml'];
/** Original 7-role generation batch — all pending_review rows consolidate here. */
const CANONICAL_BATCH_SUFFIX = '1f59ff';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const INTER_ROLE_DELAY_MS = Number(process.env.CONCEPT_GEN_DELAY_MS || 15000);

const auditRole = async (role: RoleConceptKey) => {
  const entry = getRoleConceptEntry(role);
  if (!entry) return null;
  const targets = roleCategoryTargets(entry, 50);
  const rows = await QuestionConcept.find({ role, status: 'pending_review' }).lean();
  const byCategory = Object.fromEntries(
    (['Technical', 'Culture', 'Coding', 'Behavioral'] as ConceptCategory[]).map((category) => {
      const categoryRows = rows.filter((row) => row.category === category);
      const templated = categoryRows.filter((row) =>
        isTemplatedRoleFallbackLabel(String(row.conceptLabel)),
      ).length;
      return [category, { total: categoryRows.length, templated, target: targets[category] }];
    }),
  ) as Record<ConceptCategory, { total: number; templated: number; target: number }>;

  return { role, label: entry.label, total: rows.length, byCategory };
};

const main = async () => {
  const auditOnly = process.argv.includes('--audit');
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run') || (!apply && !auditOnly);
  const rolesArg = process.argv.find((arg) => arg.startsWith('--roles='));
  const selectedRoles = rolesArg
    ? rolesArg.slice('--roles='.length).split(',').map((role) => role.trim()).filter(Boolean)
    : null;
  const plans = selectedRoles
    ? REGENERATION_PLANS.filter((plan) => selectedRoles.includes(plan.role))
    : REGENERATION_PLANS;

  await connectDatabase();

  console.log('=== Role concept templated-fragment audit ===\n');
  for (const role of [...SKIP_ROLES, ...REGENERATION_PLANS.map((plan) => plan.role)]) {
    const report = await auditRole(role);
    if (!report) continue;
    const templatedTotal = Object.values(report.byCategory).reduce((sum, row) => sum + row.templated, 0);
    const status = SKIP_ROLES.includes(role) ? 'SKIP (approved clean)' : 'REGENERATE';
    console.log(`${report.label} (${report.role}) — ${status}`);
    console.log(`  pending_review: ${report.total}, templated rows: ${templatedTotal}`);
    for (const category of ['Technical', 'Culture', 'Coding', 'Behavioral'] as ConceptCategory[]) {
      const row = report.byCategory[category];
      if (!row.total && !row.target) continue;
      const flag = row.templated > 0 ? ` ⚠ ${row.templated} templated` : ' ✓ clean';
      console.log(`    ${category}: ${row.total}/${row.target}${flag}`);
    }
    console.log('');
  }

  if (auditOnly) {
    await disconnectDatabase();
    return;
  }

  console.log(`Mode: ${apply ? 'APPLY' : 'dry run'}\n`);
  if (dryRun && !apply) {
    console.log('Plans queued:');
    plans.forEach((plan) => {
      if (plan.fullRegenerate) {
        console.log(`  - ${plan.role}: full pool regenerate`);
      } else {
        console.log(`  - ${plan.role}: sections ${plan.categories?.join(', ')} (templated rows only)`);
      }
    });
    console.log('\nRe-run with --apply to execute (uses AI-only generation, no fallback padding).');
    await disconnectDatabase();
    return;
  }

  const batch = await ConceptGenerationBatch.create({
    scope: 'custom',
    targetType: 'role',
    status: 'running',
    totalCompanies: plans.length,
    completedCompanies: 0,
    failedCompanies: [],
    companySlugs: [],
    roleKeys: plans.map((plan) => plan.role),
  });
  let batchId = String(batch._id);

  const canonicalSample = await QuestionConcept.findOne({
    role: { $in: plans.map((plan) => plan.role) },
    status: 'pending_review',
    batchId: { $exists: true },
  }).lean();
  const canonicalCandidates = await QuestionConcept.distinct('batchId', {
    role: { $in: plans.map((plan) => plan.role) },
    status: 'pending_review',
  });
  const canonicalBatchId = canonicalCandidates.find((id) => String(id).endsWith(CANONICAL_BATCH_SUFFIX));
  if (canonicalBatchId) {
    batchId = String(canonicalBatchId);
    console.log(`Using canonical batch ${batchId} (${batchId.slice(-6)}) for consolidation\n`);
  } else {
    console.log(`Regeneration batch ${batchId}\n`);
  }

  let completed = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const entry = getRoleConceptEntry(plan.role);
    console.log(`[${index + 1}/${plans.length}] ${entry?.label ?? plan.role}`);
    try {
      const result = await regenerateRoleConceptSections({ plan, batchId });
      completed += 1;
      console.log(
        `  -> kept ${result.kept}, discarded ${result.discarded}, generated ${result.generated}, templated remaining ${result.templatedRemaining}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  -> FAILED: ${message}`);
      batch.failedCompanies.push({
        companySlug: plan.role,
        companyLabel: entry?.label ?? plan.role,
        error: message,
      });
      await batch.save();
    }

    if (index < plans.length - 1) {
      await sleep(INTER_ROLE_DELAY_MS);
    }
  }

  batch.completedCompanies = completed;
  batch.status = batch.failedCompanies.length
    ? (completed ? 'partial' : 'failed')
    : 'completed';
  batch.completedAt = new Date();
  await batch.save();

  console.log(`\nBatch finished: ${completed}/${plans.length} roles succeeded`);
  if (batch.failedCompanies.length) {
    batch.failedCompanies.forEach((failure) => {
      console.log(`  FAILED ${failure.companySlug}: ${failure.error}`);
    });
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
