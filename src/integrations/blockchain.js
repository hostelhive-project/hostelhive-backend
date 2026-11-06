const crypto = require('crypto');
const env = require('../config/env');
const repository = require('../repositories/blockchain.repository');
const AppError = require('../utils/AppError');

let setup;
function provider() {
  const { ethers } = require('ethers');
  const request = new ethers.FetchRequest(env.integrations.blockchain.rpcUrl);
  request.timeout = 15000;
  return new ethers.JsonRpcProvider(request);
}
function getWallet() {
  if (setup) return setup;
  const { rpcUrl, privateKey } = env.integrations.blockchain;
  if (!rpcUrl && !privateKey && env.nodeEnv !== 'production') return null;
  if (!rpcUrl || !privateKey) throw new AppError('Blockchain delivery is not configured.', 503);
  const { ethers } = require('ethers');
  const rpc = provider();
  setup = { ethers, provider: rpc, wallet: new ethers.Wallet(privateKey, rpc) };
  return setup;
}
function canonical(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
}
function hashPayload(payload, version = 1) {
  return crypto.createHash('sha256').update(JSON.stringify(version ? canonical(payload) : payload)).digest('hex');
}
async function writeRecord(sourceType, sourceId, payload) {
  let record = await repository.find(sourceType, sourceId);
  if (record && record.status !== 'Pending' && record.blockRef) return record;
  if (!record) record = await repository.prepare(sourceType, sourceId, hashPayload(payload), canonical(payload));
  const context = getWallet();
  if (!context) return repository.update(record._id, {
    blockRef: 'sim-block-' + record.id, network: 'simulated', explorerUrl: null, status: 'Simulated', writtenAt: new Date(),
  });
  const { ethers, wallet, provider: rpc } = context;
  const network = await rpc.getNetwork();
  if (env.integrations.blockchain.network === 'polygon-amoy' && network.chainId !== 80002n) throw new Error('RPC is not connected to Polygon Amoy.');
  if (!record.blockRef) {
    const nonce = await repository.reserveNonce(record.id, String(network.chainId) + ':' + wallet.address,
      await rpc.getTransactionCount(wallet.address, 'pending'));
    const transaction = await wallet.populateTransaction({ to: wallet.address, value: 0, nonce,
      data: '0x' + Buffer.from(record.hash).toString('hex') });
    const signedTransaction = await wallet.signTransaction(transaction);
    const hash = ethers.keccak256(signedTransaction);
    record = await repository.saveSigned(record.id, { blockRef: hash, signedTransaction, chainId: String(network.chainId), expectedAddress: wallet.address,
      network: env.integrations.blockchain.network });
    if (!record?.signedTransaction || !record.blockRef) throw new Error('The signed audit transaction could not be persisted.');
  }
  // Persist the exact signed transaction BEFORE broadcast. Retries rebroadcast
  // identical bytes and therefore cannot create another transaction/hash.
  let receipt = await rpc.getTransactionReceipt(record.blockRef);
  if (!receipt) {
    const existing = await rpc.getTransaction(record.blockRef);
    if (!existing && record.signedTransaction) await rpc.broadcastTransaction(record.signedTransaction);
    receipt = await rpc.waitForTransaction(record.blockRef, 1, 20000);
  }
  if (!receipt) throw new Error('Blockchain confirmation is pending.');
  if (Number(receipt.status) !== 1) throw new Error('The audit transaction was not successful. Operator review is required.');
  return repository.update(record.id, { status: 'Confirmed', writtenAt: new Date(),
    explorerUrl: env.integrations.blockchain.explorerTxBaseUrl + record.blockRef });
}
async function verifyOnChain(record) {
  if (record.network === 'simulated') return { onChainVerified: false, verificationState: 'Simulated' };
  if (!record.blockRef || record.status === 'Pending') return { onChainVerified: false, verificationState: 'Pending' };
  if (!env.integrations.blockchain.rpcUrl) return { onChainVerified: false, verificationState: 'Unavailable' };
  try {
    const rpc = setup?.provider || provider();
    const [transaction, receipt, network] = await Promise.all([
      rpc.getTransaction(record.blockRef), rpc.getTransactionReceipt(record.blockRef), rpc.getNetwork(),
    ]);
    const expectedChain = record.chainId || (record.network === 'polygon-amoy' ? '80002' : null);
    const expectedData = '0x' + Buffer.from(record.hash).toString('hex');
    const addressMatches = !record.expectedAddress ||
      (transaction?.from?.toLowerCase() === record.expectedAddress.toLowerCase() && transaction?.to?.toLowerCase() === record.expectedAddress.toLowerCase());
    const valid = Boolean(transaction && receipt && Number(receipt.status) === 1 &&
      transaction.data.toLowerCase() === expectedData.toLowerCase() && addressMatches &&
      (!expectedChain || expectedChain === String(network.chainId)));
    return { onChainVerified: valid, verificationState: valid ? 'Verified' : 'Mismatch' };
  } catch { return { onChainVerified: false, verificationState: 'Unavailable' }; }
}
module.exports = { writeRecord, hashPayload, verifyRecord: repository.find, verifyOnChain };
