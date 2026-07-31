import { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Shield } from 'lucide-react';

export default function JustificationDialog({ open, onConfirm, onCancel, entityType, action }) {
  const [justification, setJustification] = useState('');

  const predefinedReasons = [
    'Direct patient care',
    'Care coordination',
    'Clinical review',
    'Quality assurance audit',
    'Regulatory compliance review',
    'Emergency access',
  ];

  // Radix closes the dialog itself when either footer button is pressed, so the
  // resulting onOpenChange(false) cannot be read as "the user cancelled" — that
  // fired onCancel on the confirm path too, cancelling the access request that
  // was still in flight. This records which button caused the close.
  const confirmedRef = useRef(false);

  const handleSubmit = () => {
    if (!justification.trim()) return;
    confirmedRef.current = true;
    onConfirm(justification.trim());
    setJustification('');
  };

  // Single cancel path: every close that was not a confirm routes through here,
  // whether it came from the Cancel button, Escape, or the overlay. The Cancel
  // button deliberately carries no onClick of its own, so cancelling fires
  // exactly one onCancel rather than two.
  const handleOpenChange = (isOpen) => {
    if (isOpen) {
      confirmedRef.current = false;
      return;
    }
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    onCancel();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-600" />
            Access Justification Required
          </AlertDialogTitle>
          <AlertDialogDescription>
            Accessing {entityType || 'patient'} records requires a documented reason per HIPAA policy. 
            This will be recorded in the audit log.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          <Label htmlFor="justification-reason">Select or describe your reason</Label>
          <div className="flex flex-wrap gap-2">
            {predefinedReasons.map((reason) => (
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

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleSubmit} disabled={!justification.trim()}>
            Confirm Access
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
