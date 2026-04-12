/**
 * ComplianceCenter Page Component Tests
 *
 * Validates the compliance center UI:
 * - Renders the heading
 * - Shows HIPAA and FDA compliance badges
 * - Displays tabs for Validation, Audit, Barriers, Completeness
 * - Displays summary cards
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

vi.mock('@/api/apiClient', () => ({
  api: {
    compliance: {
      getSummary: vi.fn().mockResolvedValue({
        patients: { total: 42, active: 35 },
        users: { total: 8, admins: 2 },
        auditActivity: { totalActions: 156 },
      }),
      getValidationReport: vi.fn().mockResolvedValue({
        checks: [
          { name: 'Encryption', status: 'PASS' },
          { name: 'Audit Logging', status: 'PASS' },
        ],
      }),
      getDataCompleteness: vi.fn().mockResolvedValue({
        summary: { averageCompleteness: 94, completeRecords: 38 },
      }),
      getAuditTrail: vi.fn().mockResolvedValue({ entries: [] }),
    },
    barriers: {
      getAuditHistory: vi.fn().mockResolvedValue([]),
      getDashboard: vi.fn().mockResolvedValue({
        totalBarriers: 0,
        patientsWithBarriers: 0,
        totalOpenBarriers: 0,
      }),
    },
  },
}));

import ComplianceCenter from '@/pages/ComplianceCenter';

function renderComplianceCenter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <ComplianceCenter />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('ComplianceCenter Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', async () => {
    renderComplianceCenter();
    await waitFor(() => {
      expect(screen.getByText('Compliance Center')).toBeInTheDocument();
    });
  });

  it('renders HIPAA Compliant badge', async () => {
    renderComplianceCenter();
    await waitFor(() => {
      expect(screen.getByText('HIPAA Compliant')).toBeInTheDocument();
    });
  });

  it('renders FDA 21 CFR Part 11 badge', async () => {
    renderComplianceCenter();
    await waitFor(() => {
      expect(screen.getByText('FDA 21 CFR Part 11')).toBeInTheDocument();
    });
  });

  it('renders tab triggers for Validation and Audit Trail', async () => {
    renderComplianceCenter();
    await waitFor(() => {
      expect(screen.getByText('Validation Report')).toBeInTheDocument();
      expect(screen.getByText('Audit Trail')).toBeInTheDocument();
      expect(screen.getByText('Barrier Audit')).toBeInTheDocument();
      // "Data Completeness" appears both as tab trigger and card title — use role
      expect(screen.getByRole('tab', { name: /Data Completeness/i })).toBeInTheDocument();
    });
  });

  it('renders summary cards with patient and user counts', async () => {
    renderComplianceCenter();
    await waitFor(() => {
      expect(screen.getByText('Total Patients')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('System Users')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
    });
  });

  it('renders data completeness percentage', async () => {
    renderComplianceCenter();
    await waitFor(() => {
      expect(screen.getByText(/94%/)).toBeInTheDocument();
    });
  });
});
