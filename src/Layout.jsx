import React, { useEffect, useState } from 'react';
import { api } from '@/api/apiClient';
import Navbar from './components/layout/Navbar';

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const isAuth = await api.auth.isAuthenticated();
        if (isAuth) {
          const currentUser = await api.auth.me();
          setUser(currentUser);
        } else {
          // Redirect to login page
          window.location.hash = '#/login';
        }
      } catch (error) {
        console.error('Auth error:', error);
        window.location.hash = '#/login';
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading TransTrack...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-cyan-600 focus:text-white focus:rounded-md">
        Skip to main content
      </a>
      <Navbar user={user} />
      <main id="main-content">{children}</main>
    </div>
  );
}
