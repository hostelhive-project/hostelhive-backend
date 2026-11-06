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
const CleaningTask = require('../src/models/CleaningTask');
const Notification = require('../src/models/Notification');

describe('CleaningTask Workflow & Before Photo Verification Suite', () => {
  let cleanerAToken, cleanerBToken, studentToken, adminToken;
  let cleanerA, cleanerB, student, admin;
  let hostel;
  let room;
  let taskA, taskB, taskDelayedWithPhoto, taskDelayedWithoutPhoto;

  const createToken = (user) =>
    jwt.sign(
      { sub: user._id.toString(), role: user.role },
      env.jwt.secret,
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    await connectDB();

    const timestamp = Date.now();

    admin = await User.create({
      name: `Admin ${timestamp}`,
      email: `admin_${timestamp}@test.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });

    hostel = await Hostel.create({
      name: `Clean Hostel ${timestamp}`,
      location: 'Lahore Model Town',
      priceTier: 15000,
      ownerAdminId: admin._id,
    });

    admin.hostelId = hostel._id;
    await admin.save();

    room = await Room.create({
      hostelId: hostel._id,
      roomNumber: `R-${timestamp.toString().slice(-4)}`,
      layoutType: 'Shared-2',
      floor: 1,
      capacity: 2,
      occupiedCount: 0,
    });

    cleanerA = await User.create({
      name: `Cleaner A ${timestamp}`,
      email: `cleanerA_${timestamp}@test.com`,
      passwordHash: 'hash',
      role: 'CleaningStaff',
      hostelId: hostel._id,
    });

    cleanerB = await User.create({
      name: `Cleaner B ${timestamp}`,
      email: `cleanerB_${timestamp}@test.com`,
      passwordHash: 'hash',
      role: 'CleaningStaff',
      hostelId: hostel._id,
    });

    student = await User.create({
      name: `Student ${timestamp}`,
      email: `student_${timestamp}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
    });

    cleanerAToken = createToken(cleanerA);
    cleanerBToken = createToken(cleanerB);
    studentToken = createToken(student);
    adminToken = createToken(admin);

    taskA = await CleaningTask.create({
      roomId: room._id,
      assignedStaffId: cleanerA._id,
      taskType: 'Routine',
      status: 'Scheduled',
      scheduledTime: new Date(Date.now() + 3600000),
    });

    taskB = await CleaningTask.create({
      roomId: room._id,
      assignedStaffId: cleanerB._id,
      taskType: 'DeepClean',
      status: 'Scheduled',
      scheduledTime: new Date(Date.now() + 7200000),
    });

    taskDelayedWithPhoto = await CleaningTask.create({
      roomId: room._id,
      assignedStaffId: cleanerA._id,
      taskType: 'Routine',
      status: 'Delayed',
      scheduledTime: new Date(Date.now() + 1800000),
      beforeImageUri: 'https://ik.imagekit.io/hostelhive/existing_before.jpg',
      delayReason: 'Room temporarily occupied by guest',
    });

    taskDelayedWithoutPhoto = await CleaningTask.create({
      roomId: room._id,
      assignedStaffId: cleanerA._id,
      taskType: 'Emergency',
      status: 'Delayed',
      scheduledTime: new Date(Date.now() + 900000),
      delayReason: 'Waiting for supplies',
    });
  });

  afterAll(async () => {
    await CleaningTask.deleteMany({
      _id: { $in: [taskA?._id, taskB?._id, taskDelayedWithPhoto?._id, taskDelayedWithoutPhoto?._id].filter(Boolean) },
    });
    await Notification.deleteMany({
      userId: { $in: [cleanerA?._id, cleanerB?._id, student?._id, admin?._id].filter(Boolean) },
    });
    await Room.deleteMany({ _id: room?._id });
    await Hostel.deleteMany({ _id: hostel?._id });
    await User.deleteMany({
      _id: { $in: [cleanerA?._id, cleanerB?._id, student?._id, admin?._id].filter(Boolean) },
    });
    await mongoose.connection.close();
  });

  describe('PATCH /api/cleaning-tasks/:id/start workflow', () => {
    test('Student role cannot access start task -> 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskA._id}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ beforeImageUri: 'https://ik.imagekit.io/hostelhive/before.jpg' });

      expect(res.status).toBe(403);
    });

    test('Another cleaner cannot start task assigned to Cleaner A -> 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskA._id}/start`)
        .set('Authorization', `Bearer ${cleanerBToken}`)
        .send({ beforeImageUri: 'https://ik.imagekit.io/hostelhive/before.jpg' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/You can only start tasks assigned to you/i);
    });

    test('Scheduled without existing beforeImage + no supplied image -> 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskA._id}/start`)
        .set('Authorization', `Bearer ${cleanerAToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/before-cleaning photo.*required/i);
    });

    test('Scheduled without existing beforeImage + empty string photo -> 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskA._id}/start`)
        .set('Authorization', `Bearer ${cleanerAToken}`)
        .send({ beforeImageUri: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('Scheduled + valid beforeImage -> 200 OK, beforeImageUri persisted and startedAt generated', async () => {
      const beforeUrl = 'https://ik.imagekit.io/hostelhive/before_clean_test.jpg';
      const beforeTime = new Date();

      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskA._id}/start`)
        .set('Authorization', `Bearer ${cleanerAToken}`)
        .send({ beforeImageUri: beforeUrl });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('InProgress');
      expect(res.body.data.beforeImageUri).toBe(beforeUrl);
      expect(res.body.data.startedAt).toBeDefined();

      const startedAt = new Date(res.body.data.startedAt);
      expect(startedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 2000);

      const saved = await CleaningTask.findById(taskA._id);
      expect(saved.status).toBe('InProgress');
      expect(saved.beforeImageUri).toBe(beforeUrl);
      expect(saved.startedAt).toBeDefined();
    });

    test('Delayed with existing beforeImage + no new image -> 200 OK (reuses existing photo)', async () => {
      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskDelayedWithPhoto._id}/start`)
        .set('Authorization', `Bearer ${cleanerAToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('InProgress');
      expect(res.body.data.beforeImageUri).toBe('https://ik.imagekit.io/hostelhive/existing_before.jpg');
      expect(res.body.data.startedAt).toBeDefined();
    });

    test('Delayed without beforeImage + no new image -> 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskDelayedWithoutPhoto._id}/start`)
        .set('Authorization', `Bearer ${cleanerAToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/before-cleaning photo.*required/i);
    });

    test('Invalid task transition (already InProgress) -> 409 Controlled Failure', async () => {
      const res = await request(app)
        .patch(`/api/cleaning-tasks/${taskA._id}/start`)
        .set('Authorization', `Bearer ${cleanerAToken}`)
        .send({ beforeImageUri: 'https://ik.imagekit.io/hostelhive/new_before.jpg' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Cannot start a task with status "InProgress"/i);
    });
  });

  describe('Cleaning Directive Broadcast & Retrieval Suite', () => {
    test('Student role cannot broadcast directive -> 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ directive: 'Focus on sanitize washrooms today.' });

      expect(res.status).toBe(403);
    });

    test('CleaningStaff role cannot broadcast directive -> 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${cleanerAToken}`)
        .send({ directive: 'Focus on sanitize washrooms today.' });

      expect(res.status).toBe(403);
    });

    test('Validation failure on short/empty directive -> 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ directive: '  ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('Admin successfully broadcasts directive to own hostel cleaning staff', async () => {
      const directiveText = 'Focus on third floor sanitation and UV sterilization for common areas today.';
      const res = await request(app)
        .post('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ directive: directiveText });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.directive).toBe(directiveText);
      expect(res.body.data.recipientCount).toBe(2);

      // Verify hostel document persistence
      const updatedHostel = await Hostel.findById(hostel._id);
      expect(updatedHostel.cleaningDirective.text).toBe(directiveText);
      expect(updatedHostel.cleaningDirective.updatedAt).toBeDefined();

      // Verify Announcement notifications delivered to cleanerA and cleanerB
      const cleanerANotifs = await Notification.find({ userId: cleanerA._id, type: 'Announcement' });
      expect(cleanerANotifs.length).toBe(1);
      expect(cleanerANotifs[0].title).toBe('Cleaning Directive');
      expect(cleanerANotifs[0].body).toBe(directiveText);

      const cleanerBNotifs = await Notification.find({ userId: cleanerB._id, type: 'Announcement' });
      expect(cleanerBNotifs.length).toBe(1);
      expect(cleanerBNotifs[0].body).toBe(directiveText);

      // Student receives NO notification
      const studentNotifs = await Notification.find({ userId: student._id, type: 'Announcement' });
      expect(studentNotifs.length).toBe(0);
    });

    test('Admin retrieves active cleaning directive for today -> 200 OK', async () => {
      const res = await request(app)
        .get('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.directive).toBe('Focus on third floor sanitation and UV sterilization for common areas today.');
      expect(res.body.data.isToday).toBe(true);
    });

    test('Cross-hostel isolation: admin only reads and broadcasts to own hostel', async () => {
      const otherAdmin = await User.create({
        name: 'Other Admin',
        email: `otheradmin_${Date.now()}@test.com`,
        passwordHash: 'hash',
        role: 'Admin',
      });
      const otherHostel = await Hostel.create({
        name: `Other Hostel ${Date.now()}`,
        location: 'Islamabad F-7',
        priceTier: 20000,
        ownerAdminId: otherAdmin._id,
      });
      otherAdmin.hostelId = otherHostel._id;
      await otherAdmin.save();

      const otherAdminToken = createToken(otherAdmin);

      // otherAdmin reads GET /api/cleaning-tasks/directive -> gets their own (which is null), cannot see Hostel A's directive
      const readRes = await request(app)
        .get('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${otherAdminToken}`);

      expect(readRes.status).toBe(200);
      expect(readRes.body.data.directive).toBeNull();
      expect(readRes.body.data.isToday).toBe(false);

      // otherAdmin broadcasts on /api/cleaning-tasks/directive -> cleanerA/B of Hostel A do NOT receive new notifications
      const prevCleanerACount = await Notification.countDocuments({ userId: cleanerA._id, type: 'Announcement' });

      const broadcastRes = await request(app)
        .post('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${otherAdminToken}`)
        .send({ directive: 'Other hostel daily instructions.' });

      expect(broadcastRes.status).toBe(200);
      expect(broadcastRes.body.data.recipientCount).toBe(0);

      const afterCleanerACount = await Notification.countDocuments({ userId: cleanerA._id, type: 'Announcement' });
      expect(afterCleanerACount).toBe(prevCleanerACount);

      // Clean up otherAdmin and otherHostel
      await Hostel.deleteOne({ _id: otherHostel._id });
      await User.deleteOne({ _id: otherAdmin._id });
    });

    test('No cleaning staff case returns controlled message and recipientCount 0', async () => {
      const soloAdmin = await User.create({
        name: 'Solo Admin',
        email: `soloadmin_${Date.now()}@test.com`,
        passwordHash: 'hash',
        role: 'Admin',
      });
      const soloHostel = await Hostel.create({
        name: `Solo Hostel ${Date.now()}`,
        location: 'Rawalpindi Saddar',
        priceTier: 18000,
        ownerAdminId: soloAdmin._id,
      });
      soloAdmin.hostelId = soloHostel._id;
      await soloAdmin.save();

      const soloAdminToken = createToken(soloAdmin);

      const res = await request(app)
        .post('/api/cleaning-tasks/directive')
        .set('Authorization', `Bearer ${soloAdminToken}`)
        .send({ directive: 'Inspect fire extinguishers and stairwells.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recipientCount).toBe(0);
      expect(res.body.data.message).toBe('No cleaning staff are currently assigned to this hostel.');

      // Directive still persists on the hostel
      const savedHostel = await Hostel.findById(soloHostel._id);
      expect(savedHostel.cleaningDirective.text).toBe('Inspect fire extinguishers and stairwells.');

      await Hostel.deleteOne({ _id: soloHostel._id });
      await User.deleteOne({ _id: soloAdmin._id });
    });
  });
});
