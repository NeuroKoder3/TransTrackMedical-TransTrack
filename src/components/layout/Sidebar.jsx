import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import {
  Activity, Users, FileText, Settings, Shield, Heart, Database,
  AlertTriangle, HardDrive, BarChart3, Brain, ListTodo, ClipboardCheck,
  Stethoscope, Inbox, KeyRound, UserPlus, X, Key,
} from 'lucide-react';

/**
 * Left-side vertical navigation sidebar.
 *
 * Replaces the old horizontal top-nav so users scroll vertically through
 * grouped sections instead of scrolling horizontally on narrow screens.
 *
 * Sections are role-gated so coordinators / physicians / admins /
 * regulators only see the items their role is authorised for.
 */
export default function Sidebar({ user, isOpen = true, onClose }) {
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (pageName) => {
    const pageUrl = createPageUrl(pageName);
    if (pageName === 'Dashboard') {
      return currentPath === '/' || currentPath === '';
    }
    return currentPath === pageUrl || currentPath === `/${pageName}`;
  };

  const role = user?.role;
  const isAdmin = role === 'admin';
  const isCoordinator = role === 'coordinator';
  const isPhysician = role === 'physician';
  const isRegulator = role === 'regulator';
  const isClinicalStaff = isAdmin || isCoordinator || isPhysician;

  // Build grouped sections. Empty groups are filtered out below.
  const sections = [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { name: 'Dashboard', page: 'Dashboard', icon: Activity, show: true },
      ],
    },
    {
      id: 'clinical',
      label: 'Clinical',
      items: [
        { name: 'Patients', page: 'Patients', icon: Users, show: true },
        { name: 'Donor Matching', page: 'DonorMatching', icon: Heart, show: true },
        { name: 'Organ Offers', page: 'OrganOffers', icon: Heart, show: isClinicalStaff },
        { name: 'Post-Transplant', page: 'PostTransplant', icon: Stethoscope, show: isClinicalStaff },
        { name: 'Living Donors', page: 'LivingDonors', icon: UserPlus, show: isClinicalStaff },
      ],
    },
    {
      id: 'operations',
      label: 'Operations',
      items: [
        { name: 'Reports', page: 'Reports', icon: FileText, show: true },
        { name: 'Tasks', page: 'TaskCenter', icon: ListTodo, show: isClinicalStaff },
        { name: 'Risk Intel', page: 'RiskDashboard', icon: AlertTriangle, show: isClinicalStaff },
        { name: 'Predictive', page: 'PredictiveRisk', icon: Brain, show: isClinicalStaff },
        { name: 'Outcomes', page: 'OutcomesDashboard', icon: BarChart3, show: isAdmin },
        { name: 'HL7 Inbox', page: 'Hl7Inbox', icon: Inbox, show: isAdmin || isCoordinator },
      ],
    },
    {
      id: 'admin',
      label: 'Administration',
      items: [
        { name: 'CMS / SRTR', page: 'CMSReadiness', icon: ClipboardCheck, show: isAdmin },
        { name: 'EHR Integration', page: 'EHRIntegration', icon: Database, show: isAdmin },
        { name: 'Priority Config', page: 'PrioritySettings', icon: Settings, show: isAdmin },
        { name: 'Compliance', page: 'ComplianceCenter', icon: Shield, show: isAdmin || isRegulator },
        { name: 'Recovery', page: 'DisasterRecovery', icon: HardDrive, show: isAdmin },
        { name: 'License', page: 'License', icon: Key, show: isAdmin },
        { name: 'Settings', page: 'Settings', icon: Settings, show: isAdmin },
      ],
    },
    {
      id: 'account',
      label: 'Account',
      items: [
        { name: 'Account Security', page: 'AccountSecurity', icon: KeyRound, show: !!user },
      ],
    },
  ];

  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show) }))
    .filter((s) => s.items.length > 0);

  return (
    <>
      {/* Backdrop (mobile only) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transform transition-transform duration-200 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:sticky md:top-0 md:h-screen`}
        aria-label="Primary navigation"
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 shrink-0">
          <Link to={createPageUrl('Dashboard')} className="flex items-center space-x-2" onClick={onClose}>
            <div className="bg-gradient-to-br from-cyan-500 to-teal-600 p-2 rounded-lg">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-slate-900">TransTrack</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="md:hidden p-2 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {visibleSections.map((section) => (
            <div key={section.id}>
              <div className="px-2 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {section.label}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.page);
                  return (
                    <li key={item.page}>
                      <Link
                        to={createPageUrl(item.page)}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors
                          ${active
                            ? 'bg-cyan-50 text-cyan-700 font-medium'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-cyan-600' : 'text-slate-500'}`} />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {user && (
          <div className="border-t border-slate-200 p-3 shrink-0">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-md">
              <Shield className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-700 truncate">
                  {user.full_name || user.email}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{user.role}</div>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
