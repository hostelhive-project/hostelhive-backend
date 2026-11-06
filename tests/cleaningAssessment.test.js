jest.mock('../src/repositories/cleaningAssessment.repository', () => ({
  claim: jest.fn(), find: jest.fn(), beginAttempt: jest.fn(), finish: jest.fn(), reserve: jest.fn(),
}));
jest.mock('../src/services/cleaningPhotos.service', () => ({ loadPair: jest.fn() }));
jest.mock('../src/integrations/groqVision', () => ({ assessCleaning: jest.fn() }));
jest.mock('../src/repositories/upload.repository', () => ({ ownedPublic: jest.fn() }));

const env = require('../src/config/env');
const repository = require('../src/repositories/cleaningAssessment.repository');
const photos = require('../src/services/cleaningPhotos.service');
const groq = require('../src/integrations/groqVision');
const uploads = require('../src/repositories/upload.repository');
const { parseAssessment } = require('../src/utils/cleaningAssessment');
const { processAssessment } = require('../src/services/cleaningAssessment.service');
const actualPhotos = jest.requireActual('../src/services/cleaningPhotos.service');
const actualGroq = jest.requireActual('../src/integrations/groqVision');
const originalFetch = global.fetch;
const originalGroq = { ...env.integrations.groq };
const originalAi = { ...env.integrations.cleaningAi };
const valid = () => ({ comparable: true, imageQuality: 'Good', sensitiveContent: false,
  comparison: 'Improved', summary: 'Visible debris has been removed.', improvements: ['Less litter'],
  issues: ['A visible mark remains'], limitations: [], breakdown: { waste: 3, floor: 2, surfaces: 2, tidiness: 1 } });
let task;

beforeEach(() => {
  jest.resetAllMocks();
  env.integrations.groq.apiKey = 'test-only-key';
  env.integrations.cleaningAi = { enabled: true, model: 'qwen/qwen3.8-27b', dailyLimit: 20 };
  task = { _id: 'task', assignedStaffId: 'staff', status: 'Completed',
    beforeImageUri: 'https://ik.imagekit.io/audit-tests/cleaning/before.png',
    afterImageUri: 'https://ik.imagekit.io/audit-tests/cleaning/after.png',
    cleaningAssessment: { status: 'Processing', attempts: 0, queuedAt: new Date(), startedAt: new Date() } };
  repository.claim.mockResolvedValue(task);
  repository.beginAttempt.mockResolvedValue({ ...task, cleaningAssessment: { ...task.cleaningAssessment, attempts: 1 } });
  repository.finish.mockResolvedValue({ modifiedCount: 1 });
  repository.reserve.mockResolvedValue({ allowed: true });
  photos.loadPair.mockResolvedValue({ before: 'data:before', after: 'data:after', pairHash: 'pair-hash' });
  groq.assessCleaning.mockResolvedValue(JSON.stringify(valid()));
  uploads.ownedPublic.mockResolvedValue({ size: 32 });
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
  Object.assign(env.integrations.groq, originalGroq);
  env.integrations.cleaningAi = originalAi;
});

