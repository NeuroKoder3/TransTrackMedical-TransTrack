/**
 * DisasterRecovery Page Component Tests
 *
 * Validates the disaster recovery UI:
 * - Renders the page heading
 * - Shows status cards
 * - Shows backup list section
 * - Empty state when no backups
 * - Backup overdue alert
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  window.electronAPI = {
    ...window.electronAPI,
    recovery: {
      getStatus: vi.fn().mockResolvedValue({
        backupOverdue: false,
        lastBackupTime: '2025-12-01T12:00:00Z',
        hoursSinceLastBackup: 2,
        totalBackups: 3,
        config: { autoBackupIntervalHours: 24 },
      }),
      listBackups: vi.fn().mockResolvedValue([
        {
          id: 'bk1',
          fileName: 'backup-2025-12-01.db',
          createdAt: '2025-12-01T12:00:00Z',
          type: 'manual',
          description: 'Manual backup',
          stats: { patientCount: 10, fileSizeBytes: 1024000 },
          checksum: 'abc123',
        },
      ]),
      createBackup: vi.fn().mockResolvedValue({ id: 'bk2' }),
      verifyBackup: vi.fn().mockResolvedValue({ valid: true }),
      restoreBackup: vi.fn().mockResolvedValue({ success: true }),
    },
  };
});

import DisasterRecovery from '@/pages/DisasterRecovery';

function renderDisasterRecovery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <DisasterRecovery />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('DisasterRecovery Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', async () => {
    renderDisasterRecovery();
    await waitFor(() => {
      expect(screen.getByText('Disaster Recovery')).toBeInTheDocument();
    });
  });

  it('renders the subheading description', async () => {
    renderDisasterRecovery();
    await waitFor(() => {
      expect(screen.getByText(/Backup, restore, and business continuity management/i)).toBeInTheDocument();
    });
  });

  it('renders the Create Backup button', async () => {
    renderDisasterRecovery();
    await waitFor(() => {
      // "Create Backup" appears as both a card title and a button — use role
      expect(screen.getByRole('button', { name: /Create Backup/i })).toBeInTheDocument();
    });
  });

  it('shows empty state when no backups exist', async () => {
    window.electronAPI.recovery.listBackups.mockResolvedValueOnce([]);
    renderDisasterRecovery();
    await waitFor(() => {
      expect(screen.getByText(/No backups available/i)).toBeInTheDocument();
    });
  });

  it('shows backup overdue alert when overdue', async () => {
    window.electronAPI.recovery.getStatus.mockResolvedValueOnce({
      backupOverdue: true,
      lastBackupTime: '2025-11-01T12:00:00Z',
      hoursSinceLastBackup: 72,
      config: { autoBackupIntervalHours: 24 },
    });
    renderDisasterRecovery();
    await waitFor(() => {
      expect(screen.getByText('Backup Overdue')).toBeInTheDocument();
    });
  });
});
