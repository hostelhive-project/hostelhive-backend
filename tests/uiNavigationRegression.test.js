process.env.NODE_ENV = 'test';
const mockSend = jest.fn().mockResolvedValue('test-message');
jest.mock('firebase-admin', () => ({ apps: [{}], messaging: () => ({ send: mockSend }) }));
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Hostel = require('../src/models/Hostel');
const Room = require('../src/models/Room');
const notificationService = require('../src/services/notification.service');
const stripe = require('../src/integrations/stripe');

const database = `hostelhive_ui_navigation_test_${process.pid}_${Date.now()}`;
const token = (user) => jwt.sign({ sub: user.id, role: user.role }, env.jwt.secret, { expiresIn: '1h' });
const auth = (user) => ({ Authorization: `Bearer ${token(user)}` });
let admin;
let other;
let student;
let draft;
let room;
let previousFirebase;

beforeAll(async () => {
  await mongoose.connect(env.mongoUri, { dbName: database, serverSelectionTimeoutMS: 5000 });
  previousFirebase = { ...env.integrations.firebase };
  Object.assign(env.integrations.firebase, { projectId: 'test', clientEmail: 'test@example.com', privateKey: 'test' });
  const createUser = (name, role) => User.create({ name, email: `${name}@example.com`, passwordHash: 'test-hash', role, isActive: true, emailVerified: true });
  admin = await createUser('draft-admin', 'Admin');
  other = await createUser('other-admin', 'Admin');
  student = await createUser('draft-student', 'Student');
}, 15000);

afterAll(async () => {
  Object.assign(env.integrations.firebase, previousFirebase);
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === database && database.startsWith('hostelhive_ui_navigation_test_')) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
afterEach(() => jest.restoreAllMocks());

test('an administrator can create and reload a private draft', async () => {
  const res = await request(app).post('/api/hostels').set(auth(admin)).send({ name: 'Private draft property', location: 'Test city', priceTier: 19000, publicationStatus: 'Draft' });
  expect(res.status).toBe(201);
  draft = res.body.data;
  expect(draft.publicationStatus).toBe('Draft');
  const owner = await request(app).get(`/api/hostels/${draft._id}`).set(auth(admin));
  expect(owner.status).toBe(200);
  expect(owner.body.data.name).toBe('Private draft property');
  room = await Room.create({ hostelId: draft._id, roomNumber: 'D-01', layoutType: 'Single', capacity: 1 });
});

test('drafts are absent from public discovery and direct detail routes', async () => {
  for (const endpoint of ['/api/hostels', '/api/hostels/explore']) {
    const res = await request(app).get(endpoint).query({ q: 'Private draft' });
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body.data) ? res.body.data : res.body.data.items;
    expect(items.some((item) => item._id === draft._id)).toBe(false);
  }
  for (const endpoint of ['', '/rooms', '/room-catalog', '/room-options', '/reviews', '/chatbot-info']) {
    expect((await request(app).get(`/api/hostels/${draft._id}${endpoint}`)).status).toBe(404);
  }
  expect((await request(app).get(`/api/rooms/${room.id}`)).status).toBe(404);
  expect((await request(app).get(`/api/hostels/${draft._id}`).set(auth(other))).status).toBe(404);
});

test('the owner can manage draft rooms, while a student cannot book them', async () => {
  expect((await request(app).get(`/api/hostels/${draft._id}/rooms`).set(auth(admin))).status).toBe(200);
  const booking = await request(app).post('/api/bookings').set(auth(student)).send({ roomId: room.id, emergencyContact: '+923001234567' });
  expect(booking.status).toBe(404);
});

test('publication is authenticated, owner-scoped and cannot be bypassed through property update', async () => {
  expect((await request(app).post(`/api/hostels/${draft._id}/publish`).send({})).status).toBe(401);
  expect((await request(app).post(`/api/hostels/${draft._id}/publish`).set(auth(student)).send({})).status).toBe(403);
  expect((await request(app).post(`/api/hostels/${draft._id}/publish`).set(auth(other)).send({})).status).toBe(403);
  const update = await request(app).put(`/api/hostels/${draft._id}`).set(auth(admin)).send({ publicationStatus: 'Published' });
  expect(update.status).toBe(400);
  const published = await request(app).post(`/api/hostels/${draft._id}/publish`).set(auth(admin)).send({});
  expect(published.status).toBe(200);
  expect(published.body.data.publicationStatus).toBe('Published');
  expect((await request(app).get(`/api/hostels/${draft._id}`)).status).toBe(200);
  expect((await request(app).get(`/api/rooms/${room.id}`)).status).toBe(200);
});

test('old records without publication status remain discoverable', async () => {
  const record = await Hostel.create({ name: 'Legacy public', location: 'Test city', priceTier: 10000, hostelCode: 'LGC', ownerAdminId: other.id });
  await Hostel.collection.updateOne({ _id: record._id }, { $unset: { publicationStatus: '' } });
  expect((await request(app).get(`/api/hostels/${record.id}`)).status).toBe(200);
});

test('a zero-priced room keeps the advertised rent in the booking snapshot', async () => {
  const freeRoom = await Room.create({ hostelId: draft._id, roomNumber: 'FREE-01', layoutType: 'Single', capacity: 1, monthlyRent: 0 });
  const booking = await request(app).post('/api/bookings').set(auth(student)).send({ roomId: freeRoom.id, emergencyContact: '+923001234567' });
  expect(booking.status).toBe(201);
  expect(booking.body.data.monthlyRent).toBe(0);
});

test('push notifications include string-valued identity and routing data', async () => {
  await User.updateOne({ _id: student.id }, { $set: { deviceToken: 'test-device-token' } });
  const related = new mongoose.Types.ObjectId();
  const notification = await notificationService.notify({ userId: student.id, type: 'ComplaintUpdate', title: 'Assigned update', body: 'Test only', relatedEntityId: related });
  await Promise.resolve();
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
    token: 'test-device-token', notification: { title: 'Assigned update', body: 'Test only' },
    data: { notificationId: notification.id, userId: student.id, type: 'ComplaintUpdate', relatedEntityId: related.toString() },
  }));
});

test('Stripe return URLs retain existing query parameters and exact invoice/booking context', async () => {
  const previous = { success: env.integrations.stripe.successUrl, cancel: env.integrations.stripe.cancelUrl };
  env.integrations.stripe.successUrl = 'hostelhive://payments/success?source=app';
  env.integrations.stripe.cancelUrl = 'hostelhive://payments/cancel';
  const client = stripe.getStripeClient();
  const create = jest.spyOn(client.checkout.sessions, 'create').mockResolvedValue({ id: 'test-checkout', url: 'https://example.com/checkout' });
  try {
    await stripe.createCheckoutSession({ invoiceId: 'invoice-123', bookingId: 'booking-456', unitAmountCents: 100 });
    const payload = create.mock.calls[0][0];
    const success = new URL(payload.success_url);
    expect(success.searchParams.get('source')).toBe('app');
    expect(success.searchParams.get('invoiceId')).toBe('invoice-123');
    expect(success.searchParams.get('bookingId')).toBe('booking-456');
    expect(payload.success_url).toContain('{CHECKOUT_SESSION_ID}');
    expect(new URL(payload.cancel_url).searchParams.get('invoiceId')).toBe('invoice-123');
  } finally {
    env.integrations.stripe.successUrl = previous.success; env.integrations.stripe.cancelUrl = previous.cancel;
  }
});