describe('Cleaning rubric validation', () => {
  test('computes total on the server from validated rubric points', () => {
    expect(parseAssessment(JSON.stringify(valid()))).toMatchObject({ status: 'Assessed', score: 8 });
  });
  test('zero is a real score, not an unavailable result', () => {
    const value = valid(); value.breakdown = { waste: 0, floor: 0, surfaces: 0, tidiness: 0 };
    expect(parseAssessment(JSON.stringify(value))).toMatchObject({ status: 'Assessed', score: 0 });
  });
  test.each([{ comparable: false }, { imageQuality: 'Limited' }, { imageQuality: 'Unusable' }])(
    'visible evidence receives an estimated numeric score despite limitations: %j', (change) => {
      expect(parseAssessment(JSON.stringify({ ...valid(), ...change }))).toMatchObject({ status: 'Assessed', score: 8, estimated: true });
    });
  test('scores only the cleaning area and suppresses generated personal details', () => {
    expect(parseAssessment(JSON.stringify({ ...valid(), sensitiveContent: true })))
      .toMatchObject({ status: 'Assessed', score: 8, improvements: [], issues: [], reason: null });
  });
  test('scales points for visible criteria to 10 and records coverage', () => {
    const value = { ...valid(), imageQuality: 'Limited', breakdown: { waste: null, floor: 2, surfaces: null, tidiness: null } };
    expect(parseAssessment(JSON.stringify(value))).toMatchObject({ status: 'Assessed', score: 6.7, evidenceCoverage: 30,
      estimated: true, breakdown: { waste: null, floor: 2, surfaces: null, tidiness: null } });
  });
  test('a visible dirty area can receive zero without being mistaken for missing evidence', () => {
    expect(parseAssessment(JSON.stringify({ ...valid(), breakdown: { waste: null, floor: 0, surfaces: null, tidiness: null } })))
      .toMatchObject({ status: 'Assessed', score: 0, evidenceCoverage: 30 });
  });
  test('entirely unreadable evidence is unavailable rather than a fabricated cleanliness score', () => {
    expect(parseAssessment(JSON.stringify({ ...valid(), breakdown: { waste: null, floor: null, surfaces: null, tidiness: null } })))
      .toMatchObject({ status: 'Unavailable', score: null, reason: 'no_visible_cleaning_area' });
  });
  test('different areas receive an AFTER appearance rating without claiming verified improvement', () => {
    expect(parseAssessment(JSON.stringify({ ...valid(), comparable: false })))
      .toMatchObject({ status: 'Assessed', score: 8, comparison: 'Unclear' });
  });
  test('a repeated photo can be rated but cannot claim a visible improvement', () => {
    const result = parseAssessment(JSON.stringify(valid()), { identicalPhotos: true });
    expect(result).toMatchObject({ status: 'Assessed', score: 8, comparison: 'Similar' });
    expect(result.limitations.join(' ')).toMatch(/same photo/i);
  });
  test.each([{ breakdown: { waste: 5, floor: 2, surfaces: 2, tidiness: 1 } },
    { breakdown: { waste: 2.5, floor: 2, surfaces: 2, tidiness: 1 } },
    { comparable: 'true' }, { breakdown: null }, { score: 10 }, { summary: 'x'.repeat(601) }])('rejects invalid or invented fields: %j', (change) => {
    expect(() => parseAssessment(JSON.stringify({ ...valid(), ...change }))).toThrow();
  });
});

describe('Durable assessment processing', () => {
  test('saves assessment without modifying task completion or staff data', async () => {
    await expect(processAssessment({ taskId: 'task' })).resolves.toEqual({});
    expect(repository.finish).toHaveBeenCalledWith(task, expect.objectContaining({ status: 'Assessed', score: 8, pairHash: 'pair-hash' }));
    expect(repository.reserve).toHaveBeenCalledTimes(1);
    expect(groq.assessCleaning).toHaveBeenCalledWith('data:before', 'data:after');
  });
  test('a terminal job is not assessed twice', async () => {
    repository.claim.mockResolvedValue(null);
    repository.find.mockResolvedValue({ status: 'Completed', cleaningAssessment: { status: 'Assessed' } });
    await processAssessment({ taskId: 'task' });
    expect(groq.assessCleaning).not.toHaveBeenCalled();
  });
  test('an unexpired processing claim is deferred rather than lost', async () => {
    repository.claim.mockResolvedValue(null); repository.find.mockResolvedValue(task);
    expect((await processAssessment({ taskId: 'task' })).retryAt).toBeInstanceOf(Date);
    expect(groq.assessCleaning).not.toHaveBeenCalled();
  });
  test.each(['disabled', 'not_configured', 'daily_limit', 'attempt_limit', 'queue_timeout'])('stops without a provider call for %s', async (reason) => {
    if (reason === 'disabled') env.integrations.cleaningAi.enabled = false;
    if (reason === 'not_configured') env.integrations.groq.apiKey = '';
    if (reason === 'daily_limit') env.integrations.cleaningAi.dailyLimit = 0;
    if (reason === 'attempt_limit') task.cleaningAssessment.attempts = 2;
    if (reason === 'queue_timeout') task.cleaningAssessment.queuedAt = new Date(Date.now() - 31 * 60000);
    await processAssessment({ taskId: 'task' });
    expect(repository.finish).toHaveBeenCalledWith(task, expect.objectContaining({ status: 'Unavailable', score: null, reason }));
    expect(repository.reserve).not.toHaveBeenCalled(); expect(groq.assessCleaning).not.toHaveBeenCalled();
  });
  test('a photo loading failure is unavailable before spending quota', async () => {
    photos.loadPair.mockRejectedValue(new Error('photo_unavailable'));
    await processAssessment({ taskId: 'task' });
    expect(repository.finish).toHaveBeenCalledWith(task, expect.objectContaining({ status: 'Unavailable', reason: 'photo_unavailable' }));
    expect(repository.reserve).not.toHaveBeenCalled();
  });
  test('daily budget exhaustion does not call Groq', async () => {
    repository.reserve.mockResolvedValue({ allowed: false, exhausted: true });
    await processAssessment({ taskId: 'task' });
    expect(repository.finish).toHaveBeenCalledWith(task, expect.objectContaining({ status: 'Unavailable', reason: 'daily_limit' }));
    expect(groq.assessCleaning).not.toHaveBeenCalled();
  });
  test('rate spacing defers without using a provider attempt', async () => {
    const retryAt = new Date(Date.now() + 65000);
    repository.reserve.mockResolvedValue({ allowed: false, retryAt });
    await expect(processAssessment({ taskId: 'task' })).resolves.toEqual({ retryAt });
    expect(repository.beginAttempt).not.toHaveBeenCalled(); expect(groq.assessCleaning).not.toHaveBeenCalled();
  });
  test('429 queues one retry and then becomes unavailable', async () => {
    groq.assessCleaning.mockRejectedValue(Object.assign(new Error('provider'), { status: 429, retryable: true }));
    expect((await processAssessment({ taskId: 'task' })).retryAt).toBeInstanceOf(Date);
    repository.beginAttempt.mockResolvedValue({ ...task, cleaningAssessment: { attempts: 2 } });
    await expect(processAssessment({ taskId: 'task' })).resolves.toEqual({});
    expect(repository.finish).toHaveBeenLastCalledWith(task, expect.objectContaining({ status: 'Unavailable', reason: 'provider_limit' }));
  });
  test('invalid JSON and authentication failures never invent a score', async () => {
    groq.assessCleaning.mockResolvedValue('not JSON');
    await processAssessment({ taskId: 'task' });
    expect(repository.finish).toHaveBeenLastCalledWith(task, expect.objectContaining({ status: 'Unavailable', score: null }));
    groq.assessCleaning.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    await expect(processAssessment({ taskId: 'task' })).resolves.toEqual({});
  });
});

