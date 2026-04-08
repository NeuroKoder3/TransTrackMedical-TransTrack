// Dashboard component tests
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

vi.mock('@/api/apiClient', () => ({
  api: {
    entities: {
      Patient: {
        list: vi.fn().mockResolvedValue([
          {
            id: '1',
            first_name: 'John',
            last_name: 'Doe',
            patient_id: 'MRN-001',
            blood_type: 'O+',
            organ_needed: 'kidney',
            waitlist_status: 'active',
            priority_score: 85,
            date_added_to_waitlist: '2025-01-15',
            medical_urgency: 'high',
          },
          {
            id: '2',
            first_name: 'Jane',
            last_name: 'Smith',
            patient_id: 'MRN-002',
            blood_type: 'A-',
            organ_needed: 'liver',
            waitlist_status: 'active',
            priority_score: 72,
            date_added_to_waitlist: '2025-03-20',
            medical_urgency: 'medium',
          },
          {
            id: '3',
            first_name: 'Bob',
            last_name: 'Williams',
            patient_id: 'MRN-003',
            blood_type: 'B+',
            organ_needed: 'heart',
            waitlist_status: 'transplanted',
            priority_score: 60,
            date_added_to_waitlist: '2024-11-01',
            medical_urgency: 'low',
          },
        ]),
      },
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ success: true }),
    },
  },
}));

import Dashboard from '@/pages/Dashboard';

function renderDashboard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <Dashboard />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Waitlist Dashboard/i)).toBeInTheDocument();
    });
  });

  it('renders statistics cards', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Total Patients/i)).toBeInTheDocument();
    });
  });

  it('renders the Recalculate button', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Recalculate/i)).toBeInTheDocument();
    });
  });

  it('displays patient cards after loading', async () => {
    renderDashboard();
    await waitFor(() => {
      // Patient names rendered within cards
      expect(screen.getByText(/John/i)).toBeInTheDocument();
    });
  });

  it('renders the filter bar', async () => {
    renderDashboard();
    await waitFor(() => {
      // Filter bar should have organ type selector and search
      expect(screen.getByPlaceholderText(/Search/i)).toBeInTheDocument();
    });
  });
});
