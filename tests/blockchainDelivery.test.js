jest.mock('../src/repositories/blockchain.repository', () => ({
  find: jest.fn(), prepare: jest.fn(), update: jest.fn(), saveSigned: jest.fn(), reserveNonce: jest.fn(),
}));

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers').ethers;
  const rpc = {
    getNetwork: jest.fn(), getTransactionCount: jest.fn(), getTransactionReceipt: jest.fn(),
    getTransaction: jest.fn(), broadcastTransaction: jest.fn(), waitForTransaction: jest.fn(),
  };
  const wallet = { address: '0x1111111111111111111111111111111111111111', populateTransaction: jest.fn(), signTransaction: jest.fn() };
  return { ethers: { ...actual, FetchRequest: class {}, JsonRpcProvider: class { constructor() { return rpc; } },
    Wallet: class { constructor() { return wallet; } } }, rpc, wallet };
});

const env = require('../src/config/env');
const repository = require('../src/repositories/blockchain.repository');
const integration = require('../src/integrations/blockchain');
const { rpc, wallet, ethers } = require('ethers');
let stored;

beforeEach(() => {
  jest.clearAllMocks();
  stored = null;
  env.integrations.blockchain.rpcUrl = 'http://offline-fixture.invalid';
  env.integrations.blockchain.privateKey = 'mock-wallet';
  env.integrations.blockchain.network = 'polygon-amoy';
  repository.find.mockImplementation(async () => stored ? { ...stored } : null);
  repository.prepare.mockImplementation(async (sourceType, sourceId, hash, payload) => {
    stored ||= { id: 'fixture-record', sourceType, sourceId, hash, anchorPayload: payload, status: 'Pending', blockRef: null };
    return { ...stored };
  });
  repository.reserveNonce.mockResolvedValue(4);
  repository.saveSigned.mockImplementation(async (_id, changes) => {
    if (!stored.blockRef) Object.assign(stored, changes);
    return { ...stored };
  });
  repository.update.mockImplementation(async (_id, changes) => ({ ...Object.assign(stored, changes) }));
  rpc.getNetwork.mockResolvedValue({ chainId: 80002n });
  rpc.getTransactionCount.mockResolvedValue(4);
  rpc.getTransactionReceipt.mockResolvedValue(null);
  rpc.getTransaction.mockResolvedValue(null);
  rpc.broadcastTransaction.mockImplementation(async raw => {
    expect(stored.signedTransaction).toBe(raw);
    expect(stored.blockRef).toBe(ethers.keccak256(raw));
    return { hash: stored.blockRef };
  });
  rpc.waitForTransaction.mockResolvedValue({ status: 1 });
  wallet.populateTransaction.mockImplementation(async tx => tx);
  wallet.signTransaction.mockResolvedValue('0x1234');
});

test('a confirmation timeout retries the persisted hash without signing another transaction', async () => {
  rpc.waitForTransaction.mockRejectedValueOnce(new Error('confirmation timeout'));
  const payload = { amount: 2000, paidAt: '2026-11-06T00:00:00.000Z' };
  await expect(integration.writeRecord('Payment', 'fixture-payment', payload)).rejects.toThrow('confirmation timeout');
  const firstHash = stored.blockRef;
  rpc.getTransactionReceipt.mockResolvedValue({ status: 1 });
  const result = await integration.writeRecord('Payment', 'fixture-payment', payload);
  expect(result.status).toBe('Confirmed');
  expect(result.blockRef).toBe(firstHash);
  expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
  expect(rpc.broadcastTransaction).toHaveBeenCalledTimes(1);
});

test('overlapping workers broadcast only the winning persisted signed bytes', async () => {
  wallet.signTransaction.mockResolvedValueOnce('0x1234').mockResolvedValueOnce('0x1235');
  const results = await Promise.all([
    integration.writeRecord('Payment', 'same-payment', { amount: 2000 }),
    integration.writeRecord('Payment', 'same-payment', { amount: 2000 }),
  ]);
  expect(new Set(results.map(record => record.blockRef)).size).toBe(1);
  expect(new Set(rpc.broadcastTransaction.mock.calls.map(call => call[0])).size).toBe(1);
});

test('RPC verification accepts matching data and rejects wrong data or wrong chain', async () => {
  const record = { hash: 'abcd', blockRef: '0xfixture', status: 'Confirmed', network: 'polygon-amoy',
    expectedAddress: wallet.address, chainId: '80002' };
  rpc.getTransactionReceipt.mockResolvedValue({ status: 1 });
  rpc.getTransaction.mockResolvedValue({ from: wallet.address, to: wallet.address, data: '0x' + Buffer.from(record.hash).toString('hex') });
  expect((await integration.verifyOnChain(record)).onChainVerified).toBe(true);
  rpc.getNetwork.mockResolvedValueOnce({ chainId: 1n });
  expect((await integration.verifyOnChain(record)).verificationState).toBe('Mismatch');
  rpc.getTransaction.mockResolvedValue({ from: wallet.address, to: wallet.address, data: '0x00' });
  expect((await integration.verifyOnChain(record)).verificationState).toBe('Mismatch');
});
