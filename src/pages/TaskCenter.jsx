import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ListTodo, RefreshCw, Play, Clock, CheckCircle,
  ExternalLink, ArrowUpCircle, Zap, CircleDot
} from 'lucide-react';
import { createPageUrl, formatDate } from '@/utils';

const TASK_TYPE_LABELS = {
  EVALUATION_RENEWAL: 'Evaluation Renewal',
  BARRIER_RESOLUTION: 'Barrier Resolution',
  DOCUMENTATION_UPDATE: 'Documentation Update',
  LAB_FOLLOWUP: 'Lab Follow-up',
  AHHQ_COMPLETION: 'aHHQ Completion',
  COORDINATOR_REVIEW: 'Coordinator Review',
  RISK_MITIGATION: 'Risk Mitigation',
  GENERAL: 'General',
};

const PRIORITY_STYLES = {
  urgent: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  normal: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  escalated: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function TaskCenter() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('active');
  const [typeFilter, setTypeFilter] = useState('all');

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['tasksDashboard'],
    queryFn: async () => {
      if (window.electronAPI?.tasks) {
        return await window.electronAPI.tasks.getDashboard();
      }
      return null;
    },
    refetchInterval: 60000,
  });

  const { data: allTasks, refetch: refetchTasks } = useQuery({
    queryKey: ['allTasks', statusFilter, typeFilter],
    queryFn: async () => {
      if (window.electronAPI?.tasks) {
        const filters = {};
        if (statusFilter === 'active') {
          // handled client-side
        } else if (statusFilter !== 'all') {
          filters.status = statusFilter;
        }
        if (typeFilter !== 'all') filters.task_type = typeFilter;
        const tasks = await window.electronAPI.tasks.getAll(filters);
        if (statusFilter === 'active') {
          return tasks.filter(t => !['completed', 'cancelled'].includes(t.status));
        }
        return tasks;
      }
      return [];
    },
    refetchInterval: 60000,
  });

  const generateMutation = useMutation({
    mutationFn: () => window.electronAPI.tasks.generateAuto(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasksDashboard'] });
      queryClient.invalidateQueries({ queryKey: ['allTasks'] });
    },
  });

  const escalateMutation = useMutation({
    mutationFn: () => window.electronAPI.tasks.processEscalations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasksDashboard'] });
      queryClient.invalidateQueries({ queryKey: ['allTasks'] });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, updates }) => window.electronAPI.tasks.update(taskId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasksDashboard'] });
      queryClient.invalidateQueries({ queryKey: ['allTasks'] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  const stats = dashboard?.stats || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <ListTodo className="w-8 h-8 text-cyan-600" />
              Task Center
            </h1>
            <p className="text-slate-600 mt-1">
              Automated task management with escalation tracking
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              <Zap className={`w-4 h-4 mr-2 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
              Auto-Generate
            </Button>
            <Button variant="outline" onClick={() => escalateMutation.mutate()} disabled={escalateMutation.isPending}>
              <ArrowUpCircle className={`w-4 h-4 mr-2 ${escalateMutation.isPending ? 'animate-spin' : ''}`} />
              Process Escalations
            </Button>
          </div>
        </div>

        {generateMutation.isSuccess && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700">
              Generated {generateMutation.data?.generated || 0} new tasks from operational signals.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-yellow-600 font-medium">Pending</div>
              <div className="text-2xl font-bold text-yellow-900">{stats.pending || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-blue-600 font-medium">In Progress</div>
              <div className="text-2xl font-bold text-blue-900">{stats.inProgress || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-red-600 font-medium">Overdue</div>
              <div className="text-2xl font-bold text-red-900">{stats.overdue || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-purple-200 bg-purple-50">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-purple-600 font-medium">Escalated</div>
              <div className="text-2xl font-bold text-purple-900">{stats.escalated || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-green-600 font-medium">Completed</div>
              <div className="text-2xl font-bold text-green-900">{stats.completed || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-orange-600 font-medium">Urgent Active</div>
              <div className="text-2xl font-bold text-orange-900">{stats.urgentActive || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-slate-600 font-medium">Completion Rate</div>
              <div className="text-2xl font-bold text-slate-900">{stats.completionRate || 0}%</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="tasks" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tasks">Task List</TabsTrigger>
            <TabsTrigger value="distribution">Distribution</TabsTrigger>
          </TabsList>

          <TabsContent value="tasks">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Tasks</CardTitle>
                    <CardDescription>{(allTasks || []).length} tasks shown</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-3 py-1.5 text-sm border rounded-md bg-white">
                      <option value="active">Active</option>
                      <option value="all">All</option>
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="overdue">Overdue</option>
                      <option value="escalated">Escalated</option>
                      <option value="completed">Completed</option>
                    </select>
                    <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                      className="px-3 py-1.5 text-sm border rounded-md bg-white">
                      <option value="all">All Types</option>
                      {Object.entries(TASK_TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {(allTasks || []).length > 0 ? (
                  <div className="space-y-2">
                    {allTasks.map((task) => (
                      <div key={task.id}
                        className={`p-4 rounded-lg border-l-4 bg-slate-50 border hover:bg-slate-100 transition-colors ${
                          task.priority === 'urgent' ? 'border-l-red-500' :
                          task.priority === 'high' ? 'border-l-orange-500' :
                          task.priority === 'normal' ? 'border-l-blue-500' : 'border-l-slate-300'
                        }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={PRIORITY_STYLES[task.priority]}>{task.priority}</Badge>
                              <Badge className={STATUS_STYLES[task.status]}>{task.status?.replace('_', ' ')}</Badge>
                              {task.source !== 'MANUAL' && (
                                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                                  <Zap className="w-3 h-3 mr-1" /> Auto
                                </Badge>
                              )}
                              {task.escalation_level > 0 && (
                                <Badge className="bg-purple-100 text-purple-700">
                                  <ArrowUpCircle className="w-3 h-3 mr-1" /> Level {task.escalation_level}
                                </Badge>
                              )}
                            </div>
                            <h4 className="font-medium text-slate-900 truncate">{task.title}</h4>
                            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                              <span>{TASK_TYPE_LABELS[task.task_type] || task.task_type}</span>
                              {task.first_name && (
                                <Link to={`${createPageUrl('PatientDetails')}?id=${task.patient_id}`}
                                  className="text-cyan-600 hover:underline flex items-center gap-1">
                                  {task.first_name} {task.last_name}
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              )}
                              {task.due_date && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> Due {formatDate(task.due_date)}
                                </span>
                              )}
                              {task.assigned_role && (
                                <span className="capitalize">{task.assigned_role.replace('_', ' ')}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1 ml-2">
                            {task.status === 'pending' && (
                              <Button size="sm" variant="outline"
                                onClick={() => updateTaskMutation.mutate({ taskId: task.id, updates: { status: 'in_progress' } })}>
                                <Play className="w-3 h-3 mr-1" /> Start
                              </Button>
                            )}
                            {['pending', 'in_progress', 'overdue', 'escalated'].includes(task.status) && (
                              <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50"
                                onClick={() => updateTaskMutation.mutate({ taskId: task.id, updates: { status: 'completed' } })}>
                                <CheckCircle className="w-3 h-3 mr-1" /> Complete
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    <ListTodo className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium">No tasks found</p>
                    <p className="text-sm mt-1">Click &quot;Auto-Generate&quot; to create tasks from operational signals</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="distribution">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Tasks by Type</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(dashboard?.byType || {}).length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(dashboard.byType).map(([type, count]) => {
                        const maxCount = Math.max(...Object.values(dashboard.byType), 1);
                        return (
                          <div key={type} className="flex items-center gap-3">
                            <div className="w-36 text-sm text-slate-600 truncate">
                              {TASK_TYPE_LABELS[type] || type}
                            </div>
                            <div className="flex-1 h-6 bg-slate-100 rounded overflow-hidden">
                              <div className="h-full bg-cyan-500 rounded transition-all duration-500"
                                style={{ width: `${(count / maxCount) * 100}%` }} />
                            </div>
                            <Badge variant="secondary">{count}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-center py-8 text-slate-400">No active tasks to display</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tasks by Assigned Role</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(dashboard?.byAssignedRole || {}).length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(dashboard.byAssignedRole).map(([role, count]) => (
                        <div key={role} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                          <span className="text-sm font-medium text-slate-700 capitalize">{role.replace('_', ' ')}</span>
                          <Badge>{count}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center py-8 text-slate-400">No role assignments to display</p>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Source Breakdown</CardTitle>
                  <CardDescription>Manual vs. auto-generated tasks</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
                      <Zap className="w-6 h-6 text-blue-600 mx-auto mb-1" />
                      <div className="text-2xl font-bold text-blue-900">{stats.autoGenerated || 0}</div>
                      <div className="text-sm text-blue-600">Auto-Generated</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                      <CircleDot className="w-6 h-6 text-slate-600 mx-auto mb-1" />
                      <div className="text-2xl font-bold text-slate-900">{stats.manual || 0}</div>
                      <div className="text-sm text-slate-600">Manual</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
