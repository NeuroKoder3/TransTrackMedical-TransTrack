import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JustificationDialog from '@/components/access/JustificationDialog';

describe('JustificationDialog', () => {
  it('calls onConfirm and does not call onCancel when confirming', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <JustificationDialog
        open
        onConfirm={onConfirm}
        onCancel={onCancel}
        entityType="patient"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Direct patient care' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Access' }));

    expect(onConfirm).toHaveBeenCalledWith('Direct patient care');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <JustificationDialog
        open
        onConfirm={onConfirm}
        onCancel={onCancel}
        entityType="patient"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
