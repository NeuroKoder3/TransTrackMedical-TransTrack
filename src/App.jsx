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
import IdleTimeoutManager from '@/components/session/IdleTimeoutManager';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>
    <RouteErrorBoundary pageName={currentPageName}>{children}</RouteErrorBoundary>
  </Layout>
  : <RouteErrorBoundary pageName={currentPageName}>{children}</RouteErrorBoundary>;

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

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <>
      <IdleTimeoutManager />

      <Routes>
        <Route path="/" element={
          <LayoutWrapper currentPageName={mainPageKey}>
            <MainPage />
          </LayoutWrapper>
        } />
        <Route path="/login" element={<Login />} />
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
