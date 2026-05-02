/**
 * PatientForm Component Tests (PHI-touching screen)
 *
 * The PatientForm renders the full intake surface for a candidate's
 * demographics, clinical scores, and medical history. It is a
 * PHI-handling component and therefore covered by the renderer
 * coverage gate (60% lines for `src/components/patients/PatientForm.jsx`).
 *
 * These tests exercise:
 *   - Default render and section structure
 *   - Field-level change handlers (text, select, numeric, textarea)
 *   - Required-field validation and inline error rendering
 *   - Email format validation
 *   - Range validation (MELD 6-40, LAS 0-100, PRA 0-100)
 *   - Save flow (calls onSave with the assembled payload)
 *   - Cancel flow
 *   - Editing flow (renders prefilled values, button label switches to "Update Patient")
 *   - File upload handler (success path and error path)
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUploadFile = vi.fn();

vi.mock('@/api/apiClient', () => ({
  api: {
    integrations: {
      Core: {
        UploadFile: (...args) => mockUploadFile(...args),
      },
    },
  },
}));

import PatientForm from '@/components/patients/PatientForm';

function renderForm(props = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <PatientForm onSave={onSave} onCancel={onCancel} {...props} />
  );
  return { onSave, onCancel, ...utils };
}

describe('PatientForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the four section headers', () => {
    renderForm();
    expect(screen.getByText('Basic Information')).toBeInTheDocument();
    expect(screen.getByText('Waitlist Information')).toBeInTheDocument();
    expect(screen.getByText('Clinical Scores')).toBeInTheDocument();
    expect(screen.getByText('Clinical Assessment')).toBeInTheDocument();
    expect(screen.getByText('Medical Information')).toBeInTheDocument();
  });

  it('renders the Add Patient button when no patient is provided', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /Add Patient/i })).toBeInTheDocument();
  });

  it('renders the Update Patient button when editing an existing patient', () => {
    renderForm({
      patient: {
        patient_id: 'MRN-123',
        first_name: 'Existing',
        last_name: 'Patient',
        blood_type: 'A+',
        organ_needed: 'kidney',
        medical_urgency: 'medium',
        waitlist_status: 'active',
        functional_status: 'independent',
        prognosis_rating: 'good',
        support_system_rating: 'good',
      },
    });
    expect(screen.getByRole('button', { name: /Update Patient/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('MRN-123')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Patient')).toBeInTheDocument();
  });

  it('updates text fields when the user types', () => {
    renderForm();
    const patientIdInput = screen.getByLabelText(/Patient ID/i);
    fireEvent.change(patientIdInput, { target: { value: 'MRN-9999' } });
    expect(patientIdInput).toHaveValue('MRN-9999');

    const firstNameInput = screen.getByLabelText(/First Name/i);
    fireEvent.change(firstNameInput, { target: { value: 'Jane' } });
    expect(firstNameInput).toHaveValue('Jane');

    const lastNameInput = screen.getByLabelText(/Last Name/i);
    fireEvent.change(lastNameInput, { target: { value: 'Doe' } });
    expect(lastNameInput).toHaveValue('Doe');
  });

  it('blocks submit and renders inline errors for missing required fields', async () => {
    const { onSave } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Add Patient/i }));

    await waitFor(() => {
      expect(screen.getByText(/Please fix the following errors before saving/i)).toBeInTheDocument();
    });
    // Each error text appears twice (summary alert + per-field inline error).
    expect(screen.getAllByText('Patient ID is required').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('First name is required').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Last name is required').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Blood type is required').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Organ needed is required').length).toBeGreaterThanOrEqual(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('clears a field-level error when the user starts editing the field', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Add Patient/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Patient ID is required').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.change(screen.getByLabelText(/Patient ID/i), {
      target: { value: 'MRN-0001' },
    });

    await waitFor(() => {
      expect(screen.queryByText('Patient ID is required')).not.toBeInTheDocument();
    });
  });

  it('rejects an invalid email format on submit', async () => {
    const { onSave } = renderForm({
      patient: {
        patient_id: 'MRN-1',
        first_name: 'Pat',
        last_name: 'Doe',
        blood_type: 'O+',
        organ_needed: 'kidney',
        email: 'not-an-email',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update Patient/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Invalid email format').length).toBeGreaterThanOrEqual(1);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects out-of-range MELD, LAS, and PRA scores', async () => {
    const { onSave } = renderForm({
      patient: {
        patient_id: 'MRN-1',
        first_name: 'Pat',
        last_name: 'Doe',
        blood_type: 'O+',
        organ_needed: 'liver',
      },
    });

    fireEvent.change(screen.getByLabelText(/MELD Score/i), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText(/LAS Score/i), { target: { value: '101' } });
    // Use exact label "PRA %" via id to avoid matching "CPRA %" too.
    fireEvent.change(document.getElementById('pra_percentage'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Patient/i }));

    await waitFor(() => {
      expect(screen.getAllByText('MELD score must be between 6 and 40').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('LAS score must be between 0 and 100').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('PRA must be between 0 and 100').length).toBeGreaterThanOrEqual(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with the assembled payload when validation passes', async () => {
    const { onSave } = renderForm();

    fireEvent.change(screen.getByLabelText(/Patient ID/i), { target: { value: 'MRN-OK' } });
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Valid' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'User' } });

    // Blood type and organ need are Radix selects — set the underlying state via
    // the form's update path by triggering save first to surface errors, then
    // edit those required fields via the existing patient prop on a re-render.
    // To keep this test deterministic, we re-render with prefilled blood/organ.
    const { onSave: onSave2 } = renderForm({
      patient: {
        patient_id: 'MRN-OK',
        first_name: 'Valid',
        last_name: 'User',
        blood_type: 'O+',
        organ_needed: 'kidney',
        meld_score: 12,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Update Patient/i }));

    await waitFor(() => {
      expect(onSave2).toHaveBeenCalledTimes(1);
    });
    const payload = onSave2.mock.calls[0][0];
    expect(payload).toMatchObject({
      patient_id: 'MRN-OK',
      first_name: 'Valid',
      last_name: 'User',
      blood_type: 'O+',
      organ_needed: 'kidney',
    });
    // The onSave above for the initial render should still NOT have been called
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('updates numeric fields and clears errors as the user types', async () => {
    renderForm({
      patient: {
        patient_id: 'MRN-1',
        first_name: 'Num',
        last_name: 'Tester',
        blood_type: 'O+',
        organ_needed: 'kidney',
      },
    });

    const meldInput = screen.getByLabelText(/MELD Score/i);
    fireEvent.change(meldInput, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Patient/i }));

    await waitFor(() => {
      expect(screen.getAllByText('MELD score must be between 6 and 40').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.change(meldInput, { target: { value: '20' } });
    await waitFor(() => {
      expect(screen.queryByText('MELD score must be between 6 and 40')).not.toBeInTheDocument();
    });
  });

  it('handles a successful file upload', async () => {
    mockUploadFile
      .mockResolvedValueOnce({ file_url: 'https://files.local/a.pdf' })
      .mockResolvedValueOnce({ file_url: 'https://files.local/b.pdf' });

    renderForm();
    const file1 = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const file2 = new File(['y'], 'b.pdf', { type: 'application/pdf' });
    const fileInput = document.getElementById('file-upload');
    fireEvent.change(fileInput, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByText(/2 document\(s\) attached/i)).toBeInTheDocument();
    });
  });

  it('handles a failing file upload without crashing', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUploadFile.mockRejectedValueOnce(new Error('upload failed'));

    renderForm();
    const file = new File(['x'], 'fail.pdf', { type: 'application/pdf' });
    const fileInput = document.getElementById('file-upload');
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledTimes(1);
    });
    // The button should re-enable (uploading false) — the label returns to "Upload Documents"
    await waitFor(() => {
      expect(screen.getByText(/Upload Documents/i)).toBeInTheDocument();
    });
    consoleErrorSpy.mockRestore();
  });

  it('renders date and clinical-assessment numeric inputs', () => {
    renderForm();
    expect(screen.getByLabelText(/Date of Birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Date Added to Waitlist/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Last Evaluation Date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Comorbidity Score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Compliance Score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Previous Transplants/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Weight \(kg\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Height \(cm\)/i)).toBeInTheDocument();
  });

  it('updates the Diagnosis textarea', () => {
    renderForm();
    const diagnosisInput = screen.getByLabelText(/Primary Diagnosis/i);
    fireEvent.change(diagnosisInput, { target: { value: 'End-stage renal disease' } });
    expect(diagnosisInput).toHaveValue('End-stage renal disease');
  });
});
