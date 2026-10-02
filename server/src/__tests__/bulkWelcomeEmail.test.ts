import { sendBulkWelcomeEmails } from '../services/bulkWelcomeEmail.service';
import * as emailService from '../services/email.service';

jest.mock('../services/email.service', () => ({
  ...jest.requireActual('../services/email.service'),
  deliverEmail: jest.fn(),
}));

const deliverEmailMock = emailService.deliverEmail as jest.MockedFunction<typeof emailService.deliverEmail>;

describe('sendBulkWelcomeEmails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BULK_WELCOME_EMAIL_CHUNK_SIZE;
    delete process.env.BULK_WELCOME_EMAIL_CHUNK_DELAY_MS;
  });

  it('sends welcome email for each created student', async () => {
    deliverEmailMock.mockResolvedValue(undefined);

    const failures = await sendBulkWelcomeEmails([
      {
        studentId: '1',
        email: 'alpha@test.local',
        username: 'alpha',
        password: 'alpha@PV2913',
        name: 'Alpha',
        institutionName: 'Scope Test College A',
      },
      {
        studentId: '2',
        email: 'beta@test.local',
        username: 'beta',
        password: 'beta@PV2913',
        institutionName: 'Scope Test College A',
      },
    ]);

    expect(failures).toEqual([]);
    expect(deliverEmailMock).toHaveBeenCalledTimes(2);
    expect(deliverEmailMock.mock.calls[0][0].to).toBe('alpha@test.local');
    expect(deliverEmailMock.mock.calls[0][0].subject).toMatch(/ProGrow MockAI account is ready/i);
    expect(deliverEmailMock.mock.calls[0][0].html).toContain('alpha@PV2913');
    expect(deliverEmailMock.mock.calls[0][0].html).toContain('Scope Test College A');
    expect(deliverEmailMock.mock.calls[0][0].html).toContain('complete account setup');
  });

  it('returns per-student failures without throwing', async () => {
    deliverEmailMock.mockImplementation(async ({ to }) => {
      if (to === 'bad@test.local') {
        throw new Error('Mailbox unavailable');
      }
    });

    const failures = await sendBulkWelcomeEmails([
      {
        studentId: 'ok',
        email: 'good@test.local',
        username: 'good',
        password: 'good@PV2913',
        institutionName: 'Demo College',
      },
      {
        studentId: 'bad',
        email: 'bad@test.local',
        username: 'bad',
        password: 'bad@PV2913',
        institutionName: 'Demo College',
      },
    ]);

    expect(failures).toEqual([
      { studentId: 'bad', email: 'bad@test.local', error: 'Mailbox unavailable' },
    ]);
  });

  it('processes recipients in chunks with delay', async () => {
    process.env.BULK_WELCOME_EMAIL_CHUNK_SIZE = '2';
    process.env.BULK_WELCOME_EMAIL_CHUNK_DELAY_MS = '0';
    deliverEmailMock.mockResolvedValue(undefined);

    const recipients = Array.from({ length: 5 }, (_, index) => ({
      studentId: String(index),
      email: `student${index}@test.local`,
      username: `student${index}`,
      password: `student${index}@PV2913`,
      institutionName: 'Demo College',
    }));

    await sendBulkWelcomeEmails(recipients);
    expect(deliverEmailMock).toHaveBeenCalledTimes(5);
  });
});
