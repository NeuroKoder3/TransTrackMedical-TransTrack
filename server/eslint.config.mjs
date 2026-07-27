/**
 * Self-contained ESLint flat config for the TransTrack server package.
 *
 * The server is linted standalone in CI (only server/ dependencies are
 * installed), so this config must not rely on the repository-root
 * eslint.config.js or root node_modules.
 */
import globals from 'globals';
import pluginJs from '@eslint/js';

export default [
  {
    files: ['src/**/*.js', 'test/**/*.{js,mjs}'],
    ...pluginJs.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'commonjs',
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-throw-literal': 'error',
      'no-cond-assign': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      // `== null` / `!= null` is the intentional null-or-undefined idiom
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-with': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    files: ['test/**/*.mjs', 'src/**/*.mjs'],
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
      },
    },
  },
];
