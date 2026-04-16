/* eslint-disable @typescript-eslint/no-explicit-any --
 * One `any` — the Trial Comparison endpoint returns a shape with
 * dynamic per-arm fields that don't fit a single interface cleanly.
 * Tracked for v1.1 as a proper typed union.
 */
import axios from 'axios';
import type {
  TrialListResponse,
  TrialDetail,
  BiomarkerResponse,
  ConditionItem,
  ConditionSuggestion,
  MetricsSummary,
  ConditionCount,
  MOADistribution,
  MOACategoryItem,
  MOAInterventionItem,
  MOADrugLookupResponse,
  PhaseDistribution,
  StatusDistribution,
  FilterOptions,
  FilterSpec,
  FilteredTrialsResponse,
  SimulationRequest,
  SimulationResponse,
  ThresholdRequest,
  ThresholdResponse,
  OutcomeExpandResponse,
} from '../types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

// Trials
export const fetchTrials = async (params?: {
  nct_id?: string;
  condition?: string;
  status?: string;
  phase?: string;
  intervention?: string;
  intervention_mode?: 'any' | 'all';
  intervention_exclusive?: boolean;
  intervention_same_arm?: boolean;
  has_results?: string;
  outcome_keyword?: string;
  who_type?: string;
  expand_synonyms?: boolean;
  limit?: number;
  offset?: number;
}): Promise<TrialListResponse> => {
  const { data } = await api.get('/trials', { params });
  return data;
};

export const fetchTrialDetail = async (nctId: string): Promise<TrialDetail> => {
  const { data } = await api.get(`/trials/${nctId}`);
  return data;
};

export const fetchTrialBiomarkers = async (nctId: string): Promise<BiomarkerResponse> => {
  const { data } = await api.get(`/trials/${nctId}/biomarkers`);
  return data;
};

export const refreshTrialResults = async (nctId: string): Promise<{ nct_id: string; outcomes_updated: number; has_results_on_ctgov: boolean }> => {
  const { data } = await api.post(`/trials/${nctId}/refresh`);
  return data;
};

// Conditions
export const fetchConditions = async (): Promise<ConditionItem[]> => {
  const { data } = await api.get('/conditions');
  return data;
};

export const suggestConditions = async (disease: string): Promise<ConditionSuggestion> => {
  const { data } = await api.post('/conditions/suggest', { disease });
  return data;
};

export interface ExpandedTrialCounts {
  original: string;
  per_term: { term: string; trial_count: number }[];
  unique_total: number;
}

export const expandConditionCounts = async (disease: string): Promise<ExpandedTrialCounts> => {
  const { data } = await api.post('/conditions/expand-counts', { disease });
  return data;
};

// Analysis
export const fetchMetrics = async (): Promise<MetricsSummary> => {
  const { data } = await api.get('/analysis/metrics');
  return data;
};

export const fetchTrialsPerCondition = async (limit = 30): Promise<ConditionCount[]> => {
  const { data } = await api.get('/analysis/trials-per-condition', { params: { limit } });
  return data;
};

export const fetchMOADistribution = async (): Promise<MOADistribution[]> => {
  const { data } = await api.get('/analysis/moa-distribution');
  return data;
};

export const fetchPhaseDistribution = async (): Promise<PhaseDistribution[]> => {
  const { data } = await api.get('/analysis/phase-distribution');
  return data;
};

export const fetchStatusDistribution = async (): Promise<StatusDistribution[]> => {
  const { data } = await api.get('/analysis/status-distribution');
  return data;
};

export const fetchFilterOptions = async (): Promise<FilterOptions> => {
  const { data } = await api.get('/analysis/filter-options');
  return data;
};

export const filterTrials = async (spec: FilterSpec): Promise<FilteredTrialsResponse> => {
  const { data } = await api.post('/analysis/filter', spec);
  return data;
};

export const fetchAutocomplete = async (field: string, q: string, limit = 15): Promise<string[]> => {
  if (!q.trim()) return [];
  const { data } = await api.get(`/analysis/autocomplete/${field}`, { params: { q, limit } });
  return data;
};

export const suggestOutcomes = async (keyword: string): Promise<OutcomeExpandResponse> => {
  const { data } = await api.post('/analysis/outcomes/suggest', { keyword });
  return data;
};

// MOA
export const fetchMOACategories = async (): Promise<MOACategoryItem[]> => {
  const { data } = await api.get('/moa/categories');
  return data;
};

export const fetchMOAInterventions = async (category: string): Promise<MOAInterventionItem[]> => {
  const { data } = await api.get(`/moa/interventions/${encodeURIComponent(category)}`);
  return data;
};

export const lookupDrugMOA = async (drugName: string): Promise<MOADrugLookupResponse> => {
  const { data } = await api.post('/moa/lookup', { drug_name: drugName });
  return data;
};

export const classifyMOA = async (forceReclassify = false): Promise<{ classified: number; skipped: number; failed: number }> => {
  const { data } = await api.post('/moa/classify', { force_reclassify: forceReclassify });
  return data;
};

