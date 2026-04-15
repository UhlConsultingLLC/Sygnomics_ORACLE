import { useQuery, useMutation } from '@tanstack/react-query';
import * as api from '../services/api';
import type { FilterSpec, SimulationRequest, ThresholdRequest } from '../types';

export const useTrials = (params?: { nct_id?: string; condition?: string; status?: string; phase?: string; intervention?: string; intervention_mode?: 'any' | 'all'; intervention_exclusive?: boolean; intervention_same_arm?: boolean; has_results?: string; outcome_keyword?: string; who_type?: string; expand_synonyms?: boolean; limit?: number; offset?: number }) =>
  useQuery({ queryKey: ['trials', params], queryFn: () => api.fetchTrials(params) });

export const useTrialDetail = (nctId: string) =>
  useQuery({ queryKey: ['trial', nctId], queryFn: () => api.fetchTrialDetail(nctId), enabled: !!nctId });

export const useTrialBiomarkers = (nctId: string) =>
  useQuery({ queryKey: ['biomarkers', nctId], queryFn: () => api.fetchTrialBiomarkers(nctId), enabled: !!nctId });

export const useConditions = () =>
  useQuery({ queryKey: ['conditions'], queryFn: api.fetchConditions });

export const useMetrics = () =>
  useQuery({ queryKey: ['metrics'], queryFn: api.fetchMetrics });

export const useTrialsPerCondition = (limit = 30) =>
  useQuery({ queryKey: ['trialsPerCondition', limit], queryFn: () => api.fetchTrialsPerCondition(limit) });

export const useMOADistribution = () =>
  useQuery({ queryKey: ['moaDistribution'], queryFn: api.fetchMOADistribution });

export const useMOACategories = () =>
  useQuery({ queryKey: ['moaCategories'], queryFn: api.fetchMOACategories });

export const useMOAInterventions = (category: string) =>
  useQuery({
    queryKey: ['moaInterventions', category],
    queryFn: () => api.fetchMOAInterventions(category),
    enabled: !!category,
  });

export const useLookupDrugMOA = () =>
  useMutation({ mutationFn: (drugName: string) => api.lookupDrugMOA(drugName) });

export const useClassifyMOA = () =>
  useMutation({ mutationFn: (forceReclassify: boolean) => api.classifyMOA(forceReclassify) });

export const usePhaseDistribution = () =>
  useQuery({ queryKey: ['phaseDistribution'], queryFn: api.fetchPhaseDistribution });

export const useStatusDistribution = () =>
  useQuery({ queryKey: ['statusDistribution'], queryFn: api.fetchStatusDistribution });

export const useFilterOptions = () =>
  useQuery({ queryKey: ['filterOptions'], queryFn: api.fetchFilterOptions });

export const useFilterTrials = () =>
  useMutation({ mutationFn: (spec: FilterSpec) => api.filterTrials(spec) });

export const usePlot = (plotType: string) =>
  useQuery({ queryKey: ['plot', plotType], queryFn: () => api.fetchPlot(plotType), enabled: !!plotType });

export const useSimulation = () =>
  useMutation({ mutationFn: (req: SimulationRequest) => api.runSimulation(req) });

export const useThreshold = () =>
  useMutation({ mutationFn: (req: ThresholdRequest) => api.learnThreshold(req) });

// TCGA Cohort
export const useTCGASummary = () =>
  useQuery({ queryKey: ['tcgaSummary'], queryFn: api.fetchTCGASummary });

export const useDCNADetail = (drug: string) =>
  useQuery({ queryKey: ['dcna', drug], queryFn: () => api.fetchDCNADetail(drug), enabled: !!drug });

export const useExpressionDetail = (gene: string) =>
  useQuery({ queryKey: ['expression', gene], queryFn: () => api.fetchExpressionDetail(gene), enabled: !!gene });

export const usePatientProfile = (patientId: string) =>
  useQuery({ queryKey: ['patient', patientId], queryFn: () => api.fetchPatientProfile(patientId), enabled: !!patientId });
