import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/apiClient';
import NotificationBell from '../notifications/NotificationBell';

/**
 * Compact top bar displayed above the main content area.
 *
 * The actual page navigation lives in the left-hand {@link Sidebar}; this
 * bar only hosts the hamburger (mobile), notifications bell, and logout.
 */
export default function TopBar({ user, currentPageName, onOpenSidebar }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.auth.logout();
      navigate('/login');
      window.location.reload();
    } catch (e) {
      console.error('Logout error:', e);
      window.location.hash = '#/login';
      window.location.reload();
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="md:hidden p-2 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          {currentPageName && (
            <div className="text-sm font-medium text-slate-600 hidden sm:block">
              {formatPageName(currentPageName)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <NotificationBell user={user} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-slate-600 hover:text-slate-900"
            aria-label="Log out"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline ml-2">Log out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function formatPageName(name) {
  // Convert a PascalCase page key into a human-readable label.
  if (!name) return '';
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}
