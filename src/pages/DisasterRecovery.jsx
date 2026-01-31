import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { 
  Database, Download, Upload, CheckCircle, AlertTriangle,
  Clock, HardDrive, RefreshCw, Shield
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

export default function DisasterRecovery() {
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [backupDescription, setBackupDescription] = useState('');
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ['recoveryStatus'],
    queryFn: async () => {
      if (window.electronAPI?.recovery) {
        return await window.electronAPI.recovery.getStatus();
      }
      return null;
    },
    refetchInterval: 30000,
  });

  const { data: backups, refetch: refetchBackups } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => {
      if (window.electronAPI?.recovery) {
        return await window.electronAPI.recovery.listBackups();
      }
      return [];
    },
  });

  const createBackupMutation = useMutation({
    mutationFn: async () => {
      return await window.electronAPI.recovery.createBackup({
        type: 'manual',
        description: backupDescription || 'Manual backup',
      });
    },
    onSuccess: (data) => {
      toast.success('Backup created successfully');
      setBackupDescription('');
      refetchBackups();
      queryClient.invalidateQueries(['recoveryStatus']);
    },
    onError: (error) => {
      toast.error(`Backup failed: ${error.message}`);
    },
  });

  const verifyBackupMutation = useMutation({
    mutationFn: async (backupId) => {
      return await window.electronAPI.recovery.verifyBackup(backupId);
    },
    onSuccess: (data) => {
      if (data.valid) {
        toast.success('Backup verified successfully');
      } else {
        toast.error(`Backup verification failed: ${data.error}`);
      }
    },
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async (backupId) => {
      return await window.electronAPI.recovery.restoreBackup(backupId);
    },
    onSuccess: (data) => {
      toast.success('Restore completed. Please restart the application.');
      setRestoreDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Restore failed: ${error.message}`);
    },
  });

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Database className="w-8 h-8 text-cyan-600" />
              Disaster Recovery
            </h1>
            <p className="text-slate-600 mt-1">
              Backup, restore, and business continuity management
            </p>
          </div>
        </div>

        {/* Status Alert */}
        {status?.backupOverdue && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Backup Overdue</AlertTitle>
            <AlertDescription>
              Last backup was {status.hoursSinceLastBackup} hours ago. 
              It's recommended to create a backup at least every {status.config?.autoBackupIntervalHours} hours.
            </AlertDescription>
          </Alert>
        )}

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                Total Backups
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{status?.backupCount || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Last Backup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-slate-900">
                {status?.latestBackup 
                  ? formatDistanceToNow(new Date(status.latestBackup.createdAt), { addSuffix: true })
                  : 'Never'
                }
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Storage Used
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-slate-900">
                {formatBytes(status?.storageUsedBytes || 0)}
              </div>
            </CardContent>
          </Card>

          <Card className={status?.backupOverdue ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-sm font-medium flex items-center gap-2 ${status?.backupOverdue ? 'text-red-700' : 'text-green-700'}`}>
                <Shield className="w-4 h-4" />
                Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-lg font-bold ${status?.backupOverdue ? 'text-red-900' : 'text-green-900'}`}>
                {status?.backupOverdue ? 'At Risk' : 'Protected'}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Create Backup */}
        <Card>
          <CardHeader>
            <CardTitle>Create Backup</CardTitle>
            <CardDescription>
              Create a new backup of the entire database
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="description">Backup Description (optional)</Label>
                <Input
                  id="description"
                  placeholder="e.g., Before major update"
                  value={backupDescription}
                  onChange={(e) => setBackupDescription(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button 
                  onClick={() => createBackupMutation.mutate()}
                  disabled={createBackupMutation.isPending}
                  className="bg-cyan-600 hover:bg-cyan-700"
                >
                  {createBackupMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Create Backup
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backup List */}
        <Card>
          <CardHeader>
            <CardTitle>Available Backups</CardTitle>
            <CardDescription>
              Manage and restore from previous backups
            </CardDescription>
          </CardHeader>
          <CardContent>
            {backups?.length > 0 ? (
              <div className="space-y-3">
                {backups.map((backup) => (
                  <div 
                    key={backup.id}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border"
                  >
                    <div className="flex items-center gap-4">
                      <Database className="w-8 h-8 text-slate-400" />
                      <div>
                        <div className="font-medium text-slate-900">{backup.fileName}</div>
                        <div className="text-sm text-slate-500">
                          {format(new Date(backup.createdAt), 'MMM d, yyyy HH:mm')}
                          {' • '}
                          {formatBytes(backup.stats?.fileSizeBytes || 0)}
                          {' • '}
                          {backup.stats?.patientCount || 0} patients
                        </div>
                        {backup.description && (
                          <div className="text-sm text-slate-600 mt-1">{backup.description}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {backup.type}
                      </Badge>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => verifyBackupMutation.mutate(backup.id)}
                        disabled={verifyBackupMutation.isPending}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Verify
                      </Button>
                      <Dialog open={restoreDialogOpen && selectedBackup?.id === backup.id} onOpenChange={(open) => {
                        setRestoreDialogOpen(open);
                        if (open) setSelectedBackup(backup);
                      }}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Upload className="w-4 h-4 mr-1" />
                            Restore
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Restore from Backup</DialogTitle>
                            <DialogDescription>
                              This will replace all current data with the backup from{' '}
                              {format(new Date(backup.createdAt), 'MMM d, yyyy HH:mm')}.
                              A pre-restore backup will be created automatically.
                            </DialogDescription>
                          </DialogHeader>
                          <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Warning</AlertTitle>
                            <AlertDescription>
                              This action cannot be undone. All changes made after this backup will be lost.
                            </AlertDescription>
                          </Alert>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button 
                              variant="destructive"
                              onClick={() => restoreBackupMutation.mutate(backup.id)}
                              disabled={restoreBackupMutation.isPending}
                            >
                              {restoreBackupMutation.isPending ? 'Restoring...' : 'Restore Backup'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <Database className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>No backups available</p>
                <p className="text-sm">Create your first backup to get started</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