export const fetchPlot = async (plotType: string): Promise<string> => {
  const { data } = await api.get(`/analysis/plots/${plotType}`);
  return data;
};

// Simulation
export const runSimulation = async (req: SimulationRequest): Promise<SimulationResponse> => {
  const { data } = await api.post('/simulation/run', req);
  return data;
};

export const fetchResponderSimilarity = async (
  simId: string,
  rule: 'majority' | 'any' = 'majority',
  qCutoff = 0.1,
) => {
  const { data } = await api.get(`/simulation/moa-responder-similarity/${simId}`, {
    params: { rule, q_cutoff: qCutoff },
  });
  return data as {
    meta: { rule: string; q_cutoff: number; total_patients: number; total_features: number; n_trials_in_cohort: number };
    groups: { n_responders: number; n_nonresponders: number; responders: string[]; nonresponders: string[] };
    features: Array<{
      feature: string;
      category: string;
      type: string;
      responder_summary: string;
      nonresponder_summary: string;
      responder_value?: number | string;
      nonresponder_value?: number | string;
      effect_label: string;
      effect_size: number | null;
      p_value: number;
      q_value: number;
      direction?: string;
    }>;
    suggestions: Array<{ text: string; feature: string; category: string; q_value: number }>;
    combinations: Array<{
      rule: string;
      n_features: number;
      n_patients: number;
      n_responders: number;
      n_nonresponders: number;
      precision: number;
      lift: number;
    }>;
  };
};

export const downloadResponderSimilarityCsv = (
  simId: string,
  rule: 'majority' | 'any' = 'majority',
  qCutoff = 0.1,
) => {
  const baseURL = api.defaults.baseURL || '';
  const url = `${baseURL}/simulation/moa-responder-similarity/${simId}/download?rule=${rule}&q_cutoff=${qCutoff}`;
  window.open(url, '_blank');
};

// TAM estimate
export interface TAMRequest {
  moas: string[];
  us_patients: number;
  ww_patients: number;
  rule?: 'majority' | 'any';
  top_n?: number;
}

export interface TAMTopDrug {
  drug_name: string;
  n_responders: number;
  response_rate: number;
}

export interface TAMPerMOA {
  moa_category: string;
  sim_id: string;
  learned_threshold: number | null;
  n_responders: number;
  cohort_total: number;
  response_rate: number;
  us_predicted: number;
  ww_predicted: number;
  responder_ids: string[];
  top_drugs: TAMTopDrug[] | null;
  n_drugs_evaluated: number | null;
}

export interface TAMResponse {
  rule: string;
  top_n: number;
  us_patients: number;
  ww_patients: number;
  cohort_total: number;
  per_moa: TAMPerMOA[];
  missing_moas: string[];
  union: {
    n_responders: number;
    response_rate: number;
    us_predicted: number;
    ww_predicted: number;
    responder_ids: string[];
  };
}

export const runTAMEstimate = async (req: TAMRequest): Promise<TAMResponse> => {
  const { data } = await api.post('/simulation/tam-estimate', req);
  return data;
};

export const fetchMOACategoriesForSim = async (): Promise<
  { category: string; value: string; drug_count: number; is_group: boolean }[]
> => {
  const { data } = await api.get('/simulation/moa-categories');
  return data;
};

// Threshold
export const learnThreshold = async (req: ThresholdRequest): Promise<ThresholdResponse> => {
  const { data } = await api.post('/threshold/learn', req);
  return data;
};

// TCGA Cohort
export const fetchTCGASummary = async () => {
  const { data } = await api.get('/tcga/summary');
  return data;
};

export const fetchTCGADrugs = async (search: string) => {
  const { data } = await api.get('/tcga/drugs', { params: { search } });
  return data.drugs as string[];
};

export const fetchTCGAGenes = async (search: string) => {
  const { data } = await api.get('/tcga/genes', { params: { search } });
  return data.genes as { ensembl_id: string; symbol: string }[];
};

export const fetchDCNADetail = async (drug: string) => {
  const { data } = await api.get(`/tcga/dcna/${encodeURIComponent(drug)}`);
  return data;
};

export const fetchExpressionDetail = async (gene: string) => {
  const { data } = await api.get(`/tcga/expression/${encodeURIComponent(gene)}`);
  return data;
};

export const fetchScatterData = async (drug: string, gene: string) => {
  const { data } = await api.get('/tcga/scatter', { params: { drug, gene } });
  return data;
};

export const fetchDrugTargets = async (drugName: string) => {
  const { data } = await api.get(`/tcga/drug-targets/${encodeURIComponent(drugName)}`);
  return data as { drug: string; targets: { gene_symbol: string; action_type: string; in_expression_data: boolean }[] };
};

export const fetchExpressionHeatmap = async (
  genes: string[],
  includeAverage = false,
) => {
  const { data } = await api.get('/tcga/heatmap', {
    params: { genes: genes.join(','), include_average: includeAverage },
  });
  return data as {
    genes?: string[];
    patients?: string[];
    zscores?: number[][];
    missing?: string[];
    total_patients?: number;
    included_average?: boolean;
    error?: string;
  };
};

