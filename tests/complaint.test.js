process.env.NODE_ENV = 'test';
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const env = require('../src/config/env');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Hostel = require('../src/models/Hostel');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const Complaint = require('../src/models/Complaint');

describe('Complaint Desk Multi-Hostel Isolation & RBAC Suite', () => {
  let adminAToken, adminBToken, unassignedAdminToken;
  let studentAToken, studentBToken;
  let adminA, adminB, unassignedAdmin;
  let studentA, studentB;
  let staffA, staffB;
  let hostelA, hostelB;
  let roomA, roomB;
  let complaintA, complaintB;
  let legacyComplaint;

  const createToken = (user) =>
    jwt.sign(
      { sub: user._id.toString(), role: user.role },
      env.jwt.secret,
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    await connectDB();

    const timestamp = Date.now();

    // 1. Create Admins
    adminA = await User.create({
      name: `Admin A ${timestamp}`,
      email: `adminA_${timestamp}@hostel.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });

    adminB = await User.create({
      name: `Admin B ${timestamp}`,
      email: `adminB_${timestamp}@hostel.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });

    unassignedAdmin = await User.create({
      name: `Admin NoHostel ${timestamp}`,
      email: `adminNone_${timestamp}@hostel.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });

    // 2. Create Hostels
    hostelA = await Hostel.create({
      name: `Hostel Alpha ${timestamp}`,
      location: 'Lahore North',
      priceTier: 15000,
      ownerAdminId: adminA._id,
    });
    adminA.hostelId = hostelA._id;
    await adminA.save();

    hostelB = await Hostel.create({
      name: `Hostel Beta ${timestamp}`,
      location: 'Lahore South',
      priceTier: 18000,
      ownerAdminId: adminB._id,
    });
    adminB.hostelId = hostelB._id;
    await adminB.save();

    // 3. Create Rooms
    roomA = await Room.create({
      hostelId: hostelA._id,
      roomNumber: 'A-101',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 1,
    });

    roomB = await Room.create({
      hostelId: hostelB._id,
      roomNumber: 'B-201',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 1,
    });

    // 4. Create Students & Bookings
    studentA = await User.create({
      name: `Student A ${timestamp}`,
      email: `studentA_${timestamp}@student.com`,
      passwordHash: 'hash',
      role: 'Student',
      hostelId: hostelA._id,
    });

    await Booking.create({
      studentId: studentA._id,
      roomId: roomA._id,
      status: 'CheckedIn',
    });

    studentB = await User.create({
      name: `Student B ${timestamp}`,
      email: `studentB_${timestamp}@student.com`,
      passwordHash: 'hash',
      role: 'Student',
      hostelId: hostelB._id,
    });

    await Booking.create({
      studentId: studentB._id,
      roomId: roomB._id,
      status: 'CheckedIn',
    });

    // 5. Create Staff
    staffA = await User.create({
      name: `Staff A ${timestamp}`,
      email: `staffA_${timestamp}@staff.com`,
      passwordHash: 'hash',
      role: 'CleaningStaff',
      hostelId: hostelA._id,
    });

    staffB = await User.create({
      name: `Staff B ${timestamp}`,
      email: `staffB_${timestamp}@staff.com`,
      passwordHash: 'hash',
      role: 'CleaningStaff',
      hostelId: hostelB._id,
    });

    // 6. Simulate an untouched old/legacy complaint that has NO hostelId
    legacyComplaint = await mongoose.connection.collection('complaints').insertOne({
      residentId: studentA._id,
      assignedStaffId: null,
      title: 'Old legacy complaint',
      category: 'GENERAL',
      description: 'Pre-existing complaint created without hostelId.',
      severityTier: 'Low',
      status: 'Submitted',
      blockchainRef: null,
      createdAt: new Date('2026-08-01'),
      updatedAt: new Date('2026-08-01'),
    });

    // Sign tokens
    adminAToken = createToken(adminA);
    adminBToken = createToken(adminB);
    unassignedAdminToken = createToken(unassignedAdmin);
    studentAToken = createToken(studentA);
    studentBToken = createToken(studentB);
  });

  afterAll(async () => {
    // Cleanup created test records
    await Complaint.deleteMany({
      _id: { $in: [complaintA?._id, complaintB?._id, legacyComplaint?.insertedId].filter(Boolean) },
    });
    await Booking.deleteMany({ studentId: { $in: [studentA?._id, studentB?._id].filter(Boolean) } });
    await Room.deleteMany({ _id: { $in: [roomA?._id, roomB?._id].filter(Boolean) } });
    await Hostel.deleteMany({ _id: { $in: [hostelA?._id, hostelB?._id].filter(Boolean) } });
    await User.deleteMany({
      _id: { $in: [adminA?._id, adminB?._id, unassignedAdmin?._id, studentA?._id, studentB?._id, staffA?._id, staffB?._id].filter(Boolean) },
    });
    await mongoose.connection.close();
  });

  describe('1. New Complaint Validation & Verification of hostelId', () => {
    test('Student without CheckedIn booking is rejected with 403 Forbidden', async () => {
      const nonResident = await User.create({
        name: 'Non Resident',
        email: `nonresident_${Date.now()}@student.com`,
        passwordHash: 'hash',
        role: 'Student',
      });
      const nonResidentToken = createToken(nonResident);

      const res = await request(app)
        .post('/api/complaints')
        .set('Authorization', `Bearer ${nonResidentToken}`)
        .send({
          title: 'Ceiling Fan making noise',
          category: 'ELECTRICAL',
          description: 'The fan in room A-101 has a loose blade and makes noise at night.',
          severityTier: 'Medium',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Only checked-in residents can file complaints/i);
    });

    test('Submission without description returns 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/complaints')
        .set('Authorization', `Bearer ${studentAToken}`)
        .send({
          title: 'Ceiling Fan making noise',
          category: 'ELECTRICAL',
          severityTier: 'Medium',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('Submission with mismatched/arbitrary hostelId is rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/complaints')
        .set('Authorization', `Bearer ${studentAToken}`)
        .send({
          hostelId: hostelB._id.toString(), // Student A trying to submit against Hostel B
          residentId: studentA._id.toString(),
          title: 'Trying to file against another hostel',
          category: 'ELECTRICAL',
          description: 'Should be rejected by backend verification.',
          severityTier: 'Medium',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/only submit complaints for your assigned hostel/i);
    });

    test('Student A creates complaint with verified hostelId -> saved with hostelA._id', async () => {
      const res = await request(app)
        .post('/api/complaints')
        .set('Authorization', `Bearer ${studentAToken}`)
        .send({
          hostelId: hostelA._id.toString(),
          residentId: studentA._id.toString(),
          title: 'Ceiling Fan making noise',
          category: 'ELECTRICAL',
          description: 'The fan in room A-101 has a loose blade and makes noise at night.',
          severityTier: 'Medium',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hostelId.toString()).toBe(hostelA._id.toString());
      expect(res.body.data.residentId.toString()).toBe(studentA._id.toString());
      expect(res.body.data.title).toBe('Ceiling Fan making noise');
      expect(res.body.data.category).toBe('ELECTRICAL');

      complaintA = res.body.data;
    });

    test('Student B creates complaint with verified hostelId -> saved with hostelB._id', async () => {
      const res = await request(app)
        .post('/api/complaints')
        .set('Authorization', `Bearer ${studentBToken}`)
        .send({
          hostelId: hostelB._id.toString(),
          residentId: studentB._id.toString(),
          title: 'Washroom pipe leakage',
          category: 'PLUMBING',
          description: 'Water leak under the sink in room B-201.',
          severityTier: 'High',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hostelId.toString()).toBe(hostelB._id.toString());
      expect(res.body.data.residentId.toString()).toBe(studentB._id.toString());

      complaintB = res.body.data;
    });
  });

  describe('2. Multi-Hostel Isolation on Complaint Desk Listing (GET /api/complaints)', () => {
    test('Admin A sees ONLY complaints for Hostel A, never complaints from Hostel B or un-scoped old complaints', async () => {
      const res = await request(app)
        .get('/api/complaints')
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const items = res.body.data;
      const ids = items.map((c) => c._id.toString());

      expect(ids).toContain(complaintA._id.toString());
      expect(ids).not.toContain(complaintB._id.toString());
      expect(ids).not.toContain(legacyComplaint.insertedId.toString());

      for (const item of items) {
        const itemHostelId = item.hostelId?._id ? item.hostelId._id.toString() : item.hostelId.toString();
        expect(itemHostelId).toBe(hostelA._id.toString());
      }
    });

    test('Admin B sees ONLY complaints for Hostel B, never complaints from Hostel A or un-scoped old complaints', async () => {
      const res = await request(app)
        .get('/api/complaints')
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const items = res.body.data;
      const ids = items.map((c) => c._id.toString());

      expect(ids).toContain(complaintB._id.toString());
      expect(ids).not.toContain(complaintA._id.toString());
      expect(ids).not.toContain(legacyComplaint.insertedId.toString());

      for (const item of items) {
        const itemHostelId = item.hostelId?._id ? item.hostelId._id.toString() : item.hostelId.toString();
        expect(itemHostelId).toBe(hostelB._id.toString());
      }
    });

    test('Admin with no assigned hostel receives empty array (zero data leak)', async () => {
      const res = await request(app)
        .get('/api/complaints')
        .set('Authorization', `Bearer ${unassignedAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('3. Single-Complaint Retrieval Security (GET /api/complaints/:id)', () => {
    test('Admin A can view Complaint A', async () => {
      const res = await request(app)
        .get(`/api/complaints/${complaintA._id}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(complaintA._id);
    });

    test('Admin A CANNOT view Complaint B (forbidden across hostels)', async () => {
      const res = await request(app)
        .get(`/api/complaints/${complaintB._id}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot view complaints from another hostel/i);
    });

    test('Admin B CANNOT view Complaint A (forbidden across hostels)', async () => {
      const res = await request(app)
        .get(`/api/complaints/${complaintA._id}`)
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot view complaints from another hostel/i);
    });

    test('Admin A CANNOT view un-scoped legacy complaint', async () => {
      const res = await request(app)
        .get(`/api/complaints/${legacyComplaint.insertedId}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('4. Complaint Status and Staff Assignment Protection', () => {
    test('Admin A CANNOT update status of Complaint B', async () => {
      const res = await request(app)
        .patch(`/api/complaints/${complaintB._id}/status`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ status: 'InReview' });

      expect(res.status).toBe(403);
    });

    test('Admin A can update status of Complaint A', async () => {
      const res = await request(app)
        .patch(`/api/complaints/${complaintA._id}/status`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ status: 'InReview' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('InReview');
    });

    test('Admin A CANNOT assign Complaint B', async () => {
      const res = await request(app)
        .patch(`/api/complaints/${complaintB._id}/assign`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ staffId: staffA._id.toString() });

      expect(res.status).toBe(403);
    });

    test('Admin A CANNOT assign Staff B (from Hostel B) to Complaint A', async () => {
      const res = await request(app)
        .patch(`/api/complaints/${complaintA._id}/assign`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ staffId: staffB._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Staff member does not belong to this hostel/i);
    });

    test('Admin A can assign Staff A (from Hostel A) to Complaint A', async () => {
      const res = await request(app)
        .patch(`/api/complaints/${complaintA._id}/assign`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ staffId: staffA._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedStaffId).toBeDefined();
    });
  });
});
