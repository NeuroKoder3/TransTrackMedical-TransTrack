/**
 * Patients Page Component Tests
 *
 * Validates the patient management list view:
 * - Renders the page heading
 * - Shows Add Patient button
 * - Shows empty state when no patients
 * - Displays patients in a table
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

const mockPatientList = vi.fn();
const mockMe = vi.fn();

vi.mock('@/api/apiClient', () => ({
  api: {
    entities: {
      Patient: {
        list: (...args) => mockPatientList(...args),
        create: vi.fn().mockResolvedValue({ id: 'p-new' }),
        update: vi.fn().mockResolvedValue({ id: 'p1' }),
        delete: vi.fn().mockResolvedValue({ success: true }),
      },
      AuditLog: {
        create: vi.fn().mockResolvedValue({ id: 'a1' }),
      },
    },
    auth: {
      me: (...args) => mockMe(...args),
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ success: true }),
    },
  },
}));

import Patients from '@/pages/Patients';

function renderPatients() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <Patients />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('Patients Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMe.mockResolvedValue({ id: 'u1', email: 'admin@test.com', role: 'admin' });
  });

  it('renders the page heading', async () => {
    mockPatientList.mockResolvedValue([]);
    renderPatients();
    await waitFor(() => {
      expect(screen.getByText('Patient Management')).toBeInTheDocument();
    });
  });

  it('renders the subheading', async () => {
    mockPatientList.mockResolvedValue([]);
    renderPatients();
    await waitFor(() => {
      expect(screen.getByText(/Add and manage patient records/i)).toBeInTheDocument();
    });
  });

  it('renders Add Patient button', async () => {
    mockPatientList.mockResolvedValue([]);
    renderPatients();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Patient/i })).toBeInTheDocument();
    });
  });

  it('shows empty state when no patients exist', async () => {
    mockPatientList.mockResolvedValue([]);
    renderPatients();
    await waitFor(() => {
      expect(screen.getByText(/No patients yet/i)).toBeInTheDocument();
    });
  });

  it('displays patient data in a table after loading', async () => {
    mockPatientList.mockResolvedValue([
      {
        id: 'p1',
        patient_id: 'MRN-001',
        first_name: 'Alice',
        last_name: 'Smith',
        blood_type: 'B+',
        organ_needed: 'liver',
        waitlist_status: 'active',
        priority_score: 65,
      },
    ]);
    renderPatients();
    await waitFor(() => {
      // The name is rendered as "{first_name} {last_name}" inside one div
      expect(screen.getByText(/Alice/i)).toBeInTheDocument();
      expect(screen.getByText(/MRN-001/i)).toBeInTheDocument();
      expect(screen.getByText('B+')).toBeInTheDocument();
    });
  });
});