describe('Safe cleaning photo loading', () => {
  test.each(['http://127.0.0.1/private', 'https://attacker.test/cleaning/a.jpg',
    'https://ik.imagekit.io/audit-tests/cnic/a.jpg', 'https://ik.imagekit.io/audit-tests/cleaning/a.jpg?tr=anything'])('blocks unsupported photo %s without fetching', async (uri) => {
    await expect(actualPhotos.loadPair({ ...task, beforeImageUri: uri })).rejects.toThrow('unsupported_photo');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('requires an upload belonging to the assigned staff account', async () => {
    uploads.ownedPublic.mockResolvedValue(null);
    await expect(actualPhotos.loadPair(task)).rejects.toThrow('unsupported_photo');
    expect(uploads.ownedPublic).toHaveBeenCalledWith('staff', task.beforeImageUri);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('identifies repeated image bytes without blocking appearance scoring', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    global.fetch.mockImplementation(async () => new Response(png));
    expect((await actualPhotos.loadPair(task)).identicalPhotos).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(task.beforeImageUri, expect.objectContaining({ redirect: 'error' }));
  });
  test('the same photo URL is loaded once and marked as repeated evidence', async () => {
    global.fetch.mockResolvedValue(new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    expect((await actualPhotos.loadPair({ ...task, afterImageUri: task.beforeImageUri })).identicalPhotos).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  test('enforces download limits before reading an oversized response', async () => {
    global.fetch.mockResolvedValue(new Response('oversize', { headers: { 'content-length': String(6 * 1024 * 1024) } }));
    await expect(actualPhotos.loadPair(task)).rejects.toThrow('photo_unavailable');
  });
  test('sends only validated image bytes and a content hash onward', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    global.fetch.mockResolvedValueOnce(new Response(Buffer.concat([png, Buffer.from('before')]))).mockResolvedValueOnce(new Response(Buffer.concat([png, Buffer.from('after')])));
    const pair = await actualPhotos.loadPair(task);
    expect(pair.before).toMatch(/^data:image\/png;base64,/); expect(pair.pairHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Groq vision request contract', () => {
  test('uses the vision model, two labelled images and JSON mode, leaving the chatbot model alone', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] })));
    await expect(actualGroq.assessCleaning('data:before', 'data:after')).resolves.toBe('{}');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'qwen/qwen3.8-27b', reasoning_effort: 'none', max_completion_tokens: 1200, response_format: { type: 'json_object' } });
    expect(body.messages[1].content.filter(item => item.type === 'image_url')).toHaveLength(2);
    expect(env.integrations.groq.model).toBe(originalGroq.model);
  });
  test('rejects truncated responses', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })));
    await expect(actualGroq.assessCleaning('before', 'after')).rejects.toThrow('incomplete');
  });
  test('returns safe provider errors without retaining response bodies', async () => {
    global.fetch.mockResolvedValue(new Response('private-response-body', { status: 429 }));
    await expect(actualGroq.assessCleaning('before', 'after')).rejects.toMatchObject({ status: 429, retryable: true, message: 'Groq vision request failed (429).' });
  });
});
