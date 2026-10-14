import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended, { files: ['packages/game-sim/**/*.ts', 'apps/web/src/**/*.{ts,tsx}', 'apps/web/test/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'error' } });
