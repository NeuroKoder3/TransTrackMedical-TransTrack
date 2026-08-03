import React, { createContext, useState, useContext, useEffect } from 'react';
import { api } from '@/api/apiClient';
import { purgeClientPhiCaches } from '@/lib/phiCache';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState({
    id: 'transtrack-local',
    public_settings: {
      name: 'TransTrack',
      requires_auth: true
    }
  });

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      
      // Check if user is already authenticated
      const authenticated = await api.auth.isAuthenticated();
      
      if (authenticated) {
        const currentUser = await api.auth.me();
        setUser(currentUser);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
      
      setIsLoadingAuth(false);
    } catch (error) {
      // Session may have expired or user not authenticated
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
    }
  };

  // mfaChallenge holds an in-flight TOTP challenge token issued by the backend
  // when the user is enrolled in MFA. While set, the Login page renders the
  // 6-digit verification step instead of email/password.
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);

  const login = async (email, password) => {
    try {
      // Do NOT set isLoadingAuth here — that unmounts <Login> in App.jsx
      // (full-screen spinner) and remounts a blank form on failure ("reset").
      setAuthError(null);

      const result = await api.auth.login({ email, password });

      // Local IPC shape: { mfa_required, challenge_token }
      // Remote API shape: { kind: 'mfa_required', challengeId } | { kind: 'session', user, access }
      if (result?.mfa_required || result?.kind === 'mfa_required') {
        setMfaChallenge({
          challenge_token: result.challenge_token || result.challengeId,
          email,
          mustEnroll: !!result.mustEnroll,
        });
        return { mfa_required: true };
      }

      const user = result.user || result;
      setUser(user);
      setIsAuthenticated(true);
      setMfaChallenge(null);
      setMustChangePassword(!!result.mustChangePassword || !!user.must_change_password);
      setMfaEnrollmentRequired(!!result.mfaEnrollmentRequired || !!user.mfa_required && !user.mfa_enrolled);
      return { user, ...result };
    } catch (error) {
      // Keep authError null for credential failures so App.jsx does not
      // remount Login and wipe the form. Login.jsx shows the message.
      throw error;
    }
  };

  const submitMfa = async (code) => {
    if (!mfaChallenge) throw new Error('No MFA challenge in progress');
    try {
      setAuthError(null);
      const result = await api.auth.loginMfa({
        challenge_token: mfaChallenge.challenge_token,
        challengeId: mfaChallenge.challenge_token,
        code,
      });
      setUser(result.user);
      setIsAuthenticated(true);
      setMfaChallenge(null);
      setMustChangePassword(!!result.mustChangePassword || !!result.user?.must_change_password);
      return result;
    } catch (error) {
      throw error;
    }
  };

  const cancelMfa = () => setMfaChallenge(null);

  const logout = async (shouldRedirect = true) => {
    // Purge the client-side PHI caches BEFORE anything can fail. On a shared
    // clinical workstation the next user's session would otherwise start with
    // the previous user's cached patient lists, laboratory results and detail
    // records still resident in renderer memory, which defeats the automatic
    // logoff control at HIPAA §164.312(a)(2)(iii).
    purgeClientPhiCaches();

    try {
      await api.auth.logout();
    } catch {
      // The session is being abandoned regardless of whether the main process
      // acknowledged it; the caches are already gone.
    }

    setUser(null);
    setIsAuthenticated(false);
    setMustChangePassword(false);
    setMfaEnrollmentRequired(false);

    if (shouldRedirect) {
      window.location.hash = '#/login';
    }
  };

  const navigateToLogin = () => {
    window.location.hash = '#/login';
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      mfaChallenge,
      mustChangePassword,
      mfaEnrollmentRequired,
      clearMustChangePassword: () => setMustChangePassword(false),
      clearMfaEnrollmentRequired: () => setMfaEnrollmentRequired(false),
      login,
      submitMfa,
      cancelMfa,
      logout,
      navigateToLogin,
      checkAppState,
      // Alias for callers (e.g. the SSO completion handler in Login)
      // that want to re-query the backend after a non-form-driven auth
      // event landed a fresh session.
      refreshAuth: checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
