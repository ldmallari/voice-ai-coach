import next from 'eslint-config-next';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/** Flat config: `next lint` was removed in Next 16, so ESLint runs directly. */
const config = [
  ...next,
  ...nextCoreWebVitals,
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'] },
];

export default config;
