import { JobsOptions, Queue, Worker } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../config/env';
import { getQueueRedis, isMemoryRedis } from '../config/redis';
import { logger } from '../utils/logger';

type EmailJob = {
  to: string;
  subject: string;
  html: string;
};

let emailQueue: Queue<EmailJob, void, string> | null = null;

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const smtpTransport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

export const getEmailQueue = () => {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJob, void, string>('email', {
      connection: getQueueRedis() as never,
      prefix: env.BULLMQ_PREFIX,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }

  return emailQueue;
};

export const queueEmail = async (payload: EmailJob, options?: JobsOptions) => {
  if (isMemoryRedis()) {
    await sendEmailNow(payload);
    return;
  }

  const queue = getEmailQueue();
  await queue.add('send-email', payload, options);
};

/** Sends immediately and throws on provider/transport errors (for delivery tracking). */
export const deliverEmail = async ({ to, subject, html }: EmailJob) => {
  if (resend) {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    if (error) {
      throw new Error(error.message || 'Resend rejected the email');
    }
    return;
  }

  if (smtpTransport) {
    await smtpTransport.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    return;
  }

  throw new Error('Email provider not configured (set RESEND_API_KEY or SMTP_URL)');
};

export const sendEmailNow = async (payload: EmailJob) => {
  try {
    await deliverEmail(payload);
  } catch (error) {
    logger.warn(
      { to: payload.to, subject: payload.subject, error: error instanceof Error ? error.message : error },
      'Email delivery failed',
    );
  }
};

export const startEmailWorker = () => {
  if (isMemoryRedis()) {
    return { close: async () => undefined };
  }

  return new Worker<EmailJob>(
    'email',
    async (job) => {
      await sendEmailNow(job.data);
    },
    { connection: getQueueRedis() as never, prefix: env.BULLMQ_PREFIX },
  );
};

export const verificationEmail = (name: string, otp: string) => ({
  subject: 'Verify your ProGrow MockAI account',
  html: `<p>Hi ${name},</p><p>Your verification code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
});

export const passwordResetEmail = (name: string, otp: string) => ({
  subject: 'Reset your ProGrow MockAI password',
  html: `<p>Hi ${name},</p><p>Your password reset code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export type BulkWelcomeEmailInput = {
  name: string;
  email: string;
  username: string;
  password: string;
  loginUrl: string;
  institutionName: string;
};

/** Welcome email for admin bulk-imported students (includes default password). */
export const bulkImportWelcomeEmail = ({
  name,
  email,
  username,
  password,
  loginUrl,
  institutionName,
}: BulkWelcomeEmailInput) => ({
  subject: `Your ProGrow MockAI account is ready — ${institutionName}`,
  html: `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 12px;">Welcome to ProGrow MockAI</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>
        Your interview practice account has been created for
        <strong>${escapeHtml(institutionName)}</strong>.
        Use the credentials below to sign in:
      </p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin:18px 0;">
        <p style="margin:0;"><strong>Login email:</strong> ${escapeHtml(email)}</p>
        <p style="margin:8px 0 0;"><strong>Username:</strong> ${escapeHtml(username)}</p>
        <p style="margin:8px 0 0;"><strong>Temporary password:</strong> <code>${escapeHtml(password)}</code></p>
      </div>
      <p>
        On your first login you will be asked to complete account setup — your full name, mobile number,
        college, personal email, and a new password — before you can use the platform.
      </p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">
          Sign in to ProGrow MockAI
        </a>
      </p>
      <p style="color:#64748b;font-size:14px;">If the button does not work, open this link: ${escapeHtml(loginUrl)}</p>
    </div>
  `,
});

type MixedTestReportInput = {
  name: string;
  level: string;
  testLabel: string;
  averageScore: number;
  answered: number;
  totalQuestions: number;
  breakdown: Array<{
    skill: string;
    total?: number;
    answered: number;
    correct: number;
    wrong?: number;
    skipped?: number;
    averageScore: number;
  }>;
};

const formatScore = (score: number) => Number(score || 0).toFixed(1);

export const mixedTestReportEmail = ({
  name,
  level,
  testLabel,
  averageScore,
  answered,
  totalQuestions,
  breakdown,
}: MixedTestReportInput) => {
  const strengths = breakdown
    .filter((item) => item.averageScore >= 75)
    .map((item) => `<li><strong>${item.skill}:</strong> ${formatScore(item.averageScore)} shows solid control at ${level}.</li>`)
    .join('');
  const focusAreas = breakdown
    .filter((item) => item.averageScore < 75)
    .map((item) => `<li><strong>${item.skill}:</strong> review missed items and complete one focused practice module before the next test.</li>`)
    .join('');
  const rows = breakdown
    .map(
      (item) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #dbeafe;">${item.skill}</td>
          <td style="padding:10px;border-bottom:1px solid #dbeafe;">${item.answered}/${item.total ?? item.answered}</td>
          <td style="padding:10px;border-bottom:1px solid #dbeafe;">${item.correct}</td>
          <td style="padding:10px;border-bottom:1px solid #dbeafe;">${item.wrong ?? Math.max(0, item.answered - item.correct)}</td>
          <td style="padding:10px;border-bottom:1px solid #dbeafe;">${item.skipped ?? 0}</td>
          <td style="padding:10px;border-bottom:1px solid #dbeafe;">${formatScore(item.averageScore)}</td>
        </tr>
      `,
    )
    .join('');

  return {
    subject: `Your ${testLabel} report is ready`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:680px;margin:0 auto;">
        <h2 style="margin:0 0 8px;">${testLabel} Report</h2>
        <p>Hi ${name},</p>
        <p>Your English readiness test report is ready, with grammar, vocabulary, and reading section analysis.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:16px;margin:18px 0;">
          <p style="margin:0;"><strong>Level:</strong> ${level}</p>
          <p style="margin:4px 0 0;"><strong>Overall score:</strong> ${formatScore(averageScore)}/100</p>
          <p style="margin:4px 0 0;"><strong>Completion:</strong> ${answered}/${totalQuestions} answered</p>
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #dbeafe;border-radius:12px;overflow:hidden;">
          <thead>
            <tr style="background:#dbeafe;text-align:left;">
              <th style="padding:10px;">Skill</th>
              <th style="padding:10px;">Answered</th>
              <th style="padding:10px;">Correct</th>
              <th style="padding:10px;">Wrong</th>
              <th style="padding:10px;">Skipped</th>
              <th style="padding:10px;">Score</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <h3>Strengths</h3>
        <ul>${strengths || '<li>You completed the test and now have a clear baseline.</li>'}</ul>
        <h3>Recommended focus</h3>
        <ul>${focusAreas || '<li>Move to the next level test or keep building speed with mixed review.</li>'}</ul>
        <p style="margin-top:22px;">Keep practicing in the FluentAI journey map; the next test will use fresh questions.</p>
      </div>
    `,
  };
};

/** Admin-composed platform notification email. */
export const adminNotificationEmail = ({
  name,
  title,
  body,
  loginUrl,
}: {
  name: string;
  title: string;
  body: string;
  loginUrl: string;
}) => ({
  subject: title,
  html: `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 12px;">${escapeHtml(title)}</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:18px 0;white-space:pre-wrap;">
        ${escapeHtml(body).replace(/\n/g, '<br />')}
      </div>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">
          Open FluentAI
        </a>
      </p>
    </div>
  `,
});
