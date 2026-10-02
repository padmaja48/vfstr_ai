import React from 'react';
import { Download } from 'lucide-react';
import { downloadCredentialsCsv } from '../../lib/parseImportFile';

export const ImportResultsPanel = ({ result, filename = 'VFSTR_AI_credentials.csv' }) => {
  if (!result) return null;

  const created = Array.isArray(result.created) ? result.created : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const failed = Array.isArray(result.failed) ? result.failed : [];
  const emailFailures = Array.isArray(result.emailFailures) ? result.emailFailures : [];

  return (
    <section className="admin-import-results" aria-live="polite">
      <div className="admin-import-results-head">
        <div>
          <h4>Import results</h4>
          <p className="admin-muted">Keep the credentials until every account has completed setup.</p>
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={!created.length}
          onClick={() => downloadCredentialsCsv(created, filename)}
        >
          <Download size={15} />
          Download credentials CSV
        </button>
      </div>

      <p className="admin-import-warning" role="alert">
        Store or share this file securely — it contains plaintext passwords and won&apos;t be shown again.
      </p>

      <div className="admin-import-counts">
        <span>Created: <strong>{result.createdCount ?? created.length}</strong></span>
        <span>Skipped: <strong>{result.skippedCount ?? skipped.length}</strong></span>
        <span>Failed: <strong>{result.failedCount ?? failed.length}</strong></span>
        {emailFailures.length ? (
          <span>Email not sent: <strong>{result.emailFailureCount ?? emailFailures.length}</strong></span>
        ) : null}
      </div>

      {created.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Email</th><th>Username</th><th>Default password</th></tr>
            </thead>
            <tbody>
              {created.map((account) => (
                <tr key={`${account.email}-${account.username}`}>
                  <td>{account.email}</td>
                  <td>{account.username}</td>
                  <td><code>{account.password}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="admin-muted">No accounts were created.</p>}

      {skipped.length ? (
        <details className="admin-import-details">
          <summary>Skipped rows ({skipped.length})</summary>
          <ul>{skipped.map((item, index) => <li key={`${item.email}-${index}`}>{item.email}: {item.reason}</li>)}</ul>
        </details>
      ) : null}

      {emailFailures.length ? (
        <details className="admin-import-details" open>
          <summary>Welcome email failures ({emailFailures.length})</summary>
          <p className="admin-muted">These accounts were created but the welcome email could not be delivered. Share credentials manually.</p>
          <ul>
            {emailFailures.map((item, index) => (
              <li key={`${item.studentId || item.email}-${index}`}>
                {item.email}: {item.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {failed.length ? (
        <details className="admin-import-details">
          <summary>Failed rows ({failed.length})</summary>
          <ul>{failed.map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.reason}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
};

export default ImportResultsPanel;
