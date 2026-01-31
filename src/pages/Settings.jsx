import React from 'react';
import { api } from '@/api/apiClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Shield, Activity } from 'lucide-react';
import { format } from 'date-fns';

export default function Settings() {
  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => api.auth.me(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => api.entities.User.list(),
    enabled: user?.role === 'admin',
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['recentAuditLogs'],
    queryFn: () => api.entities.AuditLog.list('-created_at', 20),
    enabled: user?.role === 'admin',
  });

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-12 text-center">
              <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-red-900 mb-2">Admin Access Required</h2>
              <p className="text-red-700">Only administrators can access system settings</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">System Settings</h1>
          <p className="text-slate-600 mt-1">Manage users and system configuration</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Users className="w-4 h-4 mr-2 text-cyan-600" />
                Total Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{allUsers.length}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Shield className="w-4 h-4 mr-2 text-cyan-600" />
                Administrators
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {allUsers.filter(u => u.role === 'admin').length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Activity className="w-4 h-4 mr-2 text-cyan-600" />
                Recent Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{auditLogs.length}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>User Management</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {allUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm text-slate-900">{u.full_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {format(new Date(u.created_at), 'MMM d, yyyy')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Recent System Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {auditLogs.length === 0 ? (
                <p className="text-slate-500 text-center py-4">No recent activity</p>
              ) : (
                auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start space-x-3 pb-3 border-b border-slate-100 last:border-0">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-slate-900">{log.action.toUpperCase()}</span>
                        <span className="text-slate-500">•</span>
                        <span className="text-sm text-slate-600">{log.entity_type}</span>
                      </div>
                      <p className="text-sm text-slate-700 mt-1">{log.details}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')} by {log.user_email}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-6">
            <h3 className="font-semibold text-amber-900 mb-2">Priority Algorithm Configuration</h3>
            <p className="text-sm text-amber-800 mb-4">
              The priority scoring algorithm considers: medical urgency (30 pts), time on waitlist (25 pts), 
              organ-specific scores (25 pts), recent evaluation (10 pts), and blood type rarity (10 pts).
            </p>
            <p className="text-xs text-amber-700">
              Contact your system administrator to customize priority weights for your facility's protocols.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}