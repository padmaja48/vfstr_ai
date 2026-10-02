/**
 * Sends one bulk-import welcome email using configured RESEND_API_KEY or SMTP_URL.
 *
 * Usage:
 *   TEST_WELCOME_EMAIL=you@example.com npm run test:welcome-email
 */
import dotenv from 'dotenv';
import { bulkImportWelcomeEmail, deliverEmail } from '../src/services/email.service';
import { env } from '../src/config/env';

dotenv.config();

const main = async () => {
  const to = process.env.TEST_WELCOME_EMAIL?.trim();
  if (!to) {
    console.error('Set TEST_WELCOME_EMAIL to the inbox that should receive the test message.');
    process.exit(1);
  }

  const loginUrl = `${env.CLIENT_URL.replace(/\/$/, '')}/`;
  const username = 'demo.student';
  const password = `${username}@PV2913`;
  const content = bulkImportWelcomeEmail({
    name: 'Demo Student',
    email: to,
    username,
    password,
    loginUrl,
    institutionName: 'Demo College',
  });

  console.log(`Sending welcome email to ${to} via ${env.RESEND_API_KEY ? 'Resend' : env.SMTP_URL ? 'SMTP' : 'no provider'}...`);
  await deliverEmail({ to, ...content });
  console.log('Welcome email sent successfully. Check the inbox (and spam folder).');
};

main().catch((error) => {
  console.error('Failed to send welcome email:', error instanceof Error ? error.message : error);
  process.exit(1);
});
