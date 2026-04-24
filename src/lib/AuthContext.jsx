import React, { createContext, useState, useContext, useEffect } from 'react';
import { api } from '@/api/apiClient';

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

  const login = async (email, password) => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);

      const result = await api.auth.login({ email, password });

      if (result?.mfa_required) {
        setMfaChallenge({ challenge_token: result.challenge_token, email });
        setIsLoadingAuth(false);
        return { mfa_required: true };
      }

      setUser(result.user);
      setIsAuthenticated(true);
      setMfaChallenge(null);
      setIsLoadingAuth(false);
      return result;
    } catch (error) {
      setAuthError({
        type: 'login_failed',
        message: error.message || 'Login failed'
      });
      setIsLoadingAuth(false);
      throw error;
    }
  };

  const submitMfa = async (code) => {
    if (!mfaChallenge) throw new Error('No MFA challenge in progress');
    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      const result = await api.auth.loginMfa({
        challenge_token: mfaChallenge.challenge_token,
        code,
      });
      setUser(result.user);
      setIsAuthenticated(true);
      setMfaChallenge(null);
      setIsLoadingAuth(false);
      return result;
    } catch (error) {
      setIsLoadingAuth(false);
      throw error;
    }
  };

  const cancelMfa = () => setMfaChallenge(null);

  const logout = async (shouldRedirect = true) => {
    try {
      await api.auth.logout();
    } catch (e) {
      // Ignore logout errors
    }
    
    setUser(null);
    setIsAuthenticated(false);
    
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
      login,
      submitMfa,
      cancelMfa,
      logout,
      navigateToLogin,
      checkAppState
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
