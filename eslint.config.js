import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [ 'dist/**', 'node_modules/**', '**/*.sql' ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [ 'src/**/*.ts' ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
