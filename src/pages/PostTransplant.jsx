import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  Activity, Plus, Loader2, Calendar, Pill, AlertOctagon, Microscope, Building2, Users
} from 'lucide-react';

const ORGANS = ['kidney', 'liver', 'heart', 'lung', 'pancreas', 'intestine', 'multi-organ'];

function PatientPicker({ value, onChange }) {
  const { data: patients = [] } = useQuery({
    queryKey: ['patients-min'],
    queryFn: () => api.entities.Patient.list('-created_at', 500),
  });
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder="Select patient" /></SelectTrigger>
      <SelectContent>
        {patients.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.last_name}, {p.first_name} · MRN {p.patient_id || '—'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateEventDialog({ patientId, onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ organType: '', transplantDate: '', surgeon: '', notes: '' });

  const m = useMutation({
    mutationFn: () => api.postTx.createEvent({ patientId, ...form }),
    onSuccess: () => {
      toast({ title: 'Transplant event recorded' });
      setOpen(false); setForm({ organType: '', transplantDate: '', surgeon: '', notes: '' });
      onCreated?.();
    },
    onError: (e) => toast({ title: 'Could not record event', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!patientId}><Plus className="w-3 h-3 mr-1" /> Add event</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record transplant event</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Organ type</Label>
            <Select value={form.organType} onValueChange={(v) => setForm((f) => ({ ...f, organType: v }))}>
              <SelectTrigger><SelectValue placeholder="Select organ" /></SelectTrigger>
              <SelectContent>{ORGANS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Transplant date</Label>
            <Input type="date" value={form.transplantDate} onChange={(e) => setForm((f) => ({ ...f, transplantDate: e.target.value }))} />
          </div>
          <div>
            <Label>Surgeon</Label>
            <Input value={form.surgeon} onChange={(e) => setForm((f) => ({ ...f, surgeon: e.target.value }))} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!form.organType || !form.transplantDate || m.isPending}>
            {m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateImmunoDialog({ patientId, onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ drugName: '', dose: '', frequency: '', startDate: '', endDate: '', targetTrough: '' });
  const m = useMutation({
    mutationFn: () => api.postTx.createImmuno({ patientId, ...form, endDate: form.endDate || undefined, targetTrough: form.targetTrough || undefined }),
    onSuccess: () => {
      toast({ title: 'Immunosuppression regimen recorded' });
      setOpen(false); setForm({ drugName: '', dose: '', frequency: '', startDate: '', endDate: '', targetTrough: '' });
      onCreated?.();
    },
    onError: (e) => toast({ title: 'Could not save regimen', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" disabled={!patientId}><Plus className="w-3 h-3 mr-1" /> Add regimen</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record immunosuppression regimen</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Drug</Label><Input value={form.drugName} onChange={(e) => setForm((f) => ({ ...f, drugName: e.target.value }))} placeholder="Tacrolimus, Mycophenolate, Prednisone, …" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Dose</Label><Input value={form.dose} onChange={(e) => setForm((f) => ({ ...f, dose: e.target.value }))} /></div>
            <div><Label>Frequency</Label><Input value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} placeholder="BID / QD / weekly" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start date</Label><Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
            <div><Label>End date (optional)</Label><Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></div>
          </div>
          <div><Label>Target trough (optional)</Label><Input value={form.targetTrough} onChange={(e) => setForm((f) => ({ ...f, targetTrough: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!form.drugName || !form.startDate || m.isPending}>
            {m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRejectionDialog({ patientId, onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ episodeDate: '', rejectionType: '', severity: '', treatment: '', notes: '' });
  const m = useMutation({
    mutationFn: () => api.postTx.createRejection({ patientId, ...form }),
    onSuccess: () => { toast({ title: 'Rejection episode recorded' }); setOpen(false); setForm({ episodeDate: '', rejectionType: '', severity: '', treatment: '', notes: '' }); onCreated?.(); },
    onError: (e) => toast({ title: 'Could not save', description: e.message, variant: 'destructive' }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" disabled={!patientId}><Plus className="w-3 h-3 mr-1" /> Add rejection</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record rejection episode</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Episode date</Label><Input type="date" value={form.episodeDate} onChange={(e) => setForm((f) => ({ ...f, episodeDate: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.rejectionType} onValueChange={(v) => setForm((f) => ({ ...f, rejectionType: v }))}>
                <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  {['ACR','AMR','MIXED','CHRONIC','OTHER'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
                <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  {['mild','moderate','severe'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Treatment</Label><Input value={form.treatment} onChange={(e) => setForm((f) => ({ ...f, treatment: e.target.value }))} placeholder="Steroid pulse, ATG, …" /></div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!form.episodeDate || m.isPending}>{m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateBiopsyDialog({ patientId, onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ biopsyDate: '', biopsyType: '', finding: '', banffGrade: '', notes: '' });
  const m = useMutation({
    mutationFn: () => api.postTx.createBiopsy({ patientId, ...form }),
    onSuccess: () => { toast({ title: 'Biopsy recorded' }); setOpen(false); setForm({ biopsyDate: '', biopsyType: '', finding: '', banffGrade: '', notes: '' }); onCreated?.(); },
    onError: (e) => toast({ title: 'Could not save', description: e.message, variant: 'destructive' }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" disabled={!patientId}><Plus className="w-3 h-3 mr-1" /> Add biopsy</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record biopsy</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Biopsy date</Label><Input type="date" value={form.biopsyDate} onChange={(e) => setForm((f) => ({ ...f, biopsyDate: e.target.value }))} /></div>
          <div><Label>Type</Label><Input value={form.biopsyType} onChange={(e) => setForm((f) => ({ ...f, biopsyType: e.target.value }))} placeholder="Protocol, for-cause, surveillance" /></div>
          <div><Label>Finding</Label><Input value={form.finding} onChange={(e) => setForm((f) => ({ ...f, finding: e.target.value }))} /></div>
          <div><Label>Banff grade (optional)</Label><Input value={form.banffGrade} onChange={(e) => setForm((f) => ({ ...f, banffGrade: e.target.value }))} /></div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!form.biopsyDate || m.isPending}>{m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateReadmissionDialog({ patientId, onCreated }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ admitDate: '', dischargeDate: '', reason: '', relatedToGraft: false, notes: '' });
  const m = useMutation({
    mutationFn: () => api.postTx.createReadmission({ patientId, ...form, dischargeDate: form.dischargeDate || undefined }),
    onSuccess: () => { toast({ title: 'Readmission recorded' }); setOpen(false); setForm({ admitDate: '', dischargeDate: '', reason: '', relatedToGraft: false, notes: '' }); onCreated?.(); },
    onError: (e) => toast({ title: 'Could not save', description: e.message, variant: 'destructive' }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" disabled={!patientId}><Plus className="w-3 h-3 mr-1" /> Add readmission</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record post-transplant readmission</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Admit date</Label><Input type="date" value={form.admitDate} onChange={(e) => setForm((f) => ({ ...f, admitDate: e.target.value }))} /></div>
            <div><Label>Discharge date</Label><Input type="date" value={form.dischargeDate} onChange={(e) => setForm((f) => ({ ...f, dischargeDate: e.target.value }))} /></div>
          </div>
          <div><Label>Reason</Label><Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></div>
          <div className="flex items-center gap-2">
            <input id="rel" type="checkbox" checked={form.relatedToGraft} onChange={(e) => setForm((f) => ({ ...f, relatedToGraft: e.target.checked }))} />
            <Label htmlFor="rel">Related to graft</Label>
          </div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!form.admitDate || m.isPending}>{m.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PostTransplant() {
  const queryClient = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['posttx-summary', patientId] });

  const { data: summary, isLoading, isError, error } = useQuery({
    queryKey: ['posttx-summary', patientId],
    queryFn: () => api.postTx.getPatientSummary(patientId),
    enabled: !!patientId,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-7 h-7 text-cyan-700" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Post-Transplant Follow-up</h1>
          <p className="text-slate-600 text-sm">
            Records transplant events, immunosuppression, rejection, biopsies, and readmissions for active recipients.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Select recipient</CardTitle>
        </CardHeader>
        <CardContent>
          <PatientPicker value={patientId} onChange={setPatientId} />
        </CardContent>
      </Card>

      {!patientId && (
        <Alert><AlertDescription>Select a patient to view and manage post-transplant records.</AlertDescription></Alert>
      )}

      {patientId && isLoading && (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading post-tx summary…</div>
      )}

      {patientId && isError && (
        <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>
      )}

      {patientId && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {Object.entries(summary.counts || {}).map(([k, v]) => (
              <Card key={k}>
                <CardContent className="p-3 flex items-center justify-between">
                  <span className="text-xs uppercase text-slate-500">{k.replace(/_/g, ' ')}</span>
                  <span className="text-lg font-semibold">{v}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          <Tabs defaultValue="events">
            <TabsList>
              <TabsTrigger value="events">Transplant events</TabsTrigger>
              <TabsTrigger value="immuno">Immunosuppression</TabsTrigger>
              <TabsTrigger value="rejection">Rejection</TabsTrigger>
              <TabsTrigger value="biopsy">Biopsies</TabsTrigger>
              <TabsTrigger value="readmit">Readmissions</TabsTrigger>
            </TabsList>

            <TabsContent value="events" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" /> Transplant events</CardTitle>
                  <CreateEventDialog patientId={patientId} onCreated={refresh} />
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Organ</TableHead><TableHead>Surgeon</TableHead>
                      <TableHead>Discharge</TableHead><TableHead>Graft status</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {summary.transplant_events.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>{e.transplant_date}</TableCell>
                          <TableCell>{e.organ_type}</TableCell>
                          <TableCell>{e.surgeon || '—'}</TableCell>
                          <TableCell>{e.discharge_date || '—'}</TableCell>
                          <TableCell>{e.graft_status ? <Badge>{e.graft_status}</Badge> : '—'}</TableCell>
                        </TableRow>
                      ))}
                      {summary.transplant_events.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center text-slate-500">No transplant events.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="immuno" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Pill className="w-4 h-4" /> Immunosuppression</CardTitle>
                  <CreateImmunoDialog patientId={patientId} onCreated={refresh} />
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Drug</TableHead><TableHead>Dose</TableHead><TableHead>Frequency</TableHead>
                      <TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Target trough</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {summary.immunosuppression.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.drug_name}</TableCell>
                          <TableCell>{r.dose || '—'}</TableCell>
                          <TableCell>{r.frequency || '—'}</TableCell>
                          <TableCell>{r.start_date}</TableCell>
                          <TableCell>{r.end_date || <Badge variant="secondary">active</Badge>}</TableCell>
                          <TableCell>{r.target_trough || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {summary.immunosuppression.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-slate-500">No regimens recorded.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="rejection" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><AlertOctagon className="w-4 h-4" /> Rejection episodes</CardTitle>
                  <CreateRejectionDialog patientId={patientId} onCreated={refresh} />
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Severity</TableHead>
                      <TableHead>Treatment</TableHead><TableHead>Resolved</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {summary.rejections.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.episode_date}</TableCell>
                          <TableCell>{r.rejection_type || '—'}</TableCell>
                          <TableCell>{r.severity || '—'}</TableCell>
                          <TableCell>{r.treatment || '—'}</TableCell>
                          <TableCell>{r.resolution_date || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {summary.rejections.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center text-slate-500">No rejection episodes.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="biopsy" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Microscope className="w-4 h-4" /> Biopsies</CardTitle>
                  <CreateBiopsyDialog patientId={patientId} onCreated={refresh} />
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Finding</TableHead><TableHead>Banff</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {summary.biopsies.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>{b.biopsy_date}</TableCell>
                          <TableCell>{b.biopsy_type || '—'}</TableCell>
                          <TableCell>{b.finding || '—'}</TableCell>
                          <TableCell>{b.banff_grade || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {summary.biopsies.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-slate-500">No biopsies recorded.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="readmit" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Readmissions</CardTitle>
                  <CreateReadmissionDialog patientId={patientId} onCreated={refresh} />
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Admit</TableHead><TableHead>Discharge</TableHead><TableHead>Reason</TableHead><TableHead>Graft-related</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {summary.readmissions.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.admit_date}</TableCell>
                          <TableCell>{r.discharge_date || '—'}</TableCell>
                          <TableCell>{r.reason || '—'}</TableCell>
                          <TableCell>{r.related_to_graft ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                      ))}
                      {summary.readmissions.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-slate-500">No readmissions recorded.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
