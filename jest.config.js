module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setupEnvironment.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupMocks.js'],
  testTimeout: 20000,
};
