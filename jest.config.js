/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**/*.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    // The production QuickBooks client delegates persistence/locking to a
    // durable adapter. Its focused tests cover token reuse, rotation, and
    // error classification without performing live Intuit calls.
    './src/clients/quickbooks-client.ts': {
      branches: 55,
      functions: 68,
      lines: 75,
      statements: 68,
    },
    // Central registration now owns HTTP identity enforcement, safe MCP error
    // normalization, signed confirmation, and durable mutation transitions.
    // Focused behavior tests cover the primary success/denial/confirmation
    // paths; defensive ambiguous/duplicate branches retain explicit floors.
    './src/helpers/register-tool.ts': {
      branches: 79,
      functions: 95,
      lines: 90,
      statements: 86,
    },
    './src/helpers/infer-content-type.ts': {
      branches: 50,
      functions: 100,
      lines: 100,
      statements: 75,
    },
    // Bounded multipart upload behavior is tested, including redacted QBO and
    // network failures. This floor covers defensive response-shape branches.
    './src/handlers/create-quickbooks-attachable.handler.ts': {
      branches: 94,
      functions: 100,
      lines: 98,
      statements: 98,
    },
    // update_account's normalizePatch carries a scalar field-type-map switch
    // whose `default` arm is unreachable (the map only ever maps to
    // string/boolean/number). The behavioral tests cover every reachable path;
    // this floor accounts for that one dead arm.
    './src/handlers/update-quickbooks-account.handler.ts': {
      branches: 89,
      functions: 100,
      lines: 97,
      statements: 95,
    },
    // create_account's normalizeAccountPayload carries a scalar field-type-map
    // switch whose boolean/number/default arms are not reachable from the
    // public surface (the fixed payload feeds only string fields; the ParentRef
    // object is attached separately). The behavioral tests cover the reachable
    // paths (top-level create, sub-account create via parent_id, errors); this
    // floor accounts for the dead arms.
    './src/handlers/create-quickbooks-account.handler.ts': {
      branches: 60,
      functions: 100,
      lines: 75,
      statements: 75,
    },
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  clearMocks: true,
  restoreMocks: true,
};
