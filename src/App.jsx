import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { HashRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ErrorBoundary from '@/components/ErrorBoundary';
import Login from '@/pages/Login';
import LicenseActivation from '@/pages/LicenseActivation';
import { EvaluationWatermark } from '@/components/license';
import { useReducer, useEffect, useCallback } from 'react';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

// License state management via useReducer
const LICENSE_INITIAL_STATE = {
  status: 'checking', // 'checking' | 'valid' | 'invalid' | 'expired' | 'error'
  info: null,
  showLicenseScreen: false,
  error: null,
};

function licenseReducer(state, action) {
  switch (action.type) {
    case 'LICENSE_CHECK_START':
      return { ...state, status: 'checking', error: null };
    case 'LICENSE_VALID':
      return { ...state, status: 'valid', info: action.payload, showLicenseScreen: false };
    case 'LICENSE_INVALID':
      return { ...state, status: 'invalid', info: action.payload, showLicenseScreen: true };
    case 'LICENSE_ERROR':
      return {
        ...state,
        status: window.electronAPI ? 'error' : 'valid',
        error: action.payload,
        showLicenseScreen: false,
      };
    case 'LICENSE_DEV_MODE':
      return { ...state, status: 'valid', info: null, showLicenseScreen: false };
    case 'LICENSE_ACTIVATED':
      return { ...state, status: 'checking', showLicenseScreen: false };
    default:
      return state;
  }
}

function isAuthError(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    typeof error.type === 'string' &&
    typeof error.message === 'string'
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();
  const [licenseState, dispatch] = useReducer(licenseReducer, LICENSE_INITIAL_STATE);

  const checkLicense = useCallback(async () => {
    dispatch({ type: 'LICENSE_CHECK_START' });

    if (window.electronAPI?.license) {
      try {
        const info = await window.electronAPI.license.getInfo();
        const isValid = await window.electronAPI.license.isValid();

        if (!isValid || (info.evaluationExpired && !info.isLicensed)) {
          dispatch({ type: 'LICENSE_INVALID', payload: info });
        } else {
          dispatch({ type: 'LICENSE_VALID', payload: info });
        }
      } catch (e) {
        console.error('License check failed:', e);
        // Fail closed: do NOT grant access on error in production
        dispatch({ type: 'LICENSE_ERROR', payload: e.message || 'License verification failed' });
      }
    } else {
      // Not in Electron (development mode via browser)
      dispatch({ type: 'LICENSE_DEV_MODE' });
    }
  }, []);

  useEffect(() => {
    checkLicense();
  }, [checkLicense]);

  // Show loading spinner while checking license
  if (licenseState.status === 'checking') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Checking license...</p>
        </div>
      </div>
    );
  }

  // Show error state for license failures in Electron
  if (licenseState.status === 'error') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center max-w-md p-8">
          <div className="text-red-500 text-5xl mb-4">&#9888;</div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">License Verification Failed</h2>
          <p className="text-slate-600 mb-4">Unable to verify your license. Please contact support.</p>
          <button
            onClick={checkLicense}
            className="px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show license activation if not valid
  if (licenseState.showLicenseScreen && !licenseState.info?.isLicensed) {
    return (
      <LicenseActivation 
        onActivated={() => {
          dispatch({ type: 'LICENSE_ACTIVATED' });
          checkLicense();
        }} 
      />
    );
  }

  // Show loading spinner while checking auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading TransTrack...</p>
        </div>
      </div>
    );
  }

  // Handle authentication errors with type validation
  if (authError && isAuthError(authError)) {
    switch (authError.type) {
      case 'user_not_registered':
        return <UserNotRegisteredError />;
      case 'auth_failed':
        return <Login />;
      default:
        return <Login />;
    }
  } else if (authError) {
    return <Login />;
  }

  // If not authenticated, show login page
  if (!isAuthenticated) {
    return <Login />;
  }

  // Render the main app
  return (
    <>
      {/* Evaluation watermark for evaluation builds */}
      <EvaluationWatermark />
      
      <Routes>
        <Route path="/" element={
          <LayoutWrapper currentPageName={mainPageKey}>
            <MainPage />
          </LayoutWrapper>
        } />
        <Route path="/login" element={<Login />} />
        <Route path="/license" element={<LicenseActivation onActivated={() => window.location.reload()} />} />
        {Object.entries(Pages).map(([path, Page]) => (
          <Route
            key={path}
            path={`/${path}`}
            element={
              <LayoutWrapper currentPageName={path}>
                <Page />
              </LayoutWrapper>
            }
          />
        ))}
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </>
  );
};


function App() {

  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <NavigationTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
