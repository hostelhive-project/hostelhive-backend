process.env.NODE_ENV = 'test';
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Hostel = require('../src/models/Hostel');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const {
  isValidPhone,
  normalizePhoneToE164,
  phoneJoiRule,
} = require('../src/validators/phone.validator');

const createToken = (user) =>
  jwt.sign(
    { sub: user._id.toString(), role: user.role },
    env.jwt.secret,
    { expiresIn: '1h' }
  );

describe('Phone Validation & E.164 Normalization Suite', () => {
  let student = null;
  let studentToken = null;
  let admin = null;
  let adminToken = null;
  let testHostel = null;
  let testRoom = null;

  beforeAll(async () => {
    await connectDB();
    const ts = Date.now();

    admin = await User.create({
      name: `Phone Admin ${ts}`,
      email: `phone_admin_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Admin',
      phone: '+923001234567',
    });
    adminToken = createToken(admin);

    testHostel = await Hostel.create({
      name: `Phone Hostel ${ts}`,
      hostelCode: `PHN${ts.toString().slice(-3)}`,
      location: 'Lahore',
      priceTier: 15000,
      ownerAdminId: admin._id,
    });
    admin.hostelId = testHostel._id;
    await admin.save();

    testRoom = await Room.create({
      hostelId: testHostel._id,
      roomNumber: 'P-101',
      layoutType: 'Single',
      capacity: 2,
      occupiedCount: 0,
      isLocked: false,
    });

    student = await User.create({
      name: `Phone Student ${ts}`,
      email: `phone_student_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
      phone: '+923012345678',
    });
    studentToken = createToken(student);
  });

  afterAll(async () => {
    if (student) await User.deleteOne({ _id: student._id });
    if (admin) await User.deleteOne({ _id: admin._id });
    if (testRoom) await Room.deleteOne({ _id: testRoom._id });
    if (testHostel) await Hostel.deleteOne({ _id: testHostel._id });
    await Booking.deleteMany({ roomId: testRoom?._id });
    await mongoose.connection.close();
  });

  describe('1. Phone Utility Functions', () => {
    test('Validates and normalizes Pakistan numbers', () => {
      expect(isValidPhone('3012345678', 'PK')).toBe(true);
      expect(normalizePhoneToE164('3012345678', 'PK')).toBe('+923012345678');

      expect(isValidPhone('03012345678', 'PK')).toBe(true);
      expect(normalizePhoneToE164('03012345678', 'PK')).toBe('+923012345678');

      expect(isValidPhone('+923012345678', 'PK')).toBe(true);
      expect(normalizePhoneToE164('+923012345678', 'PK')).toBe('+923012345678');
    });

    test('Rejects invalid phone numbers', () => {
      expect(isValidPhone('0331', 'PK')).toBe(false);
      expect(isValidPhone('123', 'PK')).toBe(false);
      expect(isValidPhone('abcdefgh', 'PK')).toBe(false);
      expect(isValidPhone('', 'PK')).toBe(false);
    });

    test('Validates other countries', () => {
      // Saudi Arabia
      expect(isValidPhone('+966501234567')).toBe(true);
      expect(normalizePhoneToE164('+966501234567')).toBe('+966501234567');

      // United Kingdom
      expect(isValidPhone('+447911123456')).toBe(true);
      expect(normalizePhoneToE164('+447911123456')).toBe('+447911123456');

      // United States
      expect(isValidPhone('+12025550123')).toBe(true);
      expect(normalizePhoneToE164('+12025550123')).toBe('+12025550123');
    });
  });

  describe('2. Registration Endpoint Phone Validation', () => {
    test('Register with valid Pakistan phone succeeds and normalizes to E.164', async () => {
      const email = `reg_valid_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Valid Phone Student',
          termsAccepted: true,
          email,
          password: 'Password123!',
          phone: '03012345678',
        });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(email.toLowerCase());
      expect(res.body.data.requiresEmailVerification).toBe(true);

      // Cleanup
      await User.deleteOne({ email });
    });

    test('Register with invalid phone (0331) is blocked by backend validator with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Invalid Phone Student',
          termsAccepted: true,
          email: `reg_invalid_${Date.now()}@test.com`,
          password: 'Password123!',
          phone: '0331',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/valid phone number/i);
    });

    test('Register with non-numeric phone (abcdefgh) is blocked with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Alphabet Phone Student',
          termsAccepted: true,
          email: `reg_alpha_${Date.now()}@test.com`,
          password: 'Password123!',
          phone: 'abcdefgh',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. User Profile Update Phone Validation', () => {
    test('PUT /api/users/:id with valid phone normalizes and updates user', async () => {
      const res = await request(app)
        .put(`/api/users/${student._id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          phone: '3029876543',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBe('+923029876543');
    });

    test('PUT /api/users/:id with invalid phone (123) is rejected with 400', async () => {
      const res = await request(app)
        .put(`/api/users/${student._id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          phone: '123',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Booking Emergency Contact Validation', () => {
    test('POST /api/bookings with invalid emergencyContact (0331) is blocked with 400', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          roomId: testRoom._id.toString(),
          emergencyContact: '0331',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/valid emergency contact/i);
    });

    test('POST /api/bookings with valid emergencyContact succeeds and stores E.164', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          roomId: testRoom._id.toString(),
          emergencyContact: '03219876543',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.emergencyContact).toBe('+923219876543');

      // Cleanup booking
      await Booking.deleteOne({ _id: res.body.data._id });
    });
  });

  describe('5. Hostel Reception Contact & Chatbot Emergency Contact Validation', () => {
    test('PUT /api/hostels/:id with invalid receptionContact (0331) is rejected with 400', async () => {
      const res = await request(app)
        .put(`/api/hostels/${testHostel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          propertyInfo: {
            receptionContact: '0331',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/valid phone number/i);
    });

    test('PUT /api/hostels/:id with valid receptionContact normalizes and updates', async () => {
      const res = await request(app)
        .put(`/api/hostels/${testHostel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          propertyInfo: {
            receptionContact: '03001234567',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.propertyInfo.receptionContact).toBe('+923001234567');
    });

    test('PUT /api/hostels/:id/chatbot-info with invalid emergencyContact (0331) is rejected with 400', async () => {
      const res = await request(app)
        .put(`/api/hostels/${testHostel._id}/chatbot-info`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          emergencyContact: '0331',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/valid phone number/i);
    });

    test('PUT /api/hostels/:id/chatbot-info with valid emergencyContact normalizes and updates', async () => {
      const res = await request(app)
        .put(`/api/hostels/${testHostel._id}/chatbot-info`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          emergencyContact: '03007654321',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.emergencyContact).toBe('+923007654321');
    });
  });
});
