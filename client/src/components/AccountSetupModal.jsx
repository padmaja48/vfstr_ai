import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authAPI } from '../services/api';
import '../styles/AccountSetup.css';

const EyeIcon = ({ open }) =>
  open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

/**
 * Blocking first-login account setup for bulk-imported students
 * who signed in with the institution default password.
 */
export const AccountSetupModal = ({ open }) => {
  const { user, setUser, logout } = useContext(AuthContext);
  const toast = useToast();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    institution: '',
    email: '',
    currentPassword: '',
    newPassword: '',
  });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const titleId = useMemo(() => 'account-setup-title', []);

  useEffect(() => {
    if (!open || !user) return;
    setForm((prev) => ({
      ...prev,
      name: user.name || '',
      phone: user.phone || '',
      institution: user.institution || '',
      email: user.email || '',
    }));
  }, [open, user]);

  if (!open) return null;

  const update = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim() || form.name.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }
    if (!form.phone.trim() || form.phone.trim().length < 8) {
      setError('Enter a valid mobile number.');
      return;
    }
    if (!form.institution.trim() || form.institution.trim().length < 2) {
      setError('Enter your college name.');
      return;
    }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Enter a valid personal email.');
      return;
    }
    if (!form.currentPassword) {
      setError('Enter the default password you used to sign in.');
      return;
    }
    if (!form.newPassword || form.newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (form.currentPassword === form.newPassword) {
      setError('Choose a new password different from the default.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await authAPI.completeAccountSetup({
        name: form.name.trim(),
        phone: form.phone.trim(),
        institution: form.institution.trim(),
        email: form.email.trim().toLowerCase(),
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      if (data?.user) {
        setUser(data.user);
      }
      toast.success(data?.message || 'Account setup complete. Welcome to VFSTR.AI!');
    } catch (err) {
      const msg =
        err?.response?.data?.message
        || err?.response?.data?.error
        || 'Could not complete account setup. Please try again.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="account-setup-overlay" role="presentation">
      <div
        className="account-setup-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="account-setup-head">
          <div className="account-setup-badge">First login</div>
          <h2 id={titleId}>Complete your account setup</h2>
          <p>
            Your campus shared a default password. Confirm your details and set a personal password
            to continue.
          </p>
        </header>

        <form className="account-setup-form" onSubmit={handleSubmit} noValidate>
          <div className="account-setup-grid">
            <label className="account-setup-field">
              <span>Full Name</span>
              <input
                type="text"
                value={form.name}
                onChange={update('name')}
                autoComplete="name"
                required
                placeholder="Your full name"
              />
            </label>

            <label className="account-setup-field">
              <span>Mobile Number</span>
              <input
                type="tel"
                value={form.phone}
                onChange={update('phone')}
                autoComplete="tel"
                required
                placeholder="10-digit mobile number"
              />
            </label>

            <label className="account-setup-field">
              <span>College Name</span>
              <input
                type="text"
                value={form.institution}
                onChange={update('institution')}
                autoComplete="organization"
                required
                placeholder="College / institution"
              />
            </label>

            <label className="account-setup-field">
              <span>Personal Email</span>
              <input
                type="email"
                value={form.email}
                onChange={update('email')}
                autoComplete="email"
                required
                placeholder="you@gmail.com"
              />
            </label>

            <label className="account-setup-field">
              <span>Current Password</span>
              <div className="account-setup-password">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={form.currentPassword}
                  onChange={update('currentPassword')}
                  autoComplete="current-password"
                  required
                  placeholder="Default campus password"
                />
                <button
                  type="button"
                  className="account-setup-eye"
                  onClick={() => setShowCurrent((v) => !v)}
                  aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
                >
                  <EyeIcon open={showCurrent} />
                </button>
              </div>
            </label>

            <label className="account-setup-field">
              <span>New Password</span>
              <div className="account-setup-password">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={form.newPassword}
                  onChange={update('newPassword')}
                  autoComplete="new-password"
                  required
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  className="account-setup-eye"
                  onClick={() => setShowNew((v) => !v)}
                  aria-label={showNew ? 'Hide new password' : 'Show new password'}
                >
                  <EyeIcon open={showNew} />
                </button>
              </div>
            </label>
          </div>

          {error ? <p className="account-setup-error" role="alert">{error}</p> : null}

          <div className="account-setup-actions">
            <button
              type="button"
              className="account-setup-secondary"
              onClick={() => logout()}
              disabled={submitting}
            >
              Sign out
            </button>
            <button type="submit" className="account-setup-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save & continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccountSetupModal;
