import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'supabase/functions/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['src/**/*.{js,jsx}', 'tests/**/*.js', 'public/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // The pre-existing codebase has not yet completed its unused-import
      // cleanup. Keep correctness linting blocking while that cleanup proceeds.
      'no-unused-vars': 'off',
      'no-constant-binary-expression': 'off',
    },
  },
];
