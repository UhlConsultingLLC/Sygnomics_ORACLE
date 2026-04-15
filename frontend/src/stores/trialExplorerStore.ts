/**
 * Simple in-memory store for Trial Explorer filter state.
 * Persists across React Router navigations (component unmount/remount)
 * without relying on URL search params.
 */

export interface TrialExplorerFilters {
  nctId: string;
  condition: string;
  statuses: string[];
  phases: string[];
  intervention: string;
  hasResultsList: string[];
  whoTypes: string[];
  outcomeInput: string;
  activeOutcomeKeyword: string;
  expandedOutcomes: string[];
  selectedOutcomes: string[];
  page: number;
  expandSynonyms: boolean;
  interventionMode: 'any' | 'all';
  interventionExclusive: boolean;
  interventionSameArm: boolean;
}

const STORAGE_KEY = 'trial_explorer_filters_v3';

const defaults: TrialExplorerFilters = {
  nctId: '',
  condition: '',
  statuses: [],
  phases: [],
  intervention: '',
  hasResultsList: [],
  whoTypes: [],
  outcomeInput: '',
  activeOutcomeKeyword: '',
  expandedOutcomes: [],
  selectedOutcomes: [],
  page: 0,
  expandSynonyms: true,
  interventionMode: 'any',
  interventionExclusive: false,
  interventionSameArm: false,
};

function loadFromStorage(): TrialExplorerFilters {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

let stored: TrialExplorerFilters = loadFromStorage();

export function getTrialExplorerFilters(): TrialExplorerFilters {
  return { ...stored };
}

export function setTrialExplorerFilters(filters: Partial<TrialExplorerFilters>) {
  stored = { ...stored, ...filters };
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch { /* noop */ }
}

export function clearTrialExplorerFilters() {
  stored = { ...defaults };
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
