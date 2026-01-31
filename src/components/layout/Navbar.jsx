import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Activity, Users, FileText, Settings, LogOut, Shield, Heart, Database, AlertTriangle, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/apiClient';
import NotificationBell from '../notifications/NotificationBell';
import { LicenseStatusBadge } from '@/components/license';

export default function Navbar({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  const isActive = (pageName) => {
    const pageUrl = createPageUrl(pageName);
    if (pageName === 'Dashboard') {
      return currentPath === '/' || currentPath === '';
    }
    return currentPath === pageUrl || currentPath === `/${pageName}`;
  };

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

  const navItems = [
    { name: 'Dashboard', page: 'Dashboard', icon: Activity },
    { name: 'Patients', page: 'Patients', icon: Users },
    { name: 'Donor Matching', page: 'DonorMatching', icon: Heart },
    { name: 'Reports', page: 'Reports', icon: FileText },
  ];

  // Add Risk Dashboard for coordinators and above
  if (user?.role === 'admin' || user?.role === 'coordinator' || user?.role === 'physician') {
    navItems.push(
      { name: 'Risk Intel', page: 'RiskDashboard', icon: AlertTriangle }
    );
  }

  if (user?.role === 'admin') {
    navItems.push(
      { name: 'EHR Integration', page: 'EHRIntegration', icon: Database },
      { name: 'Priority Config', page: 'PrioritySettings', icon: Settings },
      { name: 'Compliance', page: 'ComplianceCenter', icon: Shield },
      { name: 'Recovery', page: 'DisasterRecovery', icon: HardDrive },
      { name: 'Settings', page: 'Settings', icon: Settings }
    );
  }
  
  // Regulators get compliance access
  if (user?.role === 'regulator') {
    navItems.push(
      { name: 'Compliance', page: 'ComplianceCenter', icon: Shield }
    );
  }

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <Link to={createPageUrl('Dashboard')} className="flex items-center space-x-2">
              <div className="bg-gradient-to-br from-cyan-500 to-teal-600 p-2 rounded-lg">
                <Activity className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-900">TransTrack</span>
            </Link>

            <div className="hidden md:flex space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.page);
                return (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all ${
                      active
                        ? 'bg-cyan-50 text-cyan-700 font-medium'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* License Status Badge */}
            <Link to="/license" className="hidden sm:block">
              <LicenseStatusBadge size="small" />
            </Link>
            
            <NotificationBell user={user} />
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-slate-50 rounded-lg">
              <Shield className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">{user?.full_name || user?.email}</span>
              <span className="text-xs text-slate-500 px-2 py-0.5 bg-white rounded">
                {user?.role}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-slate-600 hover:text-slate-900"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-slate-200 px-4 py-2 flex space-x-1 overflow-x-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.page);
          return (
            <Link
              key={item.page}
              to={createPageUrl(item.page)}
              className={`flex flex-col items-center justify-center px-4 py-2 rounded-lg transition-all min-w-fit ${
                active
                  ? 'bg-cyan-50 text-cyan-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs mt-1">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
