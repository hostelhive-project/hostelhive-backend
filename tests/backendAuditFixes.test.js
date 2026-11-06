const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const env = require('../src/config/env');
const { User, Hostel, Room, Booking, Invoice, Payment, Complaint } = Object.fromEntries(
  ['User', 'Hostel', 'Room', 'Booking', 'Invoice', 'Payment', 'Complaint'].map(name => [name, require(`../src/models/${name}`)])
);
const OutboxEvent = require('../src/models/OutboxEvent');
const auth = require('../src/services/auth.service');
const bookings = require('../src/services/booking.service');
const invoices = require('../src/services/invoice.service');
const payments = require('../src/services/payment.service');
const audit = require('../src/services/blockchain.service');
const email = require('../src/integrations/email');
const data = require('../src/repositories/data.repository');
const database = process.env.TEST_DATABASE_NAME;
let sequence = 0;
const token = (user) => jwt.sign({ sub: user.id, role: user.role, ver: user.sessionVersion || 0 }, env.jwt.secret);
const header = (user) => ({ Authorization: `Bearer ${token(user)}` });
const viewer = (user) => ({ id: user.id, role: user.role, hostelId: user.hostelId?.toString() });
const user = async (role = 'Student', extra = {}) => User.create({ name: 'Audit user', email: `audit-${++sequence}@example.com`,
  passwordHash: await bcrypt.hash('AuditPassword123!', 4), role, isActive: true, emailVerified: true, ...extra });
async function property() {
  const admin = await user('Admin');
  const hostel = await Hostel.create({ name: `Audit property ${++sequence}`, location: 'Test city', ownerAdminId: admin._id, priceTier: 19000 });
  admin.hostelId = hostel._id; await admin.save();
  const room = await Room.create({ hostelId: hostel._id, roomNumber: '101', layoutType: 'Shared-4', capacity: 4, monthlyRent: 2000 });
  return { admin, hostel, room };
}
async function stay({ checkedIn = false, rent = 2000 } = {}) {
  const context = await property();
  const student = await user();
  const booking = await Booking.create({ studentId: student._id, roomId: context.room._id, monthlyRent: rent,
    status: checkedIn ? 'CheckedIn' : 'Approved', checkedInAt: checkedIn ? new Date() : null });
  await Room.updateOne({ _id: context.room._id }, { $set: { occupiedCount: 1 } });
  return { ...context, student, booking };
}
async function billing() {
  const context = await stay({ checkedIn: true });
  const invoice = await Invoice.create({ bookingId: context.booking._id, billingMonth: '2026-11', rentAmount: 2000, dueDate: new Date(Date.now() + 86400000) });
  const payment = await Payment.create({ invoiceId: invoice._id, hostelId: context.hostel._id, amount: 2000,
    transactionReference: `cs_audit_${++sequence}`, paymentStatus: 'Processing', chargedAmountCents: 714, chargedCurrency: 'usd' });
  const checkout = { id: payment.transactionReference, payment_status: 'paid', amount_total: 714, currency: 'usd',
    payment_intent: `pi_audit_${sequence}`, metadata: { paymentId: payment.id, invoiceId: invoice.id } };
  return { ...context, invoice, payment, checkout };
}

