import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

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
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // ── Downgraded from error → warn for v1.0.0 ──────────────────────
      // Each rule has deliberate usages in the codebase; downgrading keeps
      // the signal visible (reviewers see the warnings) without blocking
      // CI. Follow-up PRs can tighten back to error once violations are
      // cleaned up.

      // `any` — Plotly layout types are incomplete for the nested
      // `annotations.xref` union used by `withProvenance`; the OLS-fit
      // return object also uses `any` pending a proper type.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused vars — allow `_`-prefixed names as intentional (matches the
      // convention used in several of our signatures: `_side`, `_patients`).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // React Compiler diagnostics from the react-hooks plugin. Several
      // legacy components mutate state synchronously inside useEffect in
      // ways the compiler flags; they work at runtime but aren't
      // compiler-optimal.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',

      // `react-refresh/only-export-components` warns when a module exports
      // both React components and non-component helpers, which is common
      // in our utils/ and hooks/ modules.
      'react-refresh/only-export-components': 'warn',

      // ── Accessibility (jsx-a11y) ──────────────────────────────────────
      // Start at warn level — many existing interactive elements lack
      // explicit aria-labels. Tighten to error in v1.1 once the backlog
      // is addressed.
      ...Object.fromEntries(
        Object.keys(jsxA11y.rules).map((rule) => [`jsx-a11y/${rule}`, 'warn']),
      ),
    },
  },
]);
