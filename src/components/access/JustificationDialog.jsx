import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Shield } from 'lucide-react';

const PREDEFINED_REASONS = [
  'Direct patient care',
  'Care coordination',
  'Clinical review',
  'Quality assurance audit',
  'Regulatory compliance review',
  'Emergency access',
];

/**
 * HIPAA access justification gate.
 *
 * Important: Confirm must NOT go through Dialog onOpenChange(false)→onCancel.
 * After confirm the parent unmounts this dialog, which can fire onOpenChange(false);
 * treating that as cancel was sending users back to Risk Intel.
 */
export default function JustificationDialog({ open, onConfirm, onCancel, entityType }) {
  const [justification, setJustification] = useState('');
  const outcomeRef = useRef(null); // 'confirmed' | 'cancelled' | null

  const finishConfirm = () => {
    const reason = justification.trim();
    if (!reason || outcomeRef.current) return;
    outcomeRef.current = 'confirmed';
    setJustification('');
    onConfirm(reason);
  };

  const finishCancel = () => {
    if (outcomeRef.current) return;
    outcomeRef.current = 'cancelled';
    setJustification('');
    onCancel?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          outcomeRef.current = null;
          return;
        }
        // Closed by overlay / Escape / built-in X — not by Confirm.
        if (outcomeRef.current === 'confirmed') return;
        finishCancel();
      }}
    >
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          finishCancel();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-600" />
            Access Justification Required
          </DialogTitle>
          <DialogDescription>
            Accessing {entityType || 'patient'} records requires a documented reason per HIPAA policy.
            This will be recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label htmlFor="justification-reason">Select or describe your reason</Label>
          <div className="flex flex-wrap gap-2">
            {PREDEFINED_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setJustification(reason)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  justification === reason
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          <textarea
            id="justification-reason"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Or type a custom justification..."
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm resize-none h-20 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={finishCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={finishConfirm}
            disabled={!justification.trim()}
          >
            Confirm Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
