/**
 * PatientDetails Page Component Tests
 *
 * Validates the patient detail view:
 * - Loading state
 * - Patient information display
 * - Patient not found state
 * - Back navigation link
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockPatientList = vi.fn();

vi.mock('@/api/apiClient', () => ({
  api: {
    entities: {
      Patient: {
        list: (...args) => mockPatientList(...args),
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

vi.mock('@/components/barriers', () => ({
  ReadinessBarrierList: () => <div data-testid="barriers">Barriers</div>,
}));

vi.mock('@/components/ahhq', () => ({
  AHHQPanel: () => <div data-testid="ahhq">aHHQ</div>,
}));

vi.mock('@/components/labs', () => ({
  LabsPanel: () => <div data-testid="labs">Labs</div>,
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

describe('PatientDetails Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    mockPatientList.mockResolvedValue([]);
    renderPatientDetails();
    expect(screen.getByText(/Loading patient details/i)).toBeInTheDocument();
  });

  it('displays patient name after loading', async () => {
    mockPatientList.mockResolvedValue([
      {
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
      },
    ]);
    renderPatientDetails();
    await waitFor(() => {
      expect(screen.getByText(/Alice/i)).toBeInTheDocument();
      expect(screen.getByText(/Johnson/i)).toBeInTheDocument();
    });
  });

  it('displays patient MRN', async () => {
    mockPatientList.mockResolvedValue([
      {
        id: 'pat-1',
        patient_id: 'MRN-001',
        first_name: 'Alice',
        last_name: 'Johnson',
        blood_type: 'O+',
        organ_needed: 'kidney',
        waitlist_status: 'active',
        priority_score: 78,
      },
    ]);
    renderPatientDetails();
    await waitFor(() => {
      expect(screen.getByText(/MRN-001/i)).toBeInTheDocument();
    });
  });

  it('shows back navigation link', async () => {
    mockPatientList.mockResolvedValue([
      {
        id: 'pat-1',
        patient_id: 'MRN-001',
        first_name: 'Alice',
        last_name: 'Johnson',
        blood_type: 'O+',
        organ_needed: 'kidney',
        waitlist_status: 'active',
      },
    ]);
    renderPatientDetails();
    await waitFor(() => {
      // Back navigation is an icon-only button inside a link to "/"
      const backLink = screen.getByRole('link');
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/');
    });
  });

  it('shows patient not found for invalid id', async () => {
    mockPatientList.mockResolvedValue([]);
    renderPatientDetails('nonexistent');
    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument();
    });
  });
});
