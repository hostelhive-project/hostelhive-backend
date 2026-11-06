jest.mock('../src/integrations/email', () => ({ sendOtpEmail: jest.fn().mockResolvedValue(undefined) }));
