import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import architecture from './tooling/eslint/architecture.mjs';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: globals.node },
    plugins: { monolith: architecture },
    rules: {
      'monolith/imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/dashboard/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-globals': ['error', 'process', 'Buffer', 'global'],
    },
  },
  {
    files: [
      'packages/{shared,privacy-analyzer}/src/**/*.ts',
      '{apps,packages}/*/src/{domain,application,ports}/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': ['error', 'process', 'window', 'document', 'fetch', 'WebSocket'],
    },
  },
];
