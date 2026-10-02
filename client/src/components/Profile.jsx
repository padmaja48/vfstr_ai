import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { interviewAPI, userAPI } from '../services/api';
import '../styles/Profile.css';

const LANGUAGES = ['English', 'Telugu', 'Hindi'];

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

const initialsFor = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

const formatDisplayName = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Candidate';

export default function Profile() {
  const { user, refreshProfile, setUser } = useContext(AuthContext);
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    institution: '',
    preferredLanguage: 'English',
    profileImageUrl: '',
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPasswords, setShowPasswords] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmHint, setConfirmHint] = useState('');
  const [interviewCount, setInterviewCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      institution: user.institution || '',
      preferredLanguage: user.preferredLanguage || 'English',
      profileImageUrl: user.profileImageUrl || '',
    });
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    interviewAPI
      .getUserInterviews()
      .then((res) => {
        if (!cancelled) setInterviewCount(Array.isArray(res.data) ? res.data.length : 0);
      })
      .catch(() => {
        if (!cancelled) setInterviewCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOAuth = user?.authProvider && user.authProvider !== 'email';
  const initials = useMemo(() => initialsFor(form.name), [form.name]);

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setNotice('');
    setError('');
  };

  const updatePasswordField = (field, value) => {
    setPasswordForm((current) => {
      const next = { ...current, [field]: value };
      if (next.confirmPassword) {
        setConfirmHint(
          next.newPassword && next.newPassword !== next.confirmPassword
            ? 'Passwords do not match.'
            : '',
        );
      } else {
        setConfirmHint('');
      }
      return next;
    });
    setPasswordError('');
    setPasswordNotice('');
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError('');
      setNotice('');
      const payload = {
        name: form.name,
        phone: form.phone,
        institution: form.institution,
        preferredLanguage: form.preferredLanguage,
        profileImageUrl: form.profileImageUrl,
      };
      const response = await userAPI.updateProfile(payload);
      setUser(response.data);
      await refreshProfile?.();
      setNotice('Profile updated successfully.');
      toast.success('Profile updated successfully.');
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not save profile changes.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (passwordForm.newPassword.length < 8) {
      const msg = 'New password must be at least 8 characters.';
      setPasswordError(msg);
      toast.error(msg);
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      const msg = 'New password and confirmation do not match.';
      setPasswordError(msg);
      toast.error(msg);
      return;
    }

    try {
      setChangingPassword(true);
      setPasswordError('');
      setPasswordNotice('');
      await userAPI.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setConfirmHint('');
      setPasswordNotice('Password updated successfully.');
      toast.success('Password updated successfully.');
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not update password.';
      setPasswordError(msg);
      toast.error(msg);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="profile-page profile-page--pro">
      {(notice || passwordNotice) && (
        <div className="profile-toast" role="status">
          {notice || passwordNotice}
        </div>
      )}

      <header className="profile-banner">
        <div className="profile-banner-identity">
          <div className="profile-avatar large">
            {form.profileImageUrl ? <img src={form.profileImageUrl} alt="" /> : <span>{initials}</span>}
          </div>
          <div className="profile-banner-copy">
            <p className="profile-kicker">Account settings</p>
            <h1 title={form.name || 'Candidate'}>{formatDisplayName(form.name)}</h1>
            <p title={form.email}>{form.email}</p>
          </div>
        </div>
        <div className="profile-banner-stat">
          <span>Interviews completed</span>
          <strong>{interviewCount}</strong>
        </div>
      </header>

      <div className="profile-pro-grid">
        <form className="profile-panel profile-panel--sheet" onSubmit={saveProfile}>
          <div className="profile-panel-header">
            <h3>Personal details</h3>
            <p>Update how VFSTR.AI addresses you in sessions and reports.</p>
          </div>

          <div className="profile-form-grid">
            <label>
              <span>Full name</span>
              <input value={form.name} onChange={(event) => setField('name', event.target.value)} required minLength={2} />
            </label>
            <label>
              <span>Email</span>
              <input value={form.email} readOnly />
            </label>
            <label>
              <span>Phone number</span>
              <input value={form.phone} onChange={(event) => setField('phone', event.target.value)} placeholder="+91..." />
            </label>
            <label>
              <span>Institution / College</span>
              <input value={form.institution} onChange={(event) => setField('institution', event.target.value)} placeholder="College name" />
            </label>
            <label className="profile-form-span-2">
              <span>Preferred UI language</span>
              <select value={form.preferredLanguage} onChange={(event) => setField('preferredLanguage', event.target.value)}>
                {LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
              </select>
            </label>
          </div>

          {isOAuth && <p className="profile-note">Email is managed by your OAuth provider.</p>}
          {error && <p className="error">{error}</p>}

          <div className="profile-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>

        <form className="profile-panel profile-panel--security" onSubmit={changePassword}>
          <div className="profile-panel-header">
            <h3>Security</h3>
            <p>Change your password for email sign-in accounts.</p>
          </div>

          {isOAuth ? (
            <p className="profile-note">Password changes are not available for OAuth accounts.</p>
          ) : (
            <>
              <div className="profile-form-grid single">
                <label>
                  <span>Current password</span>
                  <div className="profile-password-field">
                    <input
                      type={showPasswords.currentPassword ? 'text' : 'password'}
                      value={passwordForm.currentPassword}
                      onChange={(event) => updatePasswordField('currentPassword', event.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="profile-password-toggle"
                      onClick={() => setShowPasswords((s) => ({ ...s, currentPassword: !s.currentPassword }))}
                      aria-label={showPasswords.currentPassword ? 'Hide current password' : 'Show current password'}
                    >
                      <EyeIcon open={showPasswords.currentPassword} />
                    </button>
                  </div>
                </label>
                <label>
                  <span>New password</span>
                  <div className="profile-password-field">
                    <input
                      type={showPasswords.newPassword ? 'text' : 'password'}
                      value={passwordForm.newPassword}
                      onChange={(event) => updatePasswordField('newPassword', event.target.value)}
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      className="profile-password-toggle"
                      onClick={() => setShowPasswords((s) => ({ ...s, newPassword: !s.newPassword }))}
                      aria-label={showPasswords.newPassword ? 'Hide new password' : 'Show new password'}
                    >
                      <EyeIcon open={showPasswords.newPassword} />
                    </button>
                  </div>
                </label>
                <label>
                  <span>Confirm new password</span>
                  <div className="profile-password-field">
                    <input
                      type={showPasswords.confirmPassword ? 'text' : 'password'}
                      value={passwordForm.confirmPassword}
                      onChange={(event) => updatePasswordField('confirmPassword', event.target.value)}
                      required
                      minLength={8}
                      aria-invalid={Boolean(confirmHint)}
                    />
                    <button
                      type="button"
                      className="profile-password-toggle"
                      onClick={() => setShowPasswords((s) => ({ ...s, confirmPassword: !s.confirmPassword }))}
                      aria-label={showPasswords.confirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      <EyeIcon open={showPasswords.confirmPassword} />
                    </button>
                  </div>
                  {confirmHint ? <em className="profile-field-hint">{confirmHint}</em> : null}
                </label>
              </div>
              {passwordError && <p className="error">{passwordError}</p>}
              <div className="profile-actions">
                <button type="submit" className="btn-primary" disabled={changingPassword || Boolean(confirmHint)}>
                  {changingPassword ? 'Updating...' : 'Update password'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

