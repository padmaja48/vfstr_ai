import React, { createContext, useState, useCallback, useEffect, useRef } from 'react';
import { authAPI, setCsrfToken } from '../services/api';

export const AuthContext = createContext();

/** Prefer server message; explain network/API-down clearly instead of a bare "failed". */
const authErrorMessage = (err, fallback) => {
  const data = err?.response?.data;
  if (data?.message || data?.error) {
    const base = data.message || data.error;
    if (data.code === 'USER_EXISTS') {
      return 'An account with this email already exists. Sign in instead.';
    }
    if (data.code === 'INVALID_CREDENTIALS') {
      return 'Invalid email or password. Check your details, or create an account if you are new.';
    }
    if (base === 'Validation failed' && data.details?.fieldErrors) {
      const first = Object.values(data.details.fieldErrors).flat().find(Boolean);
      if (first) return first;
    }
    return base;
  }
  if (!err?.response) {
    return 'Cannot reach the server. Make sure the API is running on http://localhost:4000, then try again.';
  }
  return fallback;
};

const SESSION_EXPIRED_MSG =
  'Your session expired. Please sign in again — in-progress answers were saved when submitted.';

/** Legacy keys — cleared on boot so tokens are never kept client-side. */
const LEGACY_TOKEN_KEYS = ['accessToken', 'token', 'refreshToken'];

const clearLegacyTokens = () => {
  try {
    LEGACY_TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState(null);
  const userRef = useRef(user);
  const initializingRef = useRef(initializing);
  userRef.current = user;
  initializingRef.current = initializing;

  const applySession = useCallback((payload) => {
    if (payload?.csrfToken) setCsrfToken(payload.csrfToken);
    if (payload?.authenticated && payload?.user) {
      setUser(payload.user);
      setAuthenticated(true);
      return true;
    }
    setUser(null);
    setAuthenticated(false);
    return false;
  }, []);

  const bootstrapSession = useCallback(async () => {
    try {
      let response = await authAPI.getSession();
      if (!response.data?.authenticated) {
        try {
          await authAPI.refresh();
          response = await authAPI.getSession();
        } catch {
          // No restorable refresh session — remain logged out.
        }
      }
      applySession(response.data);
      setError(null);
    } catch {
      setUser(null);
      setAuthenticated(false);
    } finally {
      setInitializing(false);
    }
  }, [applySession]);

  useEffect(() => {
    clearLegacyTokens();
    bootstrapSession();
  }, [bootstrapSession]);

  /** Google OAuth redirect lands here — cookies are already set server-side. */
  useEffect(() => {
    if (window.location.pathname !== '/auth/callback') return;

    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    window.history.replaceState({}, document.title, '/');

    if (oauth === 'success') {
      setInitializing(true);
      bootstrapSession().finally(() => setInitializing(false));
      return;
    }

    if (params.has('accessToken')) {
      clearLegacyTokens();
      setError('Outdated OAuth callback detected. Please sign in again.');
      setInitializing(false);
      return;
    }

    bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    const onAuthExpired = (event) => {
      if (initializingRef.current) return;
      const silent = event?.detail?.silent === true || !userRef.current;
      setUser(null);
      setAuthenticated(false);
      clearLegacyTokens();
      if (!silent) {
        setError(SESSION_EXPIRED_MSG);
      }
    };
    window.addEventListener('fluentai:auth-expired', onAuthExpired);
    return () => window.removeEventListener('fluentai:auth-expired', onAuthExpired);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!authenticated) return null;
    const response = await authAPI.getProfile();
    setUser(response.data);
    return response.data;
  }, [authenticated]);

  const register = useCallback(async (name, email, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authAPI.register(name, email, password);
      applySession({ authenticated: true, user: response.data.user, csrfToken: response.data.csrfToken });
      return response.data;
    } catch (err) {
      setError(authErrorMessage(err, 'Registration failed'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  const login = useCallback(async (identifier, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authAPI.login(identifier, password);
      applySession({ authenticated: true, user: response.data.user, csrfToken: response.data.csrfToken });
      return response.data;
    } catch (err) {
      setError(authErrorMessage(err, 'Login failed'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  const loginWithGoogle = useCallback(async (credential) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authAPI.googleLogin(credential);
      applySession({ authenticated: true, user: response.data.user, csrfToken: response.data.csrfToken });
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Google sign-in failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch {
      // Still clear local session even if the server call fails.
    }
    setUser(null);
    setAuthenticated(false);
    setError(null);
    setCsrfToken('');
    clearLegacyTokens();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      authenticated,
      /** @deprecated use `authenticated` — kept so older components don't break */
      token: authenticated ? 'cookie-session' : null,
      loading,
      initializing,
      error,
      register,
      login,
      loginWithGoogle,
      logout,
      refreshProfile,
      setUser,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
