import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/apiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  Heart, Plus, RefreshCw, Loader2, Clock, CheckCircle2, XCircle, Eye,
  AlertTriangle, ArrowRight, ListChecks
} from 'lucide-react';

const STATUS_BADGE = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  ACCEPTED_PROVISIONAL: 'bg-blue-100 text-blue-800 border-blue-200',
  ACCEPTED_FINAL: 'bg-green-100 text-green-800 border-green-200',
  DECLINED: 'bg-slate-100 text-slate-700 border-slate-200',
  EXPIRED: 'bg-red-100 text-red-800 border-red-200',
  RESCINDED: 'bg-purple-100 text-purple-800 border-purple-200',
};

const ALLOWED_TRANSITIONS = {
  PENDING: ['ACCEPTED_PROVISIONAL', 'ACCEPTED_FINAL', 'DECLINED', 'RESCINDED'],
  ACCEPTED_PROVISIONAL: ['ACCEPTED_FINAL', 'DECLINED', 'RESCINDED'],
  ACCEPTED_FINAL: [],
  DECLINED: [],
  EXPIRED: [],
  RESCINDED: [],
};

function StatusBadge({ status }) {
  return <Badge variant="outline" className={STATUS_BADGE[status] || ''}>{status}</Badge>;
}

function CreateOfferDialog({ patients, donors, onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    donor_organ_id: '', patient_id: '', rank: '', response_due_at: '',
    backup_chain_position: '', notes: '',
  });

  const mutation = useMutation({
    mutationFn: () => api.organOffers.create({
      donor_organ_id: form.donor_organ_id,
      patient_id: form.patient_id,
      rank: form.rank ? Number(form.rank) : undefined,
      response_due_at: form.response_due_at || undefined,
      backup_chain_position: form.backup_chain_position ? Number(form.backup_chain_position) : undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: (offer) => {
      toast({ title: 'Offer created', description: `Status: ${offer.status}` });
      setOpen(false);
      setForm({ donor_organ_id: '', patient_id: '', rank: '', response_due_at: '', backup_chain_position: '', notes: '' });
      onCreated?.();
    },
    onError: (e) => toast({ title: 'Could not create offer', description: e.message, variant: 'destructive' }),
  });

  const canSubmit = form.donor_organ_id && form.patient_id;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" /> New Offer</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record an organ offer</DialogTitle>
          <DialogDescription>
            Allocation occurs in OPTN/UNet. This records the operational coordination of an offer received by your center.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Donor organ</Label>
            <Select value={form.donor_organ_id} onValueChange={(v) => setForm((f) => ({ ...f, donor_organ_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select donor organ" /></SelectTrigger>
              <SelectContent>
                {donors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.donor_id || d.id.slice(0, 8)} · {d.organ_type || 'organ?'} · {d.blood_type || 'BT?'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Recipient (waitlist patient)</Label>
            <Select value={form.patient_id} onValueChange={(v) => setForm((f) => ({ ...f, patient_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.last_name}, {p.first_name} · MRN {p.patient_id || '—'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Rank</Label>
              <Input type="number" min="1" value={form.rank} onChange={(e) => setForm((f) => ({ ...f, rank: e.target.value }))} />
            </div>
            <div>
              <Label>Backup position</Label>
              <Input type="number" min="0" value={form.backup_chain_position} onChange={(e) => setForm((f) => ({ ...f, backup_chain_position: e.target.value }))} />
            </div>
            <div>
              <Label>Response due</Label>
              <Input type="datetime-local" value={form.response_due_at} onChange={(e) => setForm((f) => ({ ...f, response_due_at: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Create offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransitionDialog({ offer, declineReasons, onTransitioned }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [toStatus, setToStatus] = useState('');
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');

  const allowed = ALLOWED_TRANSITIONS[offer.status] || [];

  const mutation = useMutation({
    mutationFn: () => api.organOffers.transition({
      id: offer.id,
      to_status: toStatus,
      decline_reason_code: toStatus === 'DECLINED' ? code : undefined,
      decline_reason_text: toStatus === 'DECLINED' && (code === '799' || text) ? text : undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      toast({ title: 'Offer updated', description: `Now ${toStatus}` });
      setOpen(false); setToStatus(''); setCode(''); setText(''); setNotes('');
      onTransitioned?.();
    },
    onError: (e) => toast({ title: 'Transition failed', description: e.message, variant: 'destructive' }),
  });

  if (allowed.length === 0) return null;
  const needReasonCode = toStatus === 'DECLINED';
  const needReasonText = needReasonCode && code === '799';
  const canSubmit = toStatus && (!needReasonCode || code) && (!needReasonText || text);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><ArrowRight className="w-3 h-3 mr-1" /> Transition</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transition offer</DialogTitle>
          <DialogDescription>Current status: <StatusBadge status={offer.status} /></DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>New status</Label>
            <Select value={toStatus} onValueChange={setToStatus}>
              <SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger>
              <SelectContent>
                {allowed.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {needReasonCode && (
            <div>
              <Label>Decline reason code</Label>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger><SelectValue placeholder="Choose reason code" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(declineReasons || {}).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{k} — {v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {needReasonText && (
            <div>
              <Label>Reason (free text, required for "Other")</Label>
              <Textarea value={text} rows={2} onChange={(e) => setText(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save transition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventsDialog({ offer }) {
  const [open, setOpen] = useState(false);
  const { data: events, isLoading } = useQuery({
    queryKey: ['offer-events', offer.id],
    queryFn: () => api.organOffers.getEvents(offer.id),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Eye className="w-3 h-3 mr-1" /> History</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Offer history</DialogTitle>
          <DialogDescription>Append-only audit trail for offer {offer.id.slice(0, 8)}…</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>From → To</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Payload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(events || []).map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs">{ev.created_at}</TableCell>
                    <TableCell className="text-xs">{ev.event_type}</TableCell>
                    <TableCell className="text-xs">{ev.from_status || '—'} → {ev.to_status || '—'}</TableCell>
                    <TableCell className="text-xs">{ev.actor || 'system'}</TableCell>
                    <TableCell className="text-xs font-mono whitespace-pre-wrap break-all max-w-xs">{ev.payload || ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function OrganOffers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: offers = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['organ-offers', statusFilter],
    queryFn: () => api.organOffers.list(statusFilter === 'all' ? {} : { status: statusFilter }),
    refetchInterval: 60000,
  });

  const { data: declineReasons } = useQuery({
    queryKey: ['offer-decline-reasons'],
    queryFn: () => api.organOffers.getDeclineReasons(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-for-offers'],
    queryFn: () => api.entities.Patient.list('-created_at', 500),
  });

  const { data: donors = [] } = useQuery({
    queryKey: ['donors-for-offers'],
    queryFn: () => api.entities.DonorOrgan.list('-created_at', 500),
  });

  const expireMutation = useMutation({
    mutationFn: () => api.organOffers.expireDue(),
    onSuccess: (data) => {
      toast({ title: 'Expiration sweep complete', description: `${data.expiredCount || 0} offer(s) marked EXPIRED.` });
      queryClient.invalidateQueries({ queryKey: ['organ-offers'] });
    },
    onError: (e) => toast({ title: 'Sweep failed', description: e.message, variant: 'destructive' }),
  });

  const counts = useMemo(() => {
    const by = {};
    for (const o of offers) by[o.status] = (by[o.status] || 0) + 1;
    return by;
  }, [offers]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['organ-offers'] });
    refetch();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Heart className="w-7 h-7 text-cyan-700" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Organ Offers</h1>
            <p className="text-slate-600 text-sm">
              Operational state machine for offers received by the center. Allocation remains in OPTN/UNet.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => expireMutation.mutate()} disabled={expireMutation.isPending}>
            {expireMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Clock className="w-4 h-4 mr-2" />}
            Expire due
          </Button>
          <Button variant="outline" onClick={refresh}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
          <CreateOfferDialog patients={patients} donors={donors} onCreated={refresh} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        {Object.keys(STATUS_BADGE).map((s) => (
          <Card key={s}>
            <CardContent className="p-3 flex items-center justify-between">
              <span className="text-xs uppercase text-slate-500">{s.replace(/_/g, ' ')}</span>
              <span className="text-lg font-semibold">{counts[s] || 0}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5" /> Offers</CardTitle>
            <CardDescription>Sortable by offered_at descending; max 200 records per filter.</CardDescription>
          </div>
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="PENDING">Pending</TabsTrigger>
              <TabsTrigger value="ACCEPTED_PROVISIONAL">Provisional</TabsTrigger>
              <TabsTrigger value="ACCEPTED_FINAL">Final</TabsTrigger>
              <TabsTrigger value="DECLINED">Declined</TabsTrigger>
              <TabsTrigger value="EXPIRED">Expired</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {isError && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading offers…</div>
          ) : offers.length === 0 ? (
            <div className="text-center text-slate-500 py-12">
              <Heart className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              No offers yet for this filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Donor organ</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Rank</TableHead>
                  <TableHead>Offered</TableHead>
                  <TableHead>Response due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className="font-mono text-xs">{o.donor_organ_id?.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">{o.patient_id?.slice(0, 8)}</TableCell>
                    <TableCell>{o.rank ?? '—'}</TableCell>
                    <TableCell className="text-xs">{o.offered_at}</TableCell>
                    <TableCell className="text-xs">{o.response_due_at || '—'}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <EventsDialog offer={o} />
                      <TransitionDialog offer={o} declineReasons={declineReasons} onTransitioned={refresh} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-600" /> Final acceptance</span>
        <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-600" /> Pending response</span>
        <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-600" /> Expired / declined</span>
      </div>
    </div>
  );
}