export const fetchPatientProfile = async (patientId: string) => {
  const { data } = await api.get(`/tcga/patient/${encodeURIComponent(patientId)}`);
  return data;
};

// CTIS (EU Clinical Trials)
export const searchCTIS = async (params: {
  query?: string;
  medical_condition?: string;
  max_results?: number;
  fetch_details?: boolean;
}) => {
  const { data } = await api.post('/ctis/search', params);
  return data as {
    results: {
      ct_number: string;
      title: string;
      status: string;
      phase: string;
      sponsor: string;
      conditions: string;
      products: string;
      countries: string[];
      start_date: string | null;
      enrollment: number | null;
      already_imported: boolean;
    }[];
    total: number;
  };
};

export const startCTISImport = async (params: {
  query?: string;
  medical_condition?: string;
  max_results?: number;
  fetch_details?: boolean;
  use_glioma_search?: boolean;
}) => {
  const { data } = await api.post('/ctis/import', params);
  return data as { job_id: string; status: string; message: string };
};

export const getCTISImportStatus = async (jobId: string) => {
  const { data } = await api.get(`/ctis/import-status/${jobId}`);
  return data as {
    job_id: string;
    status: string;
    stage: string;
    detail: string;
    progress_pct: number;
    trials_found: number;
    trials_imported: number;
    trials_skipped: number;
    error: string | null;
  };
};

export const getCTISStats = async () => {
  const { data } = await api.get('/ctis/stats');
  return data as {
    total_ctis_trials: number;
    total_ctgov_trials: number;
    cross_referenced: number;
    ctis_countries: string[];
  };
};

// WHO 2021 Classification
export const fetchWHOStats = async () => {
  const { data } = await api.get('/who/stats');
  return data as {
    total_classified: number;
    type_distribution: Record<string, number>;
    confidence_distribution: Record<string, number>;
    idh_distribution: Record<string, number>;
  };
};

export const fetchWHOTrialProfile = async (nctId: string) => {
  const { data } = await api.get(`/who/trial/${nctId}`);
  return data as {
    nct_id: string;
    who_types: string[];
    who_grade_min: string;
    who_grade_max: string;
    idh_status: string;
    codeletion_1p19q: string;
    mgmt_status: string;
    cdkn2a_status: string;
    h3k27m_status: string;
    confidence: string;
    biomarker_count: number;
  };
};

export const fetchWHOTrials = async (params?: {
  who_type?: string;
  idh_status?: string;
  codeletion_1p19q?: string;
  mgmt_status?: string;
  confidence?: string;
  region?: string;
  nct_id?: string;
  limit?: number;
  offset?: number;
}) => {
  const { data } = await api.get('/who/trials', { params });
  return data as {
    total: number;
    trials: {
      nct_id: string;
      who_types: string[];
      who_grade_min: string;
      who_grade_max: string;
      idh_status: string;
      codeletion_1p19q: string;
      mgmt_status: string;
      confidence: string;
      biomarker_count: number;
      region: 'US' | 'EU';
      source: string;
    }[];
  };
};

export const reclassifyWHO = async () => {
  const { data } = await api.post('/who/reclassify');
  return data as {
    total_classified: number;
    records_saved: number;
    type_distribution: Record<string, number>;
  };
};

// Trial vs SATGBM TCGA comparison
export interface TrialDrugOption {
  intervention_id: number;
  standard_name: string;
  raw_names: string[];
  chembl_id: string | null;
  moa_short_form: string | null;
  moa_broad_category: string | null;
  has_dcna_profile: boolean;
}

export interface TrialArmOption {
  arm_id: number;
  label: string;
  type: string;
  description: string;
  intervention_names: string[];
}

export interface TrialSubgroupOption {
  group_title: string;
  group_description: string;
}

export interface TrialDrugOptionsResponse {
  nct_id: string;
  drugs: TrialDrugOption[];
  arms: TrialArmOption[];
  subgroups: TrialSubgroupOption[];
}

export const fetchTrialDrugOptions = async (nctId: string): Promise<TrialDrugOptionsResponse> => {
  const { data } = await api.get(`/trials/${nctId}/drug-options`);
  return data as TrialDrugOptionsResponse;
};

export const runTrialComparison = async (
  nctId: string,
  interventionId?: number,
  armId?: number,
  groupTitle?: string,
): Promise<any> => {
  const params: Record<string, string | number> = {};
  if (interventionId != null) params.intervention_id = interventionId;
  if (armId != null) params.arm_id = armId;
  if (groupTitle != null) params.group_title = groupTitle;
  const { data } = await api.post(`/trials/${nctId}/tcga-comparison`, null, {
    params: Object.keys(params).length > 0 ? params : undefined,
    timeout: 10 * 60 * 1000, // up to 10 minutes for MOA simulation
  });
  return data;
};

// Export
export const getExportUrl = (format: 'csv' | 'json'): string => {
  const base = import.meta.env.VITE_API_URL || '';
  return `${base}/export/${format}/trials`;
};
