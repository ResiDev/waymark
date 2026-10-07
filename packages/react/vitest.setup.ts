import '@testing-library/jest-dom/vitest';

// Every jsdom test renders through act.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
