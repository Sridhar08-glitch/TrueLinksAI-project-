import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Save, Info, Plus, Trash2, Wand2, FileUp, FileJson, Check, X, AlertTriangle } from 'lucide-react';
import { leaseRulesApi, customRulesApi, ruleProposalsApi } from '../lib/api';
import { extractApiError } from '../lib/utils';
import { QueryError } from '../components/ui/QueryError';
import { useToast } from '../components/ui/Toast';

interface LeaseRule {
  id: string;
  description: string;
  check: string;
  severity: 'low' | 'medium' | 'high';
  enabled: boolean;
  config: Record<string, number>;
}

interface RulesResponse {
  ruleset_name: string;
  version: string;
  rules: LeaseRule[];
}

const CONFIG_LABELS: Record<string, string> = {
  min_deposit_months: 'Minimum deposit (months of rent)',
  max_term_months: 'Maximum lease term (months)',
  tolerance_pct: 'Allowed difference (%)',
};

function RuleCard({ rule }: { rule: LeaseRule }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(rule.description);
  const [severity, setSeverity] = useState(rule.severity);
  const [enabled, setEnabled] = useState(rule.enabled !== false);
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(rule.config ?? {}).map(([k, v]) => [k, String(v)])),
  );

  const dirty =
    description !== rule.description ||
    severity !== rule.severity ||
    enabled !== (rule.enabled !== false) ||
    Object.entries(config).some(([k, v]) => Number(v) !== (rule.config ?? {})[k]);

  const saveMutation = useMutation({
    mutationFn: () =>
      leaseRulesApi.update(rule.id, {
        description,
        severity,
        enabled,
        ...(Object.keys(config).length > 0
          ? { config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, Number(v)])) }
          : {}),
      }),
    onSuccess: () => {
      toast(`Rule ${rule.id} saved`);
      queryClient.invalidateQueries({ queryKey: ['lease-rules'] });
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to save rule.'), 'error'),
  });

  const sevCls =
    severity === 'high'
      ? 'bg-red-50 text-red-700'
      : severity === 'medium'
        ? 'bg-orange-50 text-orange-700'
        : 'bg-gray-100 text-gray-600';

  return (
    <div className={`bg-white border rounded-2xl p-5 ${enabled ? 'border-gray-100' : 'border-gray-200 opacity-70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900">{rule.id}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${sevCls}`}>{severity}</span>
          {!enabled && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase bg-gray-100 text-gray-500">
              disabled
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-blue-600"
          />
          Enabled
        </label>
      </div>

      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={2}
        className="mt-3 w-full text-sm text-slate-700 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300 resize-none"
      />

      <p className="mt-2 text-[11px] text-gray-400 font-mono bg-gray-50 rounded-lg px-2.5 py-1.5">{rule.check}</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">Severity</label>
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as LeaseRule['severity'])}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        {Object.entries(config).map(([key, value]) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-gray-500">{CONFIG_LABELS[key] ?? key}</label>
            <input
              type="number"
              min="0.1"
              step="any"
              value={value}
              onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
              className="w-40 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        ))}
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40"
        >
          <Save className="w-3.5 h-3.5" /> {saveMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['lease-rules'],
    queryFn: async () => (await leaseRulesApi.getAll()).data as RulesResponse,
  });

  return (
    <div className="p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <Shield className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-slate-900">Lease Rules</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        {data?.ruleset_name || 'Lease acceptance standards'} · every new or re-validated lease is checked against these rules.
      </p>

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-5">
        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800">
          Changes apply to leases processed from now on. Already-reviewed leases keep their results —
          open a lease and use <span className="font-semibold">Re-validate</span> to re-check it against the updated rules.
          Every change is recorded in the audit log.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-10 text-center">Loading rules…</p>
      ) : isError || !data ? (
        <QueryError label="lease rules" onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {data.rules.map(rule => (
            <RuleCard key={`${rule.id}-${JSON.stringify(rule.config)}-${rule.severity}-${rule.enabled}-${rule.description}`} rule={rule} />
          ))}
        </div>
      )}

      <ImportRulesSection />
      <CustomRulesSection />
    </div>
  );
}

