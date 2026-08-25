import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['dist', 'src-tauri/target', 'node_modules', 'test-results', 'playwright-report'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Only the two CLASSIC hook rules. eslint-plugin-react-hooks v7 also ships
      // the React Compiler rules (`refs`, `immutability`, `set-state-in-effect`,
      // `use-memo`), and they are fundamentally at odds with react-three-fiber:
      // this app deliberately mutates three.js objects and reads refs during
      // render to stream UV buffers to the GPU without re-rendering. Enabling
      // them produced ~30 errors, none of them bugs — which is how a lint config
      // gets switched off wholesale. These two catch real defects (a
      // conditionally-called hook slipped in during this very pass).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // The unwrap/pack maths is full of deliberately unused loop bindings and
      // `_`-prefixed placeholders; flag the rest.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` appears in a handful of three.js / Vitest config seams where the
      // upstream types genuinely don't line up — warn, don't block the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `cond ? a() : b()` as a statement is used throughout as a terse dispatch
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
    },
  },
  {
    // Node-side scripts and configs. Browser globals too: the Playwright and
    // CDP scripts pass callbacks that are serialised and run IN THE PAGE, so
    // `window`/`document` are legitimately in scope inside them.
    files: ['scripts/**/*.mjs', '*.config.{ts,js}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  prettier, // must stay last — turns off everything stylistic
)
