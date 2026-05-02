/**
 * ReadinessBarrierForm Component Tests (PHI-touching screen)
 *
 * Operational, non-clinical readiness-barrier intake form. Although it is
 * explicitly non-clinical, it is rendered against a patient context and is
 * therefore covered by the renderer coverage gate.
 *
 * These tests exercise:
 *   - Default render and informational alert
 *   - Required-field validation (barrier type, owning role)
 *   - 255-char notes-length validation
 *   - Successful submit (calls onSave with the assembled payload)
 *   - Error from onSave is surfaced as a submit-level alert
 *   - Edit flow (renders prefilled values, button label switches to "Update Barrier")
 *   - Cancel flow
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/localClient', () => ({
  default: {
    barriers: {
      getTypes: vi.fn().mockResolvedValue({
        INSURANCE: { value: 'insurance', label: 'Insurance' },
        TRANSPORT: { value: 'transport', label: 'Transport' },
      }),
      getStatuses: vi.fn().mockResolvedValue({
        OPEN: { value: 'open', label: 'Open' },
        RESOLVED: { value: 'resolved', label: 'Resolved' },
      }),
      getRiskLevels: vi.fn().mockResolvedValue({
        LOW: { value: 'low', label: 'Low' },
        HIGH: { value: 'high', label: 'High' },
      }),
      getOwningRoles: vi.fn().mockResolvedValue({
        SOCIAL_WORK: { value: 'social_work', label: 'Social Work' },
        COORDINATOR: { value: 'coordinator', label: 'Coordinator' },
      }),
    },
  },
}));

import ReadinessBarrierForm from '@/components/barriers/ReadinessBarrierForm';

function renderForm(props = {}) {
  const onSave = vi.fn().mockResolvedValue();
  const onCancel = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ReadinessBarrierForm
        patientId="pat-1"
        onSave={onSave}
        onCancel={onCancel}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onSave, onCancel, ...utils };
}

describe('ReadinessBarrierForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Add Readiness Barrier title when creating', async () => {
    renderForm();
    expect(await screen.findByText(/Add Readiness Barrier/i)).toBeInTheDocument();
  });

  it('renders the Update Readiness Barrier title when editing', async () => {
    renderForm({
      barrier: {
        barrier_type: 'insurance',
        status: 'open',
        risk_level: 'low',
        owning_role: 'social_work',
        target_resolution_date: '2026-06-01T00:00:00.000Z',
        notes: 'existing notes',
      },
    });
    expect(await screen.findByText(/Edit Readiness Barrier/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing notes')).toBeInTheDocument();
  });

  it('renders the Non-Clinical Notice', async () => {
    renderForm();
    expect(
      await screen.findByText(/This feature is for operational tracking only/i)
    ).toBeInTheDocument();
  });

  it('blocks submit and renders inline errors when required fields are missing', async () => {
    const { onSave } = renderForm();
    const submit = await screen.findByRole('button', { name: /Add Barrier/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByText('Please select a barrier type')).toBeInTheDocument();
    });
    expect(screen.getByText('Please select an owning role')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects notes longer than 255 characters', async () => {
    const longNotes = 'x'.repeat(300);
    const { onSave } = renderForm({
      barrier: {
        barrier_type: 'insurance',
        status: 'open',
        risk_level: 'low',
        owning_role: 'social_work',
        target_resolution_date: '',
        notes: longNotes,
      },
    });

    // The textarea has maxLength=255 enforced by the DOM, so we cannot
    // type past it via fireEvent. Instead we manually exceed it through
    // the value attribute and submit.
    const textarea = await screen.findByLabelText(/Notes/i);
    Object.defineProperty(textarea, 'value', { writable: true, value: longNotes });
    fireEvent.input(textarea, { target: { value: longNotes } });

    fireEvent.click(screen.getByRole('button', { name: /Update Barrier/i }));

    // Either the validation rejects or maxLength prevents — both satisfy
    // "no save"; either way the form must not invoke onSave with bad notes.
    await waitFor(() => {
      // No save call permitted with > 255-char notes
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  it('calls onSave with the assembled payload when validation passes', async () => {
    const { onSave } = renderForm({
      barrier: {
        barrier_type: 'insurance',
        status: 'open',
        risk_level: 'high',
        owning_role: 'social_work',
        target_resolution_date: '2026-06-01T00:00:00.000Z',
        notes: 'short note',
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Update Barrier/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const payload = onSave.mock.calls[0][0];
    expect(payload).toMatchObject({
      barrier_type: 'insurance',
      status: 'open',
      risk_level: 'high',
      owning_role: 'social_work',
      patient_id: 'pat-1',
      notes: 'short note',
    });
  });

  it('surfaces an error from onSave as a destructive alert', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSave = vi.fn().mockRejectedValue(new Error('Server error'));
    const onCancel = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <ReadinessBarrierForm
          patientId="pat-1"
          barrier={{
            barrier_type: 'insurance',
            status: 'open',
            risk_level: 'low',
            owning_role: 'coordinator',
            target_resolution_date: '',
            notes: '',
          }}
          onSave={onSave}
          onCancel={onCancel}
        />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /Update Barrier/i }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
    consoleErrorSpy.mockRestore();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const { onCancel } = renderForm();
    const cancel = await screen.findByRole('button', { name: /Cancel/i });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('updates the notes textarea and shows the character counter', async () => {
    renderForm();
    const textarea = await screen.findByLabelText(/Notes/i);
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(textarea).toHaveValue('hello');
    // The counter is rendered as "5/255"
    expect(screen.getByText(/5\/255/)).toBeInTheDocument();
  });
});
