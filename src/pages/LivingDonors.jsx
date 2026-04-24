import React, { useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  Users, Plus, Loader2, ArrowRight, ClipboardList, Calendar, RefreshCw, Eye, ChevronLeft
} from 'lucide-react';

const STATUS_BADGE = {
  INQUIRY: 'bg-slate-100 text-slate-700 border-slate-200',
  SCREENING: 'bg-blue-100 text-blue-700 border-blue-200',
  EVALUATION: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  APPROVED: 'bg-green-100 text-green-700 border-green-200',
  DEFERRED: 'bg-amber-100 text-amber-700 border-amber-200',
  DECLINED: 'bg-red-100 text-red-700 border-red-200',
  DONATED: 'bg-emerald-200 text-emerald-900 border-emerald-300',
  WITHDRAWN: 'bg-purple-100 text-purple-700 border-purple-200',
};

const TRANSITIONS = {
  INQUIRY: ['SCREENING', 'WITHDRAWN', 'DECLINED'],
  SCREENING: ['EVALUATION', 'DEFERRED', 'DECLINED', 'WITHDRAWN'],
  EVALUATION: ['APPROVED', 'DEFERRED', 'DECLINED', 'WITHDRAWN'],
  APPROVED: ['DONATED', 'DEFERRED', 'WITHDRAWN'],
  DEFERRED: ['SCREENING', 'EVALUATION', 'DECLINED', 'WITHDRAWN'],
  DECLINED: [],
  DONATED: [],
  WITHDRAWN: [],
};

const ORGANS = ['kidney', 'liver-segment', 'lung-lobe', 'pancreas-segment', 'intestine-segment'];
const RELATIONSHIPS = ['biological-relative', 'spouse-partner', 'unrelated-directed', 'paired-exchange', 'altruistic'];

function StatusBadge({ status }) {
  return <Badge variant="outline" className={STATUS_BADGE[status] || ''}>{status}</Badge>;
}

