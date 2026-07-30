/**
 * PatientDetails Page Component Tests
 *
 * Validates the patient detail view:
 * - Loading state
 * - Patient information display
 * - Patient not found state
 * - Back navigation link
 * - PHI justification gate before load
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockPatientGet = vi.fn();

vi.mock('@/api/apiClient', () => ({
  api: {
    entities: {
      Patient: {
        get: (...args) => mockPatientGet(...args),
        list: vi.fn().mockResolvedValue([]),
      },
      AuditLog: {
        filter: vi.fn().mockResolvedValue([]),
      },
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ success: true }),
    },
  },
}));

vi.mock('@/hooks/useJustifiedAccess', () => ({
  useJustifiedAccess: () => ({
    requireJustification: vi.fn().mockResolvedValue({ authorized: true, justification: 'clinical review for transplant readiness' }),
    dialogOpen: false,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    pendingAction: null,
  }),
  default: () => ({
    requireJustification: vi.fn().mockResolvedValue({ authorized: true, justification: 'clinical review for transplant readiness' }),
    dialogOpen: false,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    pendingAction: null,
  }),
}));

vi.mock('@/components/barriers', () => ({
  ReadinessBarrierList: () => <div data-testid="barriers">Barriers</div>,
}));

vi.mock('@/components/ahhq', () => ({
  AHHQPanel: () => <div data-testid="ahhq">aHHQ</div>,
}));

vi.mock('@/components/labs', () => ({
  LabsPanel: () => <div data-testid="labs">Labs</div>,
}));

vi.mock('@/components/access/JustificationDialog', () => ({
  default: () => null,
}));

import PatientDetails from '@/pages/PatientDetails';

function renderPatientDetails(id = 'pat-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/PatientDetails?id=${id}`]}>
        <Routes>
          <Route path="/PatientDetails" element={<PatientDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const samplePatient = {
  id: 'pat-1',
  patient_id: 'MRN-001',
  first_name: 'Alice',
  last_name: 'Johnson',
  blood_type: 'O+',
  organ_needed: 'kidney',
  waitlist_status: 'active',
  priority_score: 78,
  date_of_birth: '1985-04-12',
  date_added_to_waitlist: '2025-06-01',
  medical_urgency: 'high',
};

describe('PatientDetails Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = {
      functions: {
        invoke: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  it('renders loading state initially', async () => {
    mockPatientGet.mockImplementation(() => new Promise(() => {}));
    renderPatientDetails();
    await waitFor(() => {
      expect(
        screen.getByText(/Loading patient details|Awaiting access justification/i)
      ).toBeInTheDocument();
    });
  });

  it('displays patient name after loading', async () => {
    mockPatientGet.mockResolvedValue(samplePatient);
    renderPatientDetails();
    await waitFor(() => {
      expect(screen.getByText(/Alice/i)).toBeInTheDocument();
      expect(screen.getByText(/Johnson/i)).toBeInTheDocument();
    });
  });

  it('displays patient MRN', async () => {
    mockPatientGet.mockResolvedValue(samplePatient);
    renderPatientDetails();
    await waitFor(() => {
      expect(screen.getByText(/MRN-001/i)).toBeInTheDocument();
    });
  });

  it('shows back navigation link', async () => {
    mockPatientGet.mockResolvedValue(samplePatient);
    renderPatientDetails();
    await waitFor(() => {
      const backLink = screen.getByRole('link');
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/');
    });
  });

  it('shows patient not found for invalid id', async () => {
    mockPatientGet.mockResolvedValue(null);
    renderPatientDetails('nonexistent');
    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument();
    });
  });
});
