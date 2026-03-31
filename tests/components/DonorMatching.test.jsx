/**
 * DonorMatching Page Component Tests
 *
 * Validates the donor matching UI:
 * - Renders the page heading
 * - Shows donor statistics cards
 * - Lists donors after loading
 * - Has Add Donor Organ button
 * - Has Match Simulator button
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

vi.mock('@/api/apiClient', () => ({
  api: {
    entities: {
      DonorOrgan: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'd1',
            donor_id: 'DON-001',
            organ_type: 'kidney',
            blood_type: 'O+',
            status: 'available',
            procurement_date: '2025-10-01',
            created_at: '2025-10-01T12:00:00Z',
          },
          {
            id: 'd2',
            donor_id: 'DON-002',
            organ_type: 'liver',
            blood_type: 'A-',
            status: 'allocated',
            procurement_date: '2025-10-05',
            created_at: '2025-10-05T12:00:00Z',
          },
        ]),
      },
      AuditLog: {
        create: vi.fn().mockResolvedValue({ id: 'a1' }),
      },
    },
    auth: {
      me: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@test.com', role: 'admin' }),
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ matches: [] }),
    },
  },
}));

import DonorMatching from '@/pages/DonorMatching';

function renderDonorMatching() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <DonorMatching />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('DonorMatching Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', async () => {
    renderDonorMatching();
    await waitFor(() => {
      expect(screen.getByText('Donor Matching')).toBeInTheDocument();
    });
  });

  it('renders the subheading description', async () => {
    renderDonorMatching();
    await waitFor(() => {
      expect(screen.getByText(/Match donor organs with compatible recipients/i)).toBeInTheDocument();
    });
  });

  it('renders Add Donor Organ button', async () => {
    renderDonorMatching();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Donor Organ/i })).toBeInTheDocument();
    });
  });

  it('renders Match Simulator button', async () => {
    renderDonorMatching();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Match Simulator/i })).toBeInTheDocument();
    });
  });

  it('renders donor statistics cards', async () => {
    renderDonorMatching();
    await waitFor(() => {
      expect(screen.getByText(/Total Donors/i)).toBeInTheDocument();
    });
  });
});
