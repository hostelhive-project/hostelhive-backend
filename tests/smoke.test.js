process.env.NODE_ENV = 'test';
const request = require('supertest');
const app = require('../src/app');

describe('Smoke tests (no live DB required)', () => {
  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /api/unknown-route returns 404 via notFound middleware', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/auth/register with invalid body returns 400 (Joi validation, no DB hit)', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toBeDefined();
  });

  test('POST /api/auth/login with invalid body returns 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'x' });
    expect(res.status).toBe(400);
  });

  test('GET /api/users/:id without auth token returns 401', async () => {
    const res = await request(app).get('/api/users/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  test('POST /api/hostels without auth token returns 401 (Admin-only route)', async () => {
    const res = await request(app).post('/api/hostels').send({ name: 'Test' });
    expect(res.status).toBe(401);
  });

  test('GET /api/hostels (public search) does not require auth', async () => {
    // Without a live MongoDB, Mongoose buffers the query for 10s then errors ->
    // 500. That's fine here: the assertion is that we get PAST auth (no 401/403),
    // proving the route is correctly public. With a real MONGO_URI this returns 200.
    const res = await request(app).get('/api/hostels');
    expect([200, 500]).toContain(res.status);
  }, 15000);

  test('GET /api/blockchain/:sourceType/:sourceId/verify without auth returns 401 (real route now, not a stub)', async () => {
    const res = await request(app).get('/api/blockchain/Payment/507f1f77bcf86cd799439011/verify');
    expect(res.status).toBe(401);
  });

  test('GET /api/blockchain/... with a bad auth token still returns 401, not a crash', async () => {
    const res = await request(app)
      .get('/api/blockchain/Complaint/507f1f77bcf86cd799439011/verify')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  // --- New modules this session: Bookings, Invoices, Payments, Complaints, Cleaning Tasks, Reviews, Admin Dashboard ---

  test('POST /api/bookings without auth returns 401 — confirms Bookings is a real route, not the 501 stub', async () => {
    const res = await request(app).post('/api/bookings').send({ roomId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(401);
    expect(res.body.message).not.toMatch(/not implemented yet/);
  });

  test('POST /api/bookings with invalid body returns 400 after auth would be required (validation runs, but auth middleware runs first so still 401)', async () => {
    // auth.middleware runs before validate() on this route, so a missing token still short-circuits at 401
    const res = await request(app).post('/api/bookings').send({});
    expect(res.status).toBe(401);
  });

  test('GET /api/invoices/:id without auth returns 401', async () => {
    const res = await request(app).get('/api/invoices/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  test('POST /api/payments/checkout without auth returns 401', async () => {
    const res = await request(app).post('/api/payments/checkout').send({ invoiceId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(401);
  });

  test('POST /api/payments/webhook with bad signature returns 400, not a crash', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'invalid-signature')
      .send(Buffer.from(JSON.stringify({ type: 'checkout.session.completed' })));
    expect(res.status).toBe(400);
  });

  test('GET /api/hostels/:hostelId/stripe/onboard without auth returns 401', async () => {
    const res = await request(app).get('/api/hostels/507f1f77bcf86cd799439011/stripe/onboard');
    expect(res.status).toBe(401);
  });

  test('POST /api/complaints without auth returns 401', async () => {
    const res = await request(app).post('/api/complaints').send({ description: 'leaky tap', severityTier: 'Low' });
    expect(res.status).toBe(401);
  });

  test('POST /api/complaints with valid-looking auth header format still requires a real user (401, not a crash)', async () => {
    const res = await request(app)
      .post('/api/complaints')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ description: 'leaky tap', severityTier: 'Low' });
    expect(res.status).toBe(401);
  });

  test('POST /api/cleaning-tasks without auth returns 401', async () => {
    const res = await request(app).post('/api/cleaning-tasks').send({});
    expect(res.status).toBe(401);
  });

  test('GET /api/hostels/:id/reviews (public) does not require auth', async () => {
    const res = await request(app).get('/api/hostels/507f1f77bcf86cd799439011/reviews');
    expect([200, 500]).toContain(res.status);
  }, 15000);

  test('POST /api/hostels/:id/reviews without auth returns 401', async () => {
    const res = await request(app).post('/api/hostels/507f1f77bcf86cd799439011/reviews').send({ rating: 5 });
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/dashboard/summary without auth returns 401', async () => {
    const res = await request(app).get('/api/admin/dashboard/summary');
    expect(res.status).toBe(401);
  });

  // --- New this session: Notifications, AI Chatbot (Groq) ---

  test('GET /api/notifications without auth returns 401', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  test('GET /api/notifications/unread-count without auth returns 401', async () => {
    const res = await request(app).get('/api/notifications/unread-count');
    expect(res.status).toBe(401);
  });

  test('PATCH /api/notifications/:id/read without auth returns 401', async () => {
    const res = await request(app).patch('/api/notifications/507f1f77bcf86cd799439011/read');
    expect(res.status).toBe(401);
  });

  test('POST /api/chatbot/message without auth returns 401', async () => {
    const res = await request(app).post('/api/chatbot/message').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  test('POST /api/chatbot/message with invalid body still requires auth first (401)', async () => {
    const res = await request(app).post('/api/chatbot/message').send({});
    expect(res.status).toBe(401);
  });

  test('GET /api/chatbot/history without auth returns 401', async () => {
    const res = await request(app).get('/api/chatbot/history?sessionId=abc');
    expect(res.status).toBe(401);
  });

  test('GET /api/hostels/:hostelId/chatbot-info (public read) does not require auth', async () => {
    const res = await request(app).get('/api/hostels/507f1f77bcf86cd799439011/chatbot-info');
    expect([200, 404, 500]).toContain(res.status);
  }, 15000);

  test('PUT /api/hostels/:hostelId/chatbot-info without auth returns 401 (Admin-only)', async () => {
    const res = await request(app)
      .put('/api/hostels/507f1f77bcf86cd799439011/chatbot-info')
      .send({ wifiPassword: 'test123' });
    expect(res.status).toBe(401);
  });
});
