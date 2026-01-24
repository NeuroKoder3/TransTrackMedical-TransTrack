import React, { useState } from 'react';
import { api } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Bell, Plus, AlertCircle, Trash2, Edit, Check, X } from 'lucide-react';
import { format } from 'date-fns';

export default function Notifications() {
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => api.auth.me(),
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['notificationRules'],
    queryFn: () => api.entities.NotificationRule.list('-created_date', 100),
    enabled: user?.role === 'admin',
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['allNotifications', user?.email],
    queryFn: () => api.entities.Notification.filter(
      { recipient_email: user.email },
      '-created_date',
      100
    ),
    enabled: !!user,
  });

  const createRuleMutation = useMutation({
    mutationFn: (ruleData) => api.entities.NotificationRule.create(ruleData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationRules'] });
      setShowRuleForm(false);
      setEditingRule(null);
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.NotificationRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationRules'] });
      setShowRuleForm(false);
      setEditingRule(null);
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => api.entities.NotificationRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationRules'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.is_read);
      await Promise.all(unread.map(n => api.entities.Notification.update(n.id, { is_read: true })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allNotifications'] });
    },
  });

  const [ruleForm, setRuleForm] = useState({
    rule_name: '',
    rule_type: 'priority_threshold',
    is_active: true,
    trigger_conditions: {},
    notification_channels: ['in_app'],
    notify_roles: ['admin'],
    message_template: '',
  });

  const handleSaveRule = () => {
    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, data: ruleForm });
    } else {
      createRuleMutation.mutate(ruleForm);
    }
  };

  const handleEditRule = (rule) => {
    setEditingRule(rule);
    setRuleForm(rule);
    setShowRuleForm(true);
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <h1 className="text-3xl font-bold text-slate-900">Notifications</h1>

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Your Notifications</CardTitle>
                {unreadCount > 0 && (
                  <Button size="sm" variant="outline" onClick={() => markAllReadMutation.mutate()}>
                    <Check className="w-4 h-4 mr-2" />
                    Mark All Read
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {notifications.length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600">No notifications yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 border rounded-lg ${
                        !notification.is_read ? 'bg-cyan-50 border-cyan-200' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-medium text-slate-900">{notification.title}</h4>
                            <Badge className={`${
                              notification.priority_level === 'critical' ? 'bg-red-100 text-red-700' :
                              notification.priority_level === 'high' ? 'bg-orange-100 text-orange-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {notification.priority_level}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-600 mt-1">{notification.message}</p>
                          <p className="text-xs text-slate-400 mt-2">
                            {format(new Date(notification.created_date), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Notification Management</h1>
            <p className="text-slate-600 mt-1">Configure custom alert rules</p>
          </div>
          {!showRuleForm && (
            <Button onClick={() => { setShowRuleForm(true); setEditingRule(null); setRuleForm({
              rule_name: '',
              rule_type: 'priority_threshold',
              is_active: true,
              trigger_conditions: {},
              notification_channels: ['in_app'],
              notify_roles: ['admin'],
              message_template: '',
            }); }} className="bg-cyan-600 hover:bg-cyan-700">
              <Plus className="w-5 h-5 mr-2" />
              Create Rule
            </Button>
          )}
        </div>

        {showRuleForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingRule ? 'Edit' : 'Create'} Notification Rule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Rule Name</Label>
                  <Input
                    value={ruleForm.rule_name}
                    onChange={(e) => setRuleForm({ ...ruleForm, rule_name: e.target.value })}
                    placeholder="e.g., Critical Priority Alert"
                  />
                </div>
                <div>
                  <Label>Rule Type</Label>
                  <Select value={ruleForm.rule_type} onValueChange={(value) => setRuleForm({ ...ruleForm, rule_type: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="priority_threshold">Priority Threshold</SelectItem>
                      <SelectItem value="status_change">Status Change</SelectItem>
                      <SelectItem value="evaluation_overdue">Evaluation Overdue</SelectItem>
                      <SelectItem value="time_on_waitlist">Time on Waitlist</SelectItem>
                      <SelectItem value="score_change">Score Change</SelectItem>
                      <SelectItem value="new_patient">New Patient Added</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {ruleForm.rule_type === 'priority_threshold' && (
                <div>
                  <Label>Priority Score Threshold</Label>
                  <Input
                    type="number"
                    value={ruleForm.trigger_conditions?.priority_score || ''}
                    onChange={(e) => setRuleForm({
                      ...ruleForm,
                      trigger_conditions: { ...ruleForm.trigger_conditions, priority_score: parseFloat(e.target.value) }
                    })}
                    placeholder="e.g., 80"
                  />
                </div>
              )}

              {(ruleForm.rule_type === 'evaluation_overdue' || ruleForm.rule_type === 'time_on_waitlist') && (
                <div>
                  <Label>Days Threshold</Label>
                  <Input
                    type="number"
                    value={ruleForm.trigger_conditions?.days_threshold || ''}
                    onChange={(e) => setRuleForm({
                      ...ruleForm,
                      trigger_conditions: { ...ruleForm.trigger_conditions, days_threshold: parseInt(e.target.value) }
                    })}
                    placeholder="e.g., 90"
                  />
                </div>
              )}

              <div>
                <Label>Notification Channels</Label>
                <div className="flex space-x-4 mt-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={ruleForm.notification_channels.includes('in_app')}
                      onChange={(e) => {
                        const channels = e.target.checked
                          ? [...ruleForm.notification_channels, 'in_app']
                          : ruleForm.notification_channels.filter(c => c !== 'in_app');
                        setRuleForm({ ...ruleForm, notification_channels: channels });
                      }}
                    />
                    <span className="text-sm">In-App</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={ruleForm.notification_channels.includes('email')}
                      onChange={(e) => {
                        const channels = e.target.checked
                          ? [...ruleForm.notification_channels, 'email']
                          : ruleForm.notification_channels.filter(c => c !== 'email');
                        setRuleForm({ ...ruleForm, notification_channels: channels });
                      }}
                    />
                    <span className="text-sm">Email</span>
                  </label>
                </div>
              </div>

              <div>
                <Label>Notify Roles</Label>
                <div className="flex space-x-4 mt-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={ruleForm.notify_roles.includes('admin')}
                      onChange={(e) => {
                        const roles = e.target.checked
                          ? [...ruleForm.notify_roles, 'admin']
                          : ruleForm.notify_roles.filter(r => r !== 'admin');
                        setRuleForm({ ...ruleForm, notify_roles: roles });
                      }}
                    />
                    <span className="text-sm">Admins</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={ruleForm.notify_roles.includes('user')}
                      onChange={(e) => {
                        const roles = e.target.checked
                          ? [...ruleForm.notify_roles, 'user']
                          : ruleForm.notify_roles.filter(r => r !== 'user');
                        setRuleForm({ ...ruleForm, notify_roles: roles });
                      }}
                    />
                    <span className="text-sm">All Users</span>
                  </label>
                </div>
              </div>

              <div>
                <Label>Custom Message Template (Optional)</Label>
                <Textarea
                  value={ruleForm.message_template}
                  onChange={(e) => setRuleForm({ ...ruleForm, message_template: e.target.value })}
                  placeholder="Leave blank to use default message"
                  rows={2}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={ruleForm.is_active}
                  onCheckedChange={(checked) => setRuleForm({ ...ruleForm, is_active: checked })}
                />
                <Label>Active</Label>
              </div>

              <div className="flex justify-end space-x-3">
                <Button variant="outline" onClick={() => { setShowRuleForm(false); setEditingRule(null); }}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSaveRule} className="bg-cyan-600 hover:bg-cyan-700">
                  <Check className="w-4 h-4 mr-2" />
                  {editingRule ? 'Update' : 'Create'} Rule
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Active Notification Rules</CardTitle>
          </CardHeader>
          <CardContent>
            {rules.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-600">No notification rules configured</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div key={rule.id} className="p-4 border border-slate-200 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-medium text-slate-900">{rule.rule_name}</h4>
                          <Badge variant={rule.is_active ? 'default' : 'secondary'}>
                            {rule.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          <Badge variant="outline">
                            {rule.rule_type.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <div className="flex items-center space-x-4 mt-2 text-sm text-slate-600">
                          <span>Channels: {rule.notification_channels.join(', ')}</span>
                          <span>•</span>
                          <span>Roles: {rule.notify_roles.join(', ')}</span>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <Button variant="outline" size="sm" onClick={() => handleEditRule(rule)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteRuleMutation.mutate(rule.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}