function CreateDonorDialog({ onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    mrn: '', first_name: '', last_name: '', date_of_birth: '', sex: '', blood_type: '',
    relationship_to_recipient: '', recipient_patient_id: '', intended_organ: '',
    phone: '', email: '', address: '', notes: '',
  });

  const { data: patients = [] } = useQuery({ queryKey: ['patients-rec'], queryFn: () => api.entities.Patient.list('-created_at', 500) });

  const m = useMutation({
    mutationFn: () => api.livingDonor.create(form),
    onSuccess: () => {
      toast({ title: 'Living donor created' });
      setOpen(false);
      setForm({ mrn: '', first_name: '', last_name: '', date_of_birth: '', sex: '', blood_type: '',
        relationship_to_recipient: '', recipient_patient_id: '', intended_organ: '',
        phone: '', email: '', address: '', notes: '' });
      onCreated?.();
    },
    onError: (e) => toast({ title: 'Could not create donor', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> New Living Donor</Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add living donor candidate</DialogTitle>
          <DialogDescription>Begins in INQUIRY status. OPTN Policy 14 follow-ups are auto-created at donation.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>First name *</Label><Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} /></div>
          <div><Label>Last name *</Label><Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} /></div>
          <div><Label>MRN</Label><Input value={form.mrn} onChange={(e) => setForm((f) => ({ ...f, mrn: e.target.value }))} /></div>
          <div><Label>Date of birth</Label><Input type="date" value={form.date_of_birth} onChange={(e) => setForm((f) => ({ ...f, date_of_birth: e.target.value }))} /></div>
          <div>
            <Label>Sex</Label>
            <Select value={form.sex} onValueChange={(v) => setForm((f) => ({ ...f, sex: v }))}>
              <SelectTrigger><SelectValue placeholder="Sex" /></SelectTrigger>
              <SelectContent>
                {['M','F','OTHER','UNKNOWN'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Blood type</Label>
            <Select value={form.blood_type} onValueChange={(v) => setForm((f) => ({ ...f, blood_type: v }))}>
              <SelectTrigger><SelectValue placeholder="ABO" /></SelectTrigger>
              <SelectContent>
                {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Intended organ *</Label>
            <Select value={form.intended_organ} onValueChange={(v) => setForm((f) => ({ ...f, intended_organ: v }))}>
              <SelectTrigger><SelectValue placeholder="Organ" /></SelectTrigger>
              <SelectContent>{ORGANS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Relationship to recipient</Label>
            <Select value={form.relationship_to_recipient} onValueChange={(v) => setForm((f) => ({ ...f, relationship_to_recipient: v }))}>
              <SelectTrigger><SelectValue placeholder="Relationship" /></SelectTrigger>
              <SelectContent>{RELATIONSHIPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Recipient (waitlist patient)</Label>
            <Select value={form.recipient_patient_id} onValueChange={(v) => setForm((f) => ({ ...f, recipient_patient_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.last_name}, {p.first_name} · MRN {p.patient_id || '—'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
          <div className="col-span-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></div>
          <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!form.first_name || !form.last_name || !form.intended_organ || m.isPending}>
            {m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransitionDialog({ donor, onTransitioned }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [toStatus, setToStatus] = useState('');
  const [reason, setReason] = useState('');
  const [donationDate, setDonationDate] = useState('');
  const allowed = TRANSITIONS[donor.status] || [];

  const m = useMutation({
    mutationFn: () => api.livingDonor.transition({
      id: donor.id, to_status: toStatus, reason: reason || undefined,
      donation_date: donationDate || undefined,
    }),
    onSuccess: () => {
      toast({ title: 'Donor status updated', description: `Now ${toStatus}` });
      setOpen(false); setToStatus(''); setReason(''); setDonationDate('');
      onTransitioned?.();
    },
    onError: (e) => toast({ title: 'Transition failed', description: e.message, variant: 'destructive' }),
  });

  if (allowed.length === 0) return null;
  const reasonRequired = ['DECLINED', 'DEFERRED', 'WITHDRAWN'].includes(toStatus);
  const dateRequired = toStatus === 'DONATED';
  const canSubmit = toStatus && (!reasonRequired || reason) && (!dateRequired || donationDate);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><ArrowRight className="w-3 h-3 mr-1" /> Transition</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update donor status</DialogTitle>
          <DialogDescription>Current: <StatusBadge status={donor.status} /></DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>New status</Label>
            <Select value={toStatus} onValueChange={setToStatus}>
              <SelectTrigger><SelectValue placeholder="Choose status" /></SelectTrigger>
              <SelectContent>{allowed.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {reasonRequired && (
            <div><Label>Reason (required)</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          )}
          {dateRequired && (
            <div><Label>Donation date (required)</Label><Input type="date" value={donationDate} onChange={(e) => setDonationDate(e.target.value)} /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!canSubmit || m.isPending}>{m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEvalDialog({ donorId, onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ step: '', scheduled_date: '', owner_role: '', notes: '' });
  const m = useMutation({
    mutationFn: () => api.livingDonor.addEvalStep({ living_donor_id: donorId, ...form }),
    onSuccess: () => { toast({ title: 'Evaluation step added' }); setOpen(false); setForm({ step: '', scheduled_date: '', owner_role: '', notes: '' }); onCreated?.(); },
    onError: (e) => toast({ title: 'Could not add step', description: e.message, variant: 'destructive' }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="w-3 h-3 mr-1" /> Add step</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add evaluation step</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Step</Label><Input value={form.step} onChange={(e) => setForm((f) => ({ ...f, step: e.target.value }))} placeholder="ABO confirmation, crossmatch, social work, …" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Scheduled date</Label><Input type="date" value={form.scheduled_date} onChange={(e) => setForm((f) => ({ ...f, scheduled_date: e.target.value }))} /></div>
            <div><Label>Owner role</Label><Input value={form.owner_role} onChange={(e) => setForm((f) => ({ ...f, owner_role: e.target.value }))} placeholder="coordinator / nephrologist" /></div>
          </div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!form.step || m.isPending}>{m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DonorDetail({ donor, onBack }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['donor-summary', donor.id] });

  const { data: summary, isLoading } = useQuery({
    queryKey: ['donor-summary', donor.id],
    queryFn: () => api.livingDonor.summary(donor.id),
  });

  const updateEvalMutation = useMutation({
    mutationFn: ({ id, status }) => api.livingDonor.updateEvalStep({ id, status, completed_date: status === 'COMPLETE' ? new Date().toISOString().slice(0, 10) : undefined }),
    onSuccess: () => { toast({ title: 'Evaluation updated' }); refresh(); },
    onError: (e) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const updateFollowupMutation = useMutation({
    mutationFn: ({ id, status }) => api.livingDonor.updateFollowup({ id, status, completed_date: status === 'COMPLETE' ? new Date().toISOString().slice(0, 10) : undefined }),
    onSuccess: () => { toast({ title: 'Follow-up updated' }); refresh(); },
    onError: (e) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const transitionRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['donor-summary', donor.id] });
    queryClient.invalidateQueries({ queryKey: ['living-donors'] });
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> Back to list</Button>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{donor.last_name}, {donor.first_name}</CardTitle>
            <CardDescription>
              MRN {donor.mrn || '—'} · DOB {donor.date_of_birth || '—'} · {donor.sex || '—'} · {donor.blood_type || '—'} · {donor.intended_organ}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={donor.status} />
            <TransitionDialog donor={donor} onTransitioned={transitionRefresh} />
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading donor detail…</div>
      ) : summary && (
        <Tabs defaultValue="evals">
          <TabsList>
            <TabsTrigger value="evals"><ClipboardList className="w-4 h-4 mr-1" />Evaluations ({summary.evaluations.length})</TabsTrigger>
            <TabsTrigger value="follow"><Calendar className="w-4 h-4 mr-1" />Follow-ups ({summary.followups.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="evals" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Evaluation steps</CardTitle>
                <AddEvalDialog donorId={donor.id} onCreated={refresh} />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Step</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead>
                    <TableHead>Completed</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Action</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {summary.evaluations.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.step}</TableCell>
                        <TableCell><Badge variant="secondary">{s.status}</Badge></TableCell>
                        <TableCell>{s.scheduled_date || '—'}</TableCell>
                        <TableCell>{s.completed_date || '—'}</TableCell>
                        <TableCell>{s.owner_role || '—'}</TableCell>
                        <TableCell className="text-right">
                          <Select value="" onValueChange={(v) => updateEvalMutation.mutate({ id: s.id, status: v })}>
                            <SelectTrigger className="w-32 h-8"><SelectValue placeholder="Set status" /></SelectTrigger>
                            <SelectContent>
                              {['SCHEDULED','COMPLETE','DEFERRED','FAILED'].map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                    {summary.evaluations.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-slate-500">No evaluation steps yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="follow" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">OPTN Policy 14 follow-ups</CardTitle>
                <CardDescription>Auto-created at 6, 12, and 24 months once the donor transitions to DONATED.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Milestone (months)</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead>
                    <TableHead>Completed</TableHead><TableHead className="text-right">Action</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {summary.followups.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell>{f.milestone_months}</TableCell>
                        <TableCell>{f.due_date || '—'}</TableCell>
                        <TableCell><Badge variant="secondary">{f.status}</Badge></TableCell>
                        <TableCell>{f.completed_date || '—'}</TableCell>
                        <TableCell className="text-right">
                          <Select value="" onValueChange={(v) => updateFollowupMutation.mutate({ id: f.id, status: v })}>
                            <SelectTrigger className="w-32 h-8"><SelectValue placeholder="Set status" /></SelectTrigger>
                            <SelectContent>
                              {['SCHEDULED','COMPLETE','OVERDUE','LOST_TO_FOLLOWUP'].map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                    {summary.followups.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-slate-500">No follow-ups scheduled (donor has not yet donated).</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default function LivingDonors() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const { data: donors = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['living-donors', statusFilter],
    queryFn: () => api.livingDonor.list(statusFilter === 'all' ? {} : { status: statusFilter }),
    refetchInterval: 60000,
  });

  const overdueMutation = useMutation({
    mutationFn: () => api.livingDonor.markOverdue(),
    onSuccess: (data) => {
      toast({ title: 'Overdue sweep complete', description: `${data.overdueCount || 0} follow-up(s) marked OVERDUE.` });
      queryClient.invalidateQueries({ queryKey: ['donor-summary'] });
    },
    onError: (e) => toast({ title: 'Sweep failed', description: e.message, variant: 'destructive' }),
  });

  const refresh = () => { refetch(); queryClient.invalidateQueries({ queryKey: ['living-donors'] }); };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="w-7 h-7 text-cyan-700" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Living Donors</h1>
            <p className="text-slate-600 text-sm">Workflow from inquiry through donation, with OPTN Policy 14 follow-ups.</p>
          </div>
        </div>
        {!selected && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => overdueMutation.mutate()} disabled={overdueMutation.isPending}>
              {overdueMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}
              Sweep overdue
            </Button>
            <Button variant="outline" onClick={refresh}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
            <CreateDonorDialog onCreated={refresh} />
          </div>
        )}
      </div>

      {selected ? (
        <DonorDetail donor={selected} onBack={() => setSelected(null)} />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Donors</CardTitle>
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList>
                {['all','INQUIRY','SCREENING','EVALUATION','APPROVED','DONATED'].map((s) => (
                  <TabsTrigger key={s} value={s}>{s === 'all' ? 'All' : s}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {isError && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
            {isLoading ? (
              <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : donors.length === 0 ? (
              <div className="text-center text-slate-500 py-12">
                <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                No living donor candidates for this filter.
              </div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Name</TableHead><TableHead>MRN</TableHead><TableHead>Status</TableHead>
                  <TableHead>Intended organ</TableHead><TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {donors.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.last_name}, {d.first_name}</TableCell>
                      <TableCell className="font-mono text-xs">{d.mrn || '—'}</TableCell>
                      <TableCell><StatusBadge status={d.status} /></TableCell>
                      <TableCell>{d.intended_organ}</TableCell>
                      <TableCell className="text-xs">{d.created_at}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setSelected(d)}>
                          <Eye className="w-3 h-3 mr-1" /> Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
