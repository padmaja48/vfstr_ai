import {
  CONCEPT_AUTO_ARCHIVE_CONFIRM_PHRASE,
  getConceptAutoArchiveStartupReport,
  isConceptAutoArchiveAtGenerationEnabled,
} from '../config/conceptAutoArchiveGuard';

describe('conceptAutoArchiveGuard', () => {
  const priorEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...priorEnv };
  });

  it('blocks auto-archive when only CONCEPT_AUTO_ARCHIVE_PRIOR=1 is set', () => {
    process.env.CONCEPT_AUTO_ARCHIVE_PRIOR = '1';
    delete process.env.CONCEPT_AUTO_ARCHIVE_PRIOR_CONFIRM;

    const report = getConceptAutoArchiveStartupReport();
    expect(report.requested).toBe(true);
    expect(report.enabled).toBe(false);
    expect(isConceptAutoArchiveAtGenerationEnabled()).toBe(false);
  });

  it('enables auto-archive only when confirm phrase matches exactly', () => {
    process.env.NODE_ENV = 'development';
    process.env.CONCEPT_AUTO_ARCHIVE_PRIOR = '1';
    process.env.CONCEPT_AUTO_ARCHIVE_PRIOR_CONFIRM = CONCEPT_AUTO_ARCHIVE_CONFIRM_PHRASE;

    const report = getConceptAutoArchiveStartupReport();
    expect(report.enabled).toBe(true);
    expect(isConceptAutoArchiveAtGenerationEnabled()).toBe(true);
  });

  it('never enables auto-archive in test environment even with confirm', () => {
    process.env.NODE_ENV = 'test';
    process.env.CONCEPT_AUTO_ARCHIVE_PRIOR = '1';
    process.env.CONCEPT_AUTO_ARCHIVE_PRIOR_CONFIRM = CONCEPT_AUTO_ARCHIVE_CONFIRM_PHRASE;

    expect(getConceptAutoArchiveStartupReport().enabled).toBe(true);
    expect(isConceptAutoArchiveAtGenerationEnabled()).toBe(false);
  });
});
