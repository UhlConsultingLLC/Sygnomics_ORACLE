import { useState, useRef, useEffect, useCallback } from 'react';
import { fetchAutocomplete } from '../services/api';

interface AutocompleteInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  field: 'conditions' | 'interventions' | 'outcomes';
  style?: React.CSSProperties;
  clearButton?: React.ReactNode;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Optional custom fetcher that overrides the default /analysis/autocomplete lookup.
   *  Receives the current query string and should return a list of suggestion strings. */
  fetcher?: (query: string) => Promise<string[]>;
  /** If true, treat the input as a comma-separated list and only autocomplete
   *  the token the caret is currently in. */
  multiToken?: boolean;
}

export default function AutocompleteInput({
  placeholder,
  value,
  onChange,
  field,
  style,
  clearButton,
  onKeyDown: externalKeyDown,
  fetcher,
  multiToken = false,
}: AutocompleteInputProps) {
  // Extract the token under the caret for multi-token autocomplete on
  // comma-separated inputs (e.g. "EGFR, VEG" → query = "VEG").
  const activeToken = (v: string) => {
    if (!multiToken) return v;
    const parts = v.split(',');
    return (parts[parts.length - 1] || '').trim();
  };
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const q = activeToken(query);
      if (!q || q.length < 2) {
        setSuggestions([]);
        setShowDropdown(false);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        try {
          const results = fetcher ? await fetcher(q) : await fetchAutocomplete(field, q);
          setSuggestions(results);
          setShowDropdown(results.length > 0);
          setHighlightIndex(-1);
        } catch {
          setSuggestions([]);
          setShowDropdown(false);
        }
      }, 250);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [field, fetcher, multiToken],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    fetchSuggestions(val);
  };

  const selectSuggestion = (suggestion: string) => {
    if (multiToken) {
      // Replace only the active (last) token, preserve earlier entries.
      const parts = value.split(',');
      parts[parts.length - 1] = ` ${suggestion}`;
      onChange(parts.join(',').replace(/^\s+/, '') + ', ');
    } else {
      onChange(suggestion);
    }
    setSuggestions([]);
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showDropdown && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      } else if (e.key === 'Enter' && highlightIndex >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightIndex]);
        return;
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
        return;
      }
    }
    // Pass through to external handler if not consumed
    externalKeyDown?.(e);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: style?.flex ?? 1 }}>
      <input
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
        style={{
          padding: '0.4rem 0.8rem',
          paddingRight: clearButton ? 28 : '0.8rem',
          border: '1px solid #ccc',
          borderRadius: 4,
          width: '100%',
          boxSizing: 'border-box',
          ...style,
        }}
      />
      {clearButton}
      {showDropdown && suggestions.length > 0 && (
        <ul style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 1000,
          background: '#fff',
          border: '1px solid #ccc',
          borderTop: 'none',
          borderRadius: '0 0 4px 4px',
          margin: 0,
          padding: 0,
          listStyle: 'none',
          maxHeight: 220,
          overflowY: 'auto',
          boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
        }}>
          {suggestions.map((s, i) => (
            <li
              key={s}
              title={s}
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
              onMouseEnter={() => setHighlightIndex(i)}
              style={{
                padding: '6px 10px',
                fontSize: '0.82rem',
                cursor: 'pointer',
                background: i === highlightIndex ? '#e8f4fd' : '#fff',
                color: '#333',
                borderBottom: i < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
