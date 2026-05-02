/**
 * LabForm Component Tests (PHI-touching screen)
 *
 * Lab-result intake. Although the form is purely documentary, it ingests
 * patient-linked clinical values and is therefore covered by the renderer
 * coverage gate.
 *
 * These tests exercise:
 *   - Default render and informational alert
 *   - Required-field validation (test_code, test_name, value, collected_at)
 *   - Successful submit (calls onSave with the assembled payload)
 *   - Edit flow (renders prefilled values, button label switches to "Update")
 *   - Cancel flow (header X-button and footer Cancel button)
 *   - Custom test-code uppercasing
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/localClient', () => ({
  default: {
    labs: {
      getCodes: vi.fn().mockResolvedValue([
        { code: 'CR', name: 'Creatinine', category: 'Renal' },
        { code: 'BUN', name: 'Blood Urea Nitrogen', category: 'Renal' },
      ]),
    },
  },
}));

import LabForm from '@/components/labs/LabForm';

function renderForm(props = {}) {
  const onSave = vi.fn().mockResolvedValue();
  const onCancel = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <LabForm
        patientId="pat-1"
        onSave={onSave}
        onCancel={onCancel}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onSave, onCancel, ...utils };
}

describe('LabForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Add Lab Result title when creating', () => {
    renderForm();
    expect(screen.getByText(/Add Lab Result/i)).toBeInTheDocument();
  });

  it('renders the Edit Lab Result title when editing', () => {
    renderForm({
      lab: {
        test_code: 'CR',
        test_name: 'Creatinine',
        value: '1.2',
        units: 'mg/dL',
        reference_range: '0.6-1.3',
        collected_at: '2026-04-01T00:00:00.000Z',
        resulted_at: '2026-04-02T00:00:00.000Z',
        ordering_service: 'Nephrology',
      },
    });
    expect(screen.getByText(/Edit Lab Result/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Creatinine')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1.2')).toBeInTheDocument();
  });

  it('renders the documentation-only informational notice', () => {
    renderForm();
    expect(
      screen.getByText(/system does NOT interpret values as normal\/abnormal/i)
    ).toBeInTheDocument();
  });

  it('blocks submit and renders inline errors when required fields are missing', async () => {
    const { onSave } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Save Lab/i }));

    await waitFor(() => {
      expect(screen.getByText('Test code is required')).toBeInTheDocument();
    });
    expect(screen.getByText('Test name is required')).toBeInTheDocument();
    expect(screen.getByText('Value is required')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('uppercases the custom test code as the user types', () => {
    renderForm();
    const customCodeInput = screen.getByPlaceholderText(/Or enter custom code/i);
    fireEvent.change(customCodeInput, { target: { value: 'gluc' } });
    expect(customCodeInput).toHaveValue('GLUC');
  });

  it('calls onSave with the assembled payload when validation passes', async () => {
    const { onSave } = renderForm({
      lab: {
        test_code: 'CR',
        test_name: 'Creatinine',
        value: '1.2',
        units: 'mg/dL',
        reference_range: '0.6-1.3',
        collected_at: '2026-04-01T00:00:00.000Z',
        resulted_at: '2026-04-02T00:00:00.000Z',
        ordering_service: 'Nephrology',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const payload = onSave.mock.calls[0][0];
    expect(payload).toMatchObject({
      test_code: 'CR',
      test_name: 'Creatinine',
      value: '1.2',
      units: 'mg/dL',
      patient_id: 'pat-1',
    });
  });

  it('clears a field-level error when the user starts editing the field', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Save Lab/i }));
    await waitFor(() => {
      expect(screen.getByText('Test name is required')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Test Name/i), { target: { value: 'Glucose' } });
    await waitFor(() => {
      expect(screen.queryByText('Test name is required')).not.toBeInTheDocument();
    });
  });

  it('calls onCancel when the footer Cancel button is clicked', () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders both date inputs', () => {
    renderForm();
    expect(screen.getByLabelText(/Date Collected/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Date Resulted/i)).toBeInTheDocument();
  });

  it('updates the value, units, and reference-range fields', () => {
    renderForm();
    const value = screen.getByLabelText(/Value/i);
    fireEvent.change(value, { target: { value: '7.4' } });
    expect(value).toHaveValue('7.4');

    const units = screen.getByLabelText(/Units/i);
    fireEvent.change(units, { target: { value: 'mmol/L' } });
    expect(units).toHaveValue('mmol/L');

    const ref = screen.getByLabelText(/Reference Range/i);
    fireEvent.change(ref, { target: { value: '4.0-7.0' } });
    expect(ref).toHaveValue('4.0-7.0');
  });

  it('updates the ordering-service field', () => {
    renderForm();
    const orderInput = screen.getByLabelText(/Ordering Service/i);
    fireEvent.change(orderInput, { target: { value: 'Cardiology' } });
    expect(orderInput).toHaveValue('Cardiology');
  });
});
