// Trial types
export interface OutcomeSummary {
  type: string;
  measure: string;
  time_frame: string;
}

export interface TrialSummary {
  nct_id: string;
  title: string;
  status: string;
  phase: string;
  enrollment_count: number | null;
  conditions: string[];
  interventions: string[];
  outcomes: OutcomeSummary[];
  sponsor_name: string;
  source?: string;
  intercavitary_delivery?: string;
  intercavitary_mechanisms?: string;
  who_types?: string[];
  who_confidence?: string;
}

export interface TrialListResponse {
  trials: TrialSummary[];
  total: number;
  applied_expansions?: Record<string, string[]>;
}

export interface TrialDetail {
  nct_id: string;
  title: string;
  brief_summary: string;
  detailed_description: string;
  status: string;
  phase: string;
  study_type: string;
  enrollment_count: number | null;
  start_date: string | null;
  completion_date: string | null;
  conditions: string[];
  interventions: InterventionInfo[];
  sponsor: SponsorInfo | null;
  outcomes: OutcomeInfo[];
  arms: ArmInfo[];
  eligibility: EligibilityInfo | null;
}

export interface InterventionInfo {
  name: string;
  type: string;
  description: string;
  chembl_id: string | null;
}

export interface SponsorInfo {
  name: string;
  type: string;
}

export interface OutcomeResultInfo {
  group_title: string;
  group_description: string;
  participants_count: number | null;
  value: string;
  param_type: string;
  unit: string;
  lower_limit: string;
  upper_limit: string;
  dispersion_type: string;
  class_title?: string;
  category?: string;
}

export interface OutcomeInfo {
  measure: string;
  time_frame: string;
  description: string;
  type: string;
  results: OutcomeResultInfo[];
}

export interface ArmInfo {
  label: string;
  type: string;
  description: string;
}

export interface EligibilityInfo {
  criteria_text: string;
  sex: string;
  min_age: string;
  max_age: string;
  healthy_volunteers: boolean;
}

// Biomarker types
export interface BiomarkerMatch {
  marker: string;
  category: string;
  raw_text: string;
  context: string;
  requirement: string;
  tcga_count: number | null;
  tcga_total: number | null;
  tcga_percent: number | null;
  tcga_note: string | null;
}

export interface ArmBiomarkerInfo {
  arm_label: string;
  arm_type: string;
  arm_description: string;
  biomarkers: BiomarkerMatch[];
}

export interface BiomarkerResponse {
  nct_id: string;
  biomarkers: BiomarkerMatch[];
  arm_biomarkers: ArmBiomarkerInfo[];
}

// Condition types
export interface ConditionItem {
  name: string;
  trial_count: number;
}

export interface ConditionSuggestion {
  original: string;
  expanded_terms: string[];
}

// Metrics / Analysis
export interface MetricsSummary {
  total_trials: number;
  total_enrollment: number;
  mean_enrollment: number;
  conditions_count: number;
  interventions_count: number;
}

export interface ConditionCount {
  condition: string;
  count: number;
}

export interface MOADistribution {
  moa_category: string;
  intervention_count: number;
  trial_count: number;
}

export interface MOACategoryItem {
  moa_category: string;
  moa_broad_category: string;
  intervention_count: number;
  trial_count: number;
}

export interface MOAInterventionItem {
  intervention_name: string;
  chembl_id: string;
  mechanism_description: string;
  moa_short_form: string;
  moa_broad_category: string;
  action_type: string;
  data_source: string;
  gene_symbols: string[];
}

export interface MOADrugLookupResponse {
  drug_name: string;
  chembl_id: string;
  mechanisms: {
    long_form: string;
    short_form: string;
    broad_category: string;
    action_type: string;
    target_name: string;
    gene_symbols: string[];
  }[];
}

export interface PhaseDistribution {
  phase: string;
  trial_count: number;
}

export interface StatusDistribution {
  status: string;
  trial_count: number;
}

export interface FilterOptions {
  conditions: string[];
  moa_categories: string[];
  phases: string[];
  statuses: string[];
  sponsors: string[];
  study_types: string[];
  countries: string[];
  interventions: string[];
}

export interface FilterSpec {
  conditions?: string[];
  moa_categories?: string[];
  phases?: string[];
  statuses?: string[];
  sponsors?: string[];
  study_types?: string[];
  locations_country?: string[];
  intervention_keywords?: string[];
  min_enrollment?: number;
  max_enrollment?: number;
  has_results?: boolean;
  outcome_keywords?: string[];
}

export interface FilteredTrialsResponse {
  total: number;
  trials: {
    nct_id: string;
    title: string;
    status: string;
    phase: string;
    enrollment_count: number | null;
    interventions: string[];
  }[];
}

// Simulation
export interface SimulationRequest {
  trial_nct_id: string;
  response_rate: number;
  max_cohort: number;
}

export interface SimulationResponse {
  trial_nct_id: string;
  total_cohort: number;
  eligible_count: number;
  responder_count: number;
  response_rate: number;
  mean_magnitude: number;
}

// Threshold
export interface ThresholdRequest {
  method: string;
  cost_fn_ratio: number;
  percentile: number;
}

export interface ThresholdResponse {
  threshold: number;
  method: string;
  sensitivity: number;
  specificity: number;
  auc: number;
  youden_j: number;
}

// Outcome expansion
export interface OutcomeExpandResponse {
  original: string;
  expanded_terms: string[];
}

// TCGA Cohort
export interface TCGASummary {
  patient_count: number;
  drug_count: number;
  gene_count: number;
  patients: string[];
}

export interface TCGAValuePair {
  patient: string;
  value: number;
}

export interface TCGAStats {
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
}

export interface DCNADetail {
  drug: string;
  values: TCGAValuePair[];
  stats: TCGAStats;
  error?: string;
}

export interface ExpressionDetail {
  gene: string;
  ensembl_id: string;
  values: TCGAValuePair[];
  stats: TCGAStats;
  error?: string;
}

export interface PatientProfile {
  patient_id: string;
  top_dcna: { drug: string; value: number }[];
  bottom_dcna: { drug: string; value: number }[];
  top_expressed_genes: { gene: string; ensembl_id: string; value: number }[];
}

// Export
export type ExportFormat = 'csv' | 'json';