beforeAll(async () => {
  if (!/^hostelhive_test_/.test(database)) throw new Error('Refusing non-test database.');
  await mongoose.connect(env.mongoUri, { dbName: database, serverSelectionTimeoutMS: 5000 });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  if (mongoose.connection.name === database && database.startsWith('hostelhive_test_')) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('re-registration replaces the password together with its OTP challenge', async () => {
  const address = `pending-${++sequence}@example.com`;
  await auth.register({ name: 'Earlier request', email: address, password: 'EarlierPassword!', role: 'Student', termsAccepted: true });
  const oldCode = email.sendOtpEmail.mock.calls.at(-1)[1];
  await auth.register({ name: 'Email owner', email: address, password: 'OwnerPassword!', role: 'Student', termsAccepted: true });
  const newCode = email.sendOtpEmail.mock.calls.at(-1)[1];
  if (oldCode !== newCode) await expect(auth.verifyEmail({ email: address, otp: oldCode })).rejects.toMatchObject({ statusCode: 400 });
  const result = await auth.verifyEmail({ email: address, otp: newCode });
  expect(result.user.name).toBe('Email owner');
  await expect(auth.login({ email: address, password: 'EarlierPassword!' })).rejects.toMatchObject({ statusCode: 401 });
  expect((await auth.login({ email: address, password: 'OwnerPassword!' })).tokens.accessToken).toBeTruthy();
});

test('refresh rotates once; a password change revokes access and refresh tokens', async () => {
  const student = await user();
  const first = await auth.login({ email: student.email, password: 'AuditPassword123!' });
  const second = await auth.refresh(first.tokens.refreshToken);
  await expect(auth.refresh(first.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  await auth.changePassword({ userId: student.id, currentPassword: 'AuditPassword123!', newPassword: 'UpdatedPassword123!' });
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${second.accessToken}`)).status).toBe(401);
  await expect(auth.refresh(second.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
});

test('logout revokes the server-side session and clears the push device token', async () => {
  const student = await user('Student', { deviceToken: 'test-device' });
  const session = await auth.login({ email: student.email, password: 'AuditPassword123!' });
  await auth.logout(student.id);
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.tokens.accessToken}`)).status).toBe(401);
  expect((await User.findById(student.id)).deviceToken).toBeNull();
});

test('a reset OTP is consumed atomically under simultaneous submissions', async () => {
  const student = await user();
  await auth.requestPasswordReset({ email: student.email });
  const otp = email.sendOtpEmail.mock.calls.at(-1)[1];
  const results = await Promise.allSettled([auth.resetPassword({ email: student.email, otp, newPassword: 'ResetPassword1!' }),
    auth.resetPassword({ email: student.email, otp, newPassword: 'ResetPassword2!' })]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
});

test('parallel booking requests admit only one active stay for a student', async () => {
  const { room } = await property();
  const student = await user();
  const payload = { studentId: student.id, roomId: room.id, emergencyContact: '+923001234567' };
  const results = await Promise.allSettled([bookings.requestBooking(payload), bookings.requestBooking(payload)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await Booking.countDocuments({ studentId: student._id })).toBe(1);
});

test('duplicate approval does not reserve two beds', async () => {
  const { room } = await property(); const student = await user();
  const booking = await Booking.create({ studentId: student._id, roomId: room._id, status: 'Pending', monthlyRent: 2000 });
  const results = await Promise.allSettled([bookings.approve(booking.id), bookings.approve(booking.id)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await Room.findById(room.id)).occupiedCount).toBe(1);
});

test('approval rollback restores occupancy when the booking save fails', async () => {
  const { room } = await property(); const student = await user();
  const booking = await Booking.create({ studentId: student._id, roomId: room._id, status: 'Pending', monthlyRent: 2000 });
  jest.spyOn(data, 'save').mockRejectedValueOnce(new Error('Injected booking write failure'));
  await expect(bookings.approve(booking.id)).rejects.toThrow('Injected');
  expect((await Room.findById(room.id)).occupiedCount).toBe(0);
  expect((await Booking.findById(booking.id)).status).toBe('Pending');
});

test('locked rooms reject pending approvals and cancellation preserves manual locks', async () => {
  const context = await stay();
  await require('../src/services/room.service').updateStatus(context.room.id, { isLocked: true });
  const other = await user();
  const pending = await Booking.create({ studentId: other._id, roomId: context.room._id, status: 'Pending' });
  await expect(bookings.approve(pending.id)).rejects.toMatchObject({ statusCode: 409 });
  await bookings.cancelByStudent(context.booking.id, context.student.id);
  const room = await Room.findById(context.room.id);
  expect(room.occupiedCount).toBe(0); expect(room.isLocked).toBe(true);
});

test('concurrent cancellation releases one reservation only', async () => {
  const { room, booking, student } = await stay();
  await Room.updateOne({ _id: room.id }, { $set: { occupiedCount: 2 } });
  await Promise.allSettled([bookings.cancelByStudent(booking.id, student.id), bookings.cancelByStudent(booking.id, student.id)]);
  expect((await Room.findById(room.id)).occupiedCount).toBe(1);
});

test('zero booking rent remains zero during invoice generation', async () => {
  const { booking } = await stay({ checkedIn: true, rent: 0 });
  const invoice = await invoices.generateForBooking(booking.id);
  expect(invoice.totalDue).toBe(0); expect(invoice.status).toBe('Paid');
});

test('historical bookings prevent room and hostel deletion', async () => {
  const context = await stay({ checkedIn: true });
  await Booking.updateOne({ _id: context.booking.id }, { $set: { status: 'CheckedOut' } });
  await Room.updateOne({ _id: context.room.id }, { $set: { occupiedCount: 0 } });
  await expect(require('../src/services/room.service').remove(context.room.id)).rejects.toMatchObject({ statusCode: 409 });
  await expect(require('../src/services/hostel.service').remove(context.hostel.id)).rejects.toMatchObject({ statusCode: 409 });
  expect(await Room.exists({ _id: context.room.id })).toBeTruthy();
});

test('Admin profiles and unassigned complaint details are scoped', async () => {
  const { admin, hostel, room } = await property(); const secondAdmin = await user('Admin');
  expect((await request(app).get(`/api/users/${secondAdmin.id}`).set(header(admin))).status).toBe(403);
  const staff = await user('CleaningStaff', { hostelId: hostel._id }); const resident = await user();
  const complaint = await Complaint.create({ residentId: resident._id, hostelId: hostel._id, roomId: room._id, description: 'Private issue', severityTier: 'High' });
  expect((await request(app).get(`/api/complaints/${complaint.id}`).set(header(staff))).status).toBe(403);
  await Complaint.updateOne({ _id: complaint.id }, { $set: { assignedStaffId: staff._id } });
  expect((await request(app).get(`/api/complaints/${complaint.id}`).set(header(staff))).status).toBe(200);
});

test('Admin invoice list resolves bookingId and maintains overdue status', async () => {
  const { admin, booking } = await stay({ checkedIn: true });
  const invoice = await Invoice.create({ bookingId: booking._id, billingMonth: '2026-10', rentAmount: 2000, dueDate: new Date(Date.now() - 86400000) });
  const response = await request(app).get(`/api/invoices/booking/${booking.id}`).set(header(admin));
  expect(response.status).toBe(200);
  expect(response.body.data.find(item => item._id === invoice.id).status).toBe('Overdue');
});

test('settlement is atomic and concurrent retries enqueue each side effect once', async () => {
  const { invoice, payment, checkout } = await billing();
  await Promise.all([payments.settleFromWebhookSession(checkout), payments.settleFromWebhookSession(checkout)]);
  expect((await Payment.findById(payment.id)).paymentStatus).toBe('Paid');
  expect((await Invoice.findById(invoice.id)).status).toBe('Paid');
  expect(await OutboxEvent.countDocuments({ _id: `anchor:Payment:${payment.id}` })).toBe(1);
  expect(await OutboxEvent.countDocuments({ _id: `payment-notification:${payment.id}` })).toBe(1);
});

test('settlement rolls back a payment when invoice persistence fails and repairs legacy partial settlement', async () => {
  const { invoice, payment, checkout } = await billing();
  jest.spyOn(Invoice.prototype, 'save').mockRejectedValueOnce(new Error('Injected invoice failure'));
  await expect(payments.settleFromWebhookSession(checkout)).rejects.toThrow('Injected');
  expect((await Payment.findById(payment.id)).paymentStatus).toBe('Processing');
  jest.restoreAllMocks();
  await Payment.updateOne({ _id: payment.id }, { $set: { paymentStatus: 'Paid' } });
  await payments.settleFromWebhookSession(checkout);
  expect((await Invoice.findById(invoice.id)).status).toBe('Paid');
});

test('offline settlement records the actor and appears in collected-rent totals', async () => {
  const { admin, hostel, booking } = await stay({ checkedIn: true });
  const invoice = await Invoice.create({ bookingId: booking._id, billingMonth: '2026-11', rentAmount: 2000, dueDate: new Date() });
  await invoices.markInvoiceStatus(invoice.id, 'Paid', admin.id, { paymentMethod: 'Cash' });
  const payment = await Payment.findOne({ invoiceId: invoice.id });
  expect(String(payment.recordedBy)).toBe(admin.id); expect(payment.paymentMethod).toBe('Cash');
  expect((await require('../src/services/adminDashboard.service').getSummary(hostel.id)).rentCollectedThisMonth).toBe(2000);
});

test('PaymentIntent decline is linked by paymentId and leaves checkout resumable', async () => {
  const { payment } = await billing();
  await payments.recordPaymentIntentFailure({ id: 'pi_declined', metadata: { paymentId: payment.id }, last_payment_error: { code: 'card_declined' } });
  const updated = await Payment.findById(payment.id);
  expect(updated.paymentIntentId).toBe('pi_declined'); expect(updated.lastFailureCode).toBe('card_declined');
  expect(updated.paymentStatus).toBe('Processing');
});

test('Critical creation queues an anchor before any status change', async () => {
  const { student } = await stay({ checkedIn: true });
  const complaint = await require('../src/services/complaint.service').create({ description: 'Critical issue', severityTier: 'Critical' }, student.id);
  expect(await OutboxEvent.exists({ _id: `anchor:Complaint:${complaint.id}` })).toBeTruthy();
});

test('verification enforces source access and detects source changes without claiming simulated data is on-chain', async () => {
  const { payment, student, checkout } = await billing(); const other = await user();
  await payments.settleFromWebhookSession(checkout);
  await audit.anchor({ sourceType: 'Payment', sourceId: payment.id });
  await expect(audit.verify('Payment', payment.id, viewer(other))).rejects.toMatchObject({ statusCode: 403 });
  const proof = await audit.verify('Payment', payment.id, viewer(student));
  expect(proof.sourceMatches).toBe(true); expect(proof.onChainVerified).toBe(false); expect(proof.verificationState).toBe('Simulated');
  await Payment.updateOne({ _id: payment.id }, { $set: { amount: 2001 } });
  expect((await audit.verify('Payment', payment.id, viewer(student))).sourceMatches).toBe(false);
});

test('staff removal refuses unfinished assigned complaints', async () => {
  const { admin, hostel, room } = await property(); const student = await user();
  const staff = await user('CleaningStaff', { hostelId: hostel._id });
  await Complaint.create({ residentId: student._id, hostelId: hostel._id, roomId: room._id, assignedStaffId: staff._id, severityTier: 'High', description: 'Unfinished repair', status: 'InReview' });
  await expect(require('../src/services/user.service').deleteStaff(viewer(admin), staff.id)).rejects.toMatchObject({ statusCode: 409 });
  expect((await User.findById(staff.id)).isActive).toBe(true);
});

test('refund reconciliation is cumulative/idempotent and adjusts collected rent', async () => {
  const { payment, checkout, hostel, student, invoice } = await billing();
  await payments.settleFromWebhookSession(checkout);
  const adjustment = require('../src/repositories/paymentAdjustment.repository');
  const charge = { payment_intent: checkout.payment_intent, amount: 714, amount_refunded: 357, metadata: { paymentId: payment.id } };
  await adjustment.record(charge, null); await adjustment.record(charge, null);
  expect((await Payment.findById(payment.id)).refundedAmount).toBe(1000);
  expect((await require('../src/services/adminDashboard.service').getSummary(hostel.id)).rentCollectedThisMonth).toBe(1000);
  expect((await invoices.getReceipt(invoice.id, viewer(student))).totalPaid).toBe(1000);
  await adjustment.record({ ...charge, amount_refunded: 714 }, null);
  await expect(invoices.getReceipt(invoice.id, viewer(student))).rejects.toMatchObject({ statusCode: 409 });
});

test('upload sniffing rejects spoofed files and private documents are owned and signed', async () => {
  const service = require('../src/services/upload.service'); const integration = require('../src/integrations/imagekit');
  const student = await user(); const other = await user();
  await expect(service.upload({ buffer: Buffer.from('<html>not an image</html>'), originalname: 'photo.jpg' }, viewer(student), '/cnic')).rejects.toMatchObject({ statusCode: 400 });
  const client = { upload: jest.fn().mockResolvedValue({ url: `${env.integrations.imagekit.urlEndpoint}/cnic/${student.id}/proof.png`, fileId: `private-${++sequence}`, name: 'proof.png' }),
    url: jest.fn(({ src }) => src + '?ik-s=test-signature&ik-t=1234567890') };
  jest.spyOn(integration, 'getImageKitClient').mockReturnValue(client);
  const file = { buffer: Buffer.from([137,80,78,71,13,10,26,10]), originalname: 'spoof.html', size: 8 };
  const result = await service.upload(file, viewer(student), '/cnic');
  expect(client.upload).toHaveBeenCalledWith(expect.objectContaining({ isPrivateFile: true, fileName: expect.stringMatching(/\.png$/) }));
  expect(result.url).toContain('ik-s=');
  expect(await service.resolveOwnedDocument(student.id, result.url)).toContain(`/cnic/${student.id}/`);
  await expect(service.resolveOwnedDocument(other.id, result.url)).rejects.toMatchObject({ statusCode: 400 });
});

test('production upload misconfiguration fails instead of manufacturing a successful URL', async () => {
  const integration = require('../src/integrations/imagekit');
  jest.spyOn(integration, 'getImageKitClient').mockReturnValue(null);
  const previous = env.nodeEnv; env.nodeEnv = 'production';
  try { await expect(integration.uploadToImageKit({ fileBuffer: Buffer.from([137,80,78,71,13,10,26,10]), fileName: 'image.png' })).rejects.toMatchObject({ statusCode: 503 }); }
  finally { env.nodeEnv = previous; }
});

test('a signed Stripe webhook settles once and rejects a changed signature', async () => {
  const { invoice, checkout } = await billing();
  const stripe = require('../src/integrations/stripe').getStripeClient();
  const previous = env.integrations.stripe.webhookSecret;
  const secret = 'whsec_local_audit_fixture';
  env.integrations.stripe.webhookSecret = secret;
  try {
    const payload = JSON.stringify({ id: `evt_audit_${++sequence}`, type: 'checkout.session.completed', data: { object: checkout } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const send = value => request(app).post('/api/payments/webhook').set('Content-Type', 'application/json')
      .set('stripe-signature', value).send(payload);
    expect((await send(signature)).status).toBe(200);
    expect((await send(signature)).status).toBe(200);
    expect((await Invoice.findById(invoice.id)).status).toBe('Paid');
    expect((await send(signature + 'invalid')).status).toBe(400);
  } finally { env.integrations.stripe.webhookSecret = previous; }
});

test('unpaid Checkout Sessions and incorrect amounts cannot settle an invoice', async () => {
  const { checkout, invoice } = await billing();
  expect(await payments.settleFromWebhookSession({ ...checkout, payment_status: 'unpaid' })).toBeNull();
  await expect(payments.settleFromWebhookSession({ ...checkout, amount_total: 715 })).rejects.toMatchObject({ statusCode: 409 });
  expect((await Invoice.findById(invoice.id)).status).toBe('Unpaid');
});

test('expired outbox claims recover and a stale worker cannot overwrite the new claim', async () => {
  const repository = require('../src/repositories/outbox.repository');
  const id = `test-recovery-${++sequence}`;
  // Earlier tests intentionally leave real jobs pending. Keep this fixture first.
  await OutboxEvent.create({ _id: id, kind: 'Notification', payload: {}, status: 'Processing',
    nextAttemptAt: new Date(0), leaseUntil: new Date(0), claimToken: 'expired-worker' });
  const job = await repository.claim();
  expect(job.id).toBe(id);
  expect((await repository.complete({ _id: id, claimToken: 'expired-worker' })).modifiedCount).toBe(0);
  await repository.retry(job, new Error('Transient delivery failure'));
  expect((await OutboxEvent.findById(id)).status).toBe('Pending');
  await OutboxEvent.updateOne({ _id: id }, { $set: { nextAttemptAt: new Date(0) } });
  const reclaimed = await repository.claim();
  expect(reclaimed.attempts).toBe(2);
  await repository.complete(reclaimed);
  expect((await OutboxEvent.findById(id)).status).toBe('Completed');
});

test('notification retries retain one inbox entry', async () => {
  const student = await user();
  const notify = require('../src/services/notification.service').notify;
  const payload = { userId: student.id, type: 'Announcement', title: 'One delivery', body: 'Retry fixture', deliveryKey: `delivery-${++sequence}` };
  await notify(payload); await notify(payload);
  expect(await require('../src/models/Notification').countDocuments({ deliveryKey: payload.deliveryKey })).toBe(1);
});

test('refunds after a lost dispute do not deduct the payment twice', async () => {
  const { payment, checkout, hostel } = await billing();
  await payments.settleFromWebhookSession(checkout);
  const repository = require('../src/repositories/paymentAdjustment.repository');
  const charge = { payment_intent: checkout.payment_intent, amount: 714, amount_refunded: 0, metadata: { paymentId: payment.id } };
  await repository.record(charge, { id: `dp_${++sequence}`, status: 'lost', amount: 714 });
  await repository.record({ ...charge, amount_refunded: 357 }, null);
  const updated = await Payment.findById(payment.id);
  expect(updated.refundedAmount + updated.disputeLossAmount).toBe(2000);
  expect((await require('../src/services/adminDashboard.service').getSummary(hostel.id)).rentCollectedThisMonth).toBe(0);
});

test('winning a dispute restores the amount without undoing a refund', async () => {
  const { payment, checkout, hostel } = await billing();
  await payments.settleFromWebhookSession(checkout);
  const repository = require('../src/repositories/paymentAdjustment.repository');
  const charge = { payment_intent: checkout.payment_intent, amount: 714, amount_refunded: 357, metadata: { paymentId: payment.id } };
  const dispute = { id: `dp_${++sequence}`, status: 'lost', amount: 714 };
  await repository.record(charge, dispute);
  await repository.record(charge, { ...dispute, status: 'won' });
  await repository.record(charge, { ...dispute, status: 'won' });
  expect((await Payment.findById(payment.id)).disputeLossAmount).toBe(0);
  expect((await require('../src/services/adminDashboard.service').getSummary(hostel.id)).rentCollectedThisMonth).toBe(1000);
});

test('staff removal racing assignment cannot leave unfinished work on inactive staff', async () => {
  const { admin, hostel, room } = await property();
  const staff = await user('CleaningStaff', { hostelId: hostel._id });
  const outcomes = await Promise.allSettled([
    require('../src/services/user.service').deleteStaff(viewer(admin), staff.id),
    require('../src/services/cleaningTask.service').assign({ roomId: room.id, assignedStaffId: staff.id, taskType: 'Routine', scheduledTime: new Date() }, viewer(admin)),
  ]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const updated = await User.findById(staff.id);
  const tasks = await require('../src/models/CleaningTask').countDocuments({ assignedStaffId: staff.id });
  expect(updated.isActive || tasks === 0).toBe(true);
});

test('check-in generates the first invoice automatically', async () => {
  const { booking } = await stay();
  await bookings.checkIn(booking.id);
  expect(await Invoice.countDocuments({ bookingId: booking.id })).toBe(1);
});

test('billing catches up known missed months once and skips undated historical checkouts', async () => {
  const { booking } = await stay({ checkedIn: true });
  const previous = new Date(); previous.setUTCMonth(previous.getUTCMonth() - 1, 10);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' }).format(previous);
  const state = require('../src/models/BillingState');
  await state.findByIdAndUpdate('monthly', { $set: { enabledFrom: month } }, { upsert: true });
  await Booking.updateOne({ _id: booking.id }, { $set: { checkedInAt: previous } });
  await invoices.reconcileBilling(); await invoices.reconcileBilling();
  expect(await Invoice.countDocuments({ bookingId: booking.id })).toBe(2);
  await Booking.updateOne({ _id: booking.id }, { $set: { status: 'CheckedOut', checkedOutAt: null } });
  await Invoice.deleteMany({ bookingId: booking.id });
  await invoices.reconcileBilling();
  expect(await Invoice.countDocuments({ bookingId: booking.id })).toBe(0);
});

test('login throttling is account-specific and does not expose database error details', async () => {
  const student = await user();
  for (let index = 0; index < 15; index++) {
    expect((await request(app).post('/api/auth/login').send({ email: student.email, password: 'WrongPassword!' })).status).toBe(401);
  }
  expect((await request(app).post('/api/auth/login').send({ email: student.email.toUpperCase(), password: 'WrongPassword!' })).status).toBe(429);
  const other = await user();
  expect((await request(app).post('/api/auth/login').send({ email: other.email, password: 'AuditPassword123!' })).status).toBe(200);
  const errorHandler = require('../src/middleware/errorHandler');
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  errorHandler(new Error('private-provider-token'), { method: 'POST', originalUrl: '/fixture' }, res, () => {});
  expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('private-provider-token');
});
