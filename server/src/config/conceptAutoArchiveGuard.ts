import { logger } from '../utils/logger';

const AUTO_ARCHIVE_FLAG = 'CONCEPT_AUTO_ARCHIVE_PRIOR';
const AUTO_ARCHIVE_CONFIRM = 'CONCEPT_AUTO_ARCHIVE_PRIOR_CONFIRM';

/** Must match exactly — secondary confirmation for generation-time auto-archive. */
export const CONCEPT_AUTO_ARCHIVE_CONFIRM_PHRASE = 'I_UNDERSTAND_ARCHIVE_RISK';

export type ConceptAutoArchiveStartupReport = {
  requested: boolean;
  enabled: boolean;
  blockedReason?: string;
};

export const getConceptAutoArchiveStartupReport = (): ConceptAutoArchiveStartupReport => {
  const requested = process.env[AUTO_ARCHIVE_FLAG] === '1';
  if (!requested) {
    return { requested: false, enabled: false };
  }

  const confirm = process.env[AUTO_ARCHIVE_CONFIRM]?.trim();
  if (confirm !== CONCEPT_AUTO_ARCHIVE_CONFIRM_PHRASE) {
    return {
      requested: true,
      enabled: false,
      blockedReason:
        `${AUTO_ARCHIVE_FLAG}=1 is set but ${AUTO_ARCHIVE_CONFIRM} must equal `
        + `"${CONCEPT_AUTO_ARCHIVE_CONFIRM_PHRASE}" — auto-archive remains disabled.`,
    };
  }

  return { requested: true, enabled: true };
};

/** Generation-time archive of prior pending_review rows (never active). Disabled in test env. */
export const isConceptAutoArchiveAtGenerationEnabled = (): boolean => {
  if (process.env.NODE_ENV === 'test') return false;
  return getConceptAutoArchiveStartupReport().enabled;
};

export const assertConceptAutoArchiveConfigAtStartup = (): void => {
  const report = getConceptAutoArchiveStartupReport();
  if (report.requested && !report.enabled) {
    logger.error(
      {
        flag: AUTO_ARCHIVE_FLAG,
        confirmVar: AUTO_ARCHIVE_CONFIRM,
        requiredPhrase: CONCEPT_AUTO_ARCHIVE_CONFIRM_PHRASE,
      },
      report.blockedReason ?? 'Concept auto-archive config blocked at startup',
    );
    return;
  }

  if (report.enabled) {
    logger.warn(
      {
        flag: AUTO_ARCHIVE_FLAG,
        confirmVar: AUTO_ARCHIVE_CONFIRM,
      },
      'CONCEPT_AUTO_ARCHIVE_PRIOR is ENABLED — prior pending_review batches archive at generation; '
      + 'approved active pools supersede only on approve',
    );
  }
};