// ── Import rules (JSON file or policy document → Rules Agent) ───────────────

interface RuleProposal {
  id: number;
  source_filename: string;
  source_quote: string;
  source_page: number | null;
  proposal_type: 'rule_update' | 'custom_rule' | 'needs_developer';
  description: string;
  confidence: number;
  target_rule_id: string;
  config_changes: Record<string, number> | null;
  template: string;
  field_name: string;
  operator: string;
  number_value: number | null;
  text_value: string;
  severity: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected';
  created_rule_id: string | null;
}

const PROPOSAL_TYPE_LABELS: Record<RuleProposal['proposal_type'], string> = {
  rule_update: 'Update built-in rule',
  custom_rule: 'New custom rule',
  needs_developer: 'Needs a developer',
};

function ImportRulesSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const jsonInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const { data: proposals } = useQuery({
    queryKey: ['rule-proposals'],
    queryFn: async () => {
      const res = await ruleProposalsApi.getAll({ status: 'pending' });
      return (res.data.results ?? res.data) as RuleProposal[];
    },
    // An analysis may still be running server-side (e.g. after a page refresh);
    // poll so finished proposals appear without a manual refresh.
    refetchInterval: 10000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['rule-proposals'] });
    queryClient.invalidateQueries({ queryKey: ['lease-rules'] });
    queryClient.invalidateQueries({ queryKey: ['custom-rules'] });
  };

  const jsonMutation = useMutation({
    mutationFn: (file: File) => leaseRulesApi.importJson(file),
    onSuccess: res => {
      const { applied, skipped } = res.data as { applied: string[]; skipped: Array<{ id: string; reason: string }> };
      toast(
        `Applied ${applied.length} rule update(s)${skipped.length ? `, ${skipped.length} skipped` : ''}`,
        skipped.length ? 'error' : undefined,
      );
      if (skipped.length) skipped.forEach(s => toast(`${s.id}: ${s.reason}`, 'error'));
      invalidate();
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Import failed.'), 'error'),
  });

  const docMutation = useMutation({
    mutationFn: (file: File) => ruleProposalsApi.upload(file),
    onSuccess: res => {
      toast(`${(res.data as RuleProposal[]).length} rule proposal(s) extracted — review them below`);
    },
    onError: (err: unknown) => toast(extractApiError(err, 'Could not read the policy document.'), 'error'),
    // Refetch either way — if the browser gave up but the backend finished,
    // the proposals are there on the next fetch.
    onSettled: () => invalidate(),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => ruleProposalsApi.approve(id),
    onSuccess: () => { toast('Proposal approved and applied'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to approve proposal.'), 'error'),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => ruleProposalsApi.reject(id, reason),
    onSuccess: () => { toast('Proposal rejected'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to reject proposal.'), 'error'),
  });

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-1">
        <FileUp className="w-4.5 h-4.5 text-blue-600" />
        <h2 className="text-base font-bold text-slate-900">Import Rules</h2>
      </div>
      <p className="text-sm text-gray-500 mb-3">
        Upload a ruleset JSON to bulk-update thresholds, or upload your written policy document (PDF/text)
        and the AI will propose rules from it — each with the sentence it came from, for you to approve or reject.
        Nothing you upload is ever executed as code.
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        <input ref={jsonInput} type="file" accept=".json" className="hidden"
               onChange={e => { const f = e.target.files?.[0]; if (f) jsonMutation.mutate(f); e.target.value = ''; }} />
        <button
          onClick={() => jsonInput.current?.click()}
          disabled={jsonMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-gray-200 hover:border-blue-300 rounded-xl disabled:opacity-40"
        >
          <FileJson className="w-4 h-4 text-blue-600" />
          {jsonMutation.isPending ? 'Importing…' : 'Upload ruleset JSON'}
        </button>

        <input ref={docInput} type="file" accept=".pdf,.txt,.md" className="hidden"
               onChange={e => { const f = e.target.files?.[0]; if (f) docMutation.mutate(f); e.target.value = ''; }} />
        <button
          onClick={() => docInput.current?.click()}
          disabled={docMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-40"
        >
          <Wand2 className="w-4 h-4" />
          {docMutation.isPending ? 'Reading document…' : 'Upload policy document (AI)'}
        </button>
      </div>

      {docMutation.isPending && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4">
          <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-800">AI is reading your policy document…</p>
            <p className="text-xs text-blue-700">
              Extracting each requirement and mapping it to a rule. With local AI this can take a few minutes —
              you can stay on this page, the proposals will appear below when it finishes.
            </p>
          </div>
        </div>
      )}

      {proposals && proposals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">
            {proposals.length} proposal(s) waiting for your decision
          </p>
          {proposals.map(p => (
            <ProposalCard
              key={p.id}
              proposal={p}
              onApprove={() => approveMutation.mutate(p.id)}
              onReject={() => {
                const reason = window.prompt('Why are you rejecting this proposal? (optional)') ?? '';
                rejectMutation.mutate({ id: p.id, reason });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal, onApprove, onReject }:
  { proposal: RuleProposal; onApprove: () => void; onReject: () => void }) {
  const manual = proposal.proposal_type === 'needs_developer';
  const sevCls = proposal.severity === 'high'
    ? 'bg-red-50 text-red-700'
    : proposal.severity === 'medium' ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-600';

  const isManualCheck = proposal.template === 'manual_check';
  const detail =
    proposal.proposal_type === 'rule_update'
      ? `${proposal.target_rule_id}: ${Object.entries(proposal.config_changes ?? {}).map(([k, v]) => `${CONFIG_LABELS[k] ?? k} → ${v}`).join(', ')}`
      : isManualCheck
        ? 'Cannot be checked automatically — approving adds it to every lease as a manual verification item (UNDETERMINED until a human decides).'
        : proposal.proposal_type === 'custom_rule'
          ? `${proposal.template}: ${proposal.field_name}${proposal.operator ? ` ${OPERATOR_LABELS[proposal.operator] ?? proposal.operator}` : ''}${proposal.number_value !== null ? ` ${proposal.number_value}` : ''}${proposal.text_value ? ` [${proposal.text_value}]` : ''}`
          : 'No safe template fits this requirement — a developer must implement the check.';

  return (
    <div className={`bg-white border rounded-2xl p-4 ${manual ? 'border-amber-200' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {(manual || isManualCheck) && <AlertTriangle className="w-4 h-4 text-amber-500" />}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${manual || isManualCheck ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
              {isManualCheck ? 'Manual check rule' : PROPOSAL_TYPE_LABELS[proposal.proposal_type]}
            </span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${sevCls}`}>{proposal.severity}</span>
            <span className="text-[10px] text-gray-400">confidence {(proposal.confidence * 100).toFixed(0)}%</span>
          </div>
          <p className="text-sm text-slate-700 mt-1.5">{proposal.description}</p>
          <p className="text-[11px] text-gray-500 font-mono mt-1">{detail}</p>
          {proposal.source_quote && (
            <p className="text-[11px] text-gray-400 italic mt-1.5 border-l-2 border-gray-200 pl-2">
              “{proposal.source_quote}”
              {proposal.source_page ? <span className="not-italic"> — page {proposal.source_page}</span> : null}
              <span className="not-italic"> · {proposal.source_filename}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!manual && (
            <button onClick={onApprove}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg">
              <Check className="w-3.5 h-3.5" /> Approve
            </button>
          )}
          <button onClick={onReject}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg">
            <X className="w-3.5 h-3.5" /> {manual ? 'Dismiss' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Custom rules (owner-authored, template-based) ────────────────────────────

interface CustomRule {
  id: number;
  rule_id: string;
  description: string;
  template: string;
  field_name: string;
  operator: string;
  compare_field: string;
  number_value: number | null;
  factor: number;
  text_value: string;
  severity: 'low' | 'medium' | 'high';
  enabled: boolean;
}

interface RuleOptions {
  fields: Array<{ value: string; label: string }>;
  templates: Array<{ value: string; label: string; operators: string[] }>;
  severities: string[];
}

const OPERATOR_LABELS: Record<string, string> = {
  gte: 'at least', lte: 'at most', eq: 'exactly',
  must_contain: 'must contain', must_not_contain: 'must NOT contain',
};

function CustomRulesSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: rules, isLoading } = useQuery({
    queryKey: ['custom-rules'],
    queryFn: async () => {
      const res = await customRulesApi.getAll();
      return (res.data.results ?? res.data) as CustomRule[];
    },
  });
  const { data: options } = useQuery({
    queryKey: ['custom-rule-options'],
    queryFn: async () => (await customRulesApi.getOptions()).data as RuleOptions,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['custom-rules'] });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      customRulesApi.update(id, { enabled }),
    onSuccess: () => { toast('Rule updated'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to update rule.'), 'error'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => customRulesApi.remove(id),
    onSuccess: () => { toast('Rule deleted'); invalidate(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to delete rule.'), 'error'),
  });

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4.5 h-4.5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">Your Custom Rules</h2>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          <Plus className="w-3.5 h-3.5" /> New Rule
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Build your own acceptance rules from ready-made templates — no formulas, no code.
        They run alongside R1–R7 on every lease.
      </p>

      {showForm && options && (
        <NewRuleForm options={options} onDone={() => { setShowForm(false); invalidate(); }} />
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-6 text-center">Loading custom rules…</p>
      ) : !rules || rules.length === 0 ? (
        <p className="text-sm text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
          No custom rules yet. Click “New Rule” to create one — for example “Monthly rent must be at least 3000”.
        </p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {rules.map(rule => {
            const sevCls = rule.severity === 'high'
              ? 'bg-red-50 text-red-700'
              : rule.severity === 'medium' ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-600';
            return (
              <div key={rule.id} className={`bg-white border rounded-2xl p-4 ${rule.enabled ? 'border-gray-100' : 'border-gray-200 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900">{rule.rule_id}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${sevCls}`}>{rule.severity}</span>
                      {!rule.enabled && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase bg-gray-100 text-gray-500">disabled</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mt-1">{rule.description}</p>
                    <p className="text-[11px] text-gray-400 font-mono mt-1">
                      {rule.field_name}
                      {rule.operator ? ` ${OPERATOR_LABELS[rule.operator] ?? rule.operator}` : ''}
                      {rule.template === 'number_compare' && rule.number_value !== null ? ` ${rule.number_value}` : ''}
                      {rule.template === 'field_compare' ? ` ${rule.compare_field}${rule.factor !== 1 ? ` × ${rule.factor}` : ''}` : ''}
                      {rule.template === 'date_order' ? ` after ${rule.compare_field}` : ''}
                      {rule.template === 'text_check' ? ` [${rule.text_value}]` : ''}
                      {rule.template === 'required_field' ? ' is present' : ''}
                      {rule.template === 'term_length' && rule.number_value !== null ? ` term ${OPERATOR_LABELS[rule.operator] ?? rule.operator} ${rule.number_value} months` : ''}
                      {rule.template === 'allowed_values' ? ` one of [${rule.text_value}]` : ''}
                      {rule.template === 'manual_check' ? 'manual verification on every lease' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={e => toggleMutation.mutate({ id: rule.id, enabled: e.target.checked })}
                        className="w-4 h-4 accent-blue-600"
                      />
                      Enabled
                    </label>
                    <button
                      onClick={() => { if (window.confirm(`Delete rule ${rule.rule_id}?`)) deleteMutation.mutate(rule.id); }}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      title="Delete rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewRuleForm({ options, onDone }: { options: RuleOptions; onDone: () => void }) {
  const { toast } = useToast();
  const [template, setTemplate] = useState('number_compare');
  const [fieldName, setFieldName] = useState('rent_amount');
  const [operator, setOperator] = useState('gte');
  const [compareField, setCompareField] = useState('rent_amount');
  const [numberValue, setNumberValue] = useState('');
  const [factor, setFactor] = useState('1');
  const [textValue, setTextValue] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');

  const selectedTemplate = options.templates.find(t => t.value === template);
  const operators = selectedTemplate?.operators ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      customRulesApi.create({
        description,
        template,
        field_name: template === 'manual_check' ? '' : fieldName,
        severity,
        ...(operators.length > 0 ? { operator } : {}),
        ...(template === 'number_compare' || template === 'term_length' ? { number_value: Number(numberValue) } : {}),
        ...(template === 'field_compare' ? { compare_field: compareField, factor: Number(factor) || 1 } : {}),
        ...(template === 'date_order' ? { compare_field: compareField } : {}),
        ...(template === 'text_check' || template === 'allowed_values' ? { text_value: textValue } : {}),
      }),
    onSuccess: () => { toast('Custom rule created'); onDone(); },
    onError: (err: unknown) => toast(extractApiError(err, 'Failed to create rule.'), 'error'),
  });

  const selectCls = 'text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300';
  const inputCls = 'text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300';

  const canSubmit =
    description.trim().length > 0 &&
    ((template !== 'number_compare' && template !== 'term_length') || numberValue !== '') &&
    ((template !== 'text_check' && template !== 'allowed_values') || textValue.trim().length > 0);

  return (
    <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 mb-4">
      <p className="text-xs font-semibold text-slate-700 mb-3">New custom rule</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">Rule type</label>
          <select value={template} onChange={e => { setTemplate(e.target.value); const t = options.templates.find(x => x.value === e.target.value); setOperator(t?.operators[0] ?? ''); }} className={selectCls}>
            {options.templates.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {template !== 'manual_check' && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-gray-500">Field</label>
            <select value={fieldName} onChange={e => setFieldName(e.target.value)} className={selectCls}>
              {options.fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        )}
        {operators.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-gray-500">Condition</label>
            <select value={operator} onChange={e => setOperator(e.target.value)} className={selectCls}>
              {operators.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op] ?? op}</option>)}
            </select>
          </div>
        )}
        {(template === 'number_compare' || template === 'term_length') && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-gray-500">{template === 'term_length' ? 'Months' : 'Value'}</label>
            <input type="number" step="any" value={numberValue} onChange={e => setNumberValue(e.target.value)} className={`w-28 ${inputCls}`} placeholder={template === 'term_length' ? 'e.g. 24' : 'e.g. 3000'} />
          </div>
        )}
        {(template === 'field_compare' || template === 'date_order') && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-gray-500">{template === 'date_order' ? 'Must be after' : 'Compared to'}</label>
            <select value={compareField} onChange={e => setCompareField(e.target.value)} className={selectCls}>
              {options.fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        )}
        {template === 'field_compare' && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-gray-500">× factor</label>
            <input type="number" step="any" min="0.1" value={factor} onChange={e => setFactor(e.target.value)} className={`w-20 ${inputCls}`} />
          </div>
        )}
        {(template === 'text_check' || template === 'allowed_values') && (
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[11px] font-medium text-gray-500">
              {template === 'allowed_values' ? 'Allowed values (comma-separated)' : 'Words / phrases (comma-separated)'}
            </label>
            <input value={textValue} onChange={e => setTextValue(e.target.value)} className={inputCls}
                   placeholder={template === 'allowed_values' ? 'e.g. QAR, USD' : 'e.g. mutually agreed, to be agreed'} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-500">Severity</label>
          <select value={severity} onChange={e => setSeverity(e.target.value)} className={selectCls}>
            {options.severities.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-end gap-3 mt-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[11px] font-medium text-gray-500">Description (shown on the validation card)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} className={inputCls} placeholder="e.g. Monthly rent must be at least QAR 3,000" />
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40"
        >
          {createMutation.isPending ? 'Creating…' : 'Create rule'}
        </button>
        <button onClick={onDone} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg">
          Cancel
        </button>
      </div>
    </div>
  );
}
