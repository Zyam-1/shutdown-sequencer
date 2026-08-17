import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['test/*.ts'],
          defaultProject: 'tsconfig.eslint.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Disallow `any` — use `unknown` and narrow instead
      '@typescript-eslint/no-explicit-any': 'error',

      // Every promise must be awaited, caught, or explicitly voided
      '@typescript-eslint/no-floating-promises': 'error',

      // Named exports only — no export default in library code
      'no-restricted-exports': [
        'error',
        { restrictDefaultExports: { direct: true, named: true, namedFrom: true } },
      ],

      // Allow void for intentionally-unhandled promises
      'no-void': ['error', { allowAsStatement: true }],

      // Relax some strict rules that are overly noisy for this codebase
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Test files get relaxed rules
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
