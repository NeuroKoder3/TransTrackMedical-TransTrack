import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { HashRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Login from '@/pages/Login';
import LicenseActivation from '@/pages/LicenseActivation';
import { EvaluationWatermark } from '@/components/license';
import { useState, useEffect } from 'react';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();
  const [licenseValid, setLicenseValid] = useState(null);
  const [licenseInfo, setLicenseInfo] = useState(null);
  const [showLicenseScreen, setShowLicenseScreen] = useState(false);

  useEffect(() => {
    checkLicense();
  }, []);

  const checkLicense = async () => {
    if (window.electronAPI?.license) {
      try {
        const info = await window.electronAPI.license.getInfo();
        const isValid = await window.electronAPI.license.isValid();
        setLicenseInfo(info);
        setLicenseValid(isValid);
        
        // Show license screen if expired or not licensed
        if (!isValid || (info.evaluationExpired && !info.isLicensed)) {
          setShowLicenseScreen(true);
        }
      } catch (e) {
        console.error('License check failed:', e);
        setLicenseValid(true); // Allow in dev mode
      }
    } else {
      // Not in Electron, allow access (development mode)
      setLicenseValid(true);
    }
  };

  // Show loading spinner while checking license
  if (licenseValid === null) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Checking license...</p>
        </div>
      </div>
    );
  }

  // Show license activation if not valid
  if (showLicenseScreen && !licenseInfo?.isLicensed) {
    return (
      <LicenseActivation 
        onActivated={() => {
          setShowLicenseScreen(false);
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

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
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
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
