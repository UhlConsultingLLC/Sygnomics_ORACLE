import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    // Transpiled fixtures used by smoke tests — generated JS, not source.
    // They carry `.tsx`-style `eslint-disable-next-line` comments that
    // reference rules not configured for plain `.js` files.
    '.smoke/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Rules intentionally downgraded from error → warn for v1.0.0. The
      // codebase has deliberate usages that trip these; downgrading keeps
      // the signal on every PR (reviewers still see the warnings) without
      // blocking CI. A follow-up PR can tighten each back to error once
      // the existing violations are cleaned up.
      //
      // `any` — Plotly layout types are incomplete for the
      // `layout.annotations.xref` union used by `withProvenance`; the
      // OLS-fit return object also uses `any` pending a proper type.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused vars — allow `_`-prefixed names as intentional (matches the
      // convention used in several of our signatures: `_side`, `_patients`).
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // React Compiler diagnostics from the react-hooks plugin. Several
      // legacy components mutate state synchronously inside useEffect in
      // ways the compiler flags; they work at runtime but aren't
      // compiler-optimal. Keep visible as warnings.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',

      // `react-refresh/only-export-components` warns when a module exports
      // both React components and non-component helpers, which is common
      // in our utils/ and hooks/ modules — keep as warn, not error.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
