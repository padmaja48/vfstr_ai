import { env } from '../config/env';
import { bulkImportWelcomeEmail, deliverEmail } from './email.service';

export type BulkWelcomeRecipient = {
  studentId: string;
  email: string;
  username: string;
  password: string;
  name?: string;
  institutionName: string;
};

export type BulkWelcomeEmailFailure = {
  studentId: string;
  email: string;
  error: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loginPageUrl = () => `${env.CLIENT_URL.replace(/\/$/, '')}/`;

/**
 * Sends welcome emails in parallel chunks (rate-limit friendly).
 * Account creation is never rolled back — failures are returned for admin follow-up.
 */
export const sendBulkWelcomeEmails = async (
  recipients: BulkWelcomeRecipient[],
): Promise<BulkWelcomeEmailFailure[]> => {
  if (!recipients.length) return [];

  const chunkSize = Math.max(
    1,
    Number.parseInt(process.env.BULK_WELCOME_EMAIL_CHUNK_SIZE || '15', 10) || 15,
  );
  const chunkDelayMs = Math.max(
    0,
    Number.parseInt(process.env.BULK_WELCOME_EMAIL_CHUNK_DELAY_MS || '150', 10) || 150,
  );
  const loginUrl = loginPageUrl();
  const failures: BulkWelcomeEmailFailure[] = [];

  for (let offset = 0; offset < recipients.length; offset += chunkSize) {
    const chunk = recipients.slice(offset, offset + chunkSize);
    const results = await Promise.allSettled(
      chunk.map(async (recipient) => {
        const content = bulkImportWelcomeEmail({
          name: recipient.name || recipient.username,
          email: recipient.email,
          username: recipient.username,
          password: recipient.password,
          loginUrl,
          institutionName: recipient.institutionName,
        });
        await deliverEmail({ to: recipient.email, ...content });
      }),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const recipient = chunk[index];
        failures.push({
          studentId: recipient.studentId,
          email: recipient.email,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    if (offset + chunkSize < recipients.length && chunkDelayMs > 0) {
      await sleep(chunkDelayMs);
    }
  }

  return failures;
};
