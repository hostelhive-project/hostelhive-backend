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
const Counter = require('../src/models/Counter');
const hostelService = require('../src/services/hostel.service');
const { generateNextResidentCodeForHostel } = require('../src/utils/residentCode');
const { generateUniqueHostelCode } = require('../src/utils/hostelCode');

describe('Resident ID (residentCode) Verification Suite', () => {
  let adminA, adminAToken, hostelA, roomA1, roomA2, roomA3, roomA4;
  let adminB, adminBToken, hostelB, roomB1, roomB2;
  let student1, student1Token;
  let student2, student2Token;
  let student3, student3Token;
  let student4, student4Token;

  const createToken = (user) =>
    jwt.sign(
      { sub: user._id.toString(), role: user.role },
      env.jwt.secret,
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    await connectDB();
    const ts = Date.now();

    // Admin A & Hostel A (Royal Residency -> ROY)
    adminA = await User.create({
      name: `Admin Royal ${ts}`,
      email: `admin_royal_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });
    adminAToken = createToken(adminA);

    hostelA = await Hostel.create({
      name: `Royal Residency ${ts}`,
      hostelCode: `ROY${ts.toString().slice(-3)}`,
      location: 'DHA Lahore',
      priceTier: 15000,
      ownerAdminId: adminA._id,
    });
    adminA.hostelId = hostelA._id;
    await adminA.save();

    roomA1 = await Room.create({
      hostelId: hostelA._id,
      roomNumber: 'R-101',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 0,
      isLocked: false,
    });

    roomA2 = await Room.create({
      hostelId: hostelA._id,
      roomNumber: 'R-102',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 0,
      isLocked: false,
    });

    roomA3 = await Room.create({
      hostelId: hostelA._id,
      roomNumber: 'R-103',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 0,
      isLocked: false,
    });

    roomA4 = await Room.create({
      hostelId: hostelA._id,
      roomNumber: 'R-104',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 0,
      isLocked: false,
    });

    // Admin B & Hostel B (T2M Smart Hostel -> T2M)
    adminB = await User.create({
      name: `Admin T2M ${ts}`,
      email: `admin_t2m_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });
    adminBToken = createToken(adminB);

    hostelB = await Hostel.create({
      name: `T2M Smart Hostel ${ts}`,
      hostelCode: `T2M${ts.toString().slice(-3)}`,
      location: 'Johar Town Lahore',
      priceTier: 18000,
      ownerAdminId: adminB._id,
    });
    adminB.hostelId = hostelB._id;
    await adminB.save();

    roomB1 = await Room.create({
      hostelId: hostelB._id,
      roomNumber: 'T-201',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 0,
      isLocked: false,
    });

    roomB2 = await Room.create({
      hostelId: hostelB._id,
      roomNumber: 'T-202',
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 0,
      isLocked: false,
    });

    // Students
    student1 = await User.create({
      name: `Student One ${ts}`,
      email: `student_1_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
      phone: '03001111111',
    });
    student1Token = createToken(student1);

    student2 = await User.create({
      name: `Student Two ${ts}`,
      email: `student_2_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
      phone: '03002222222',
    });
    student2Token = createToken(student2);

    student3 = await User.create({
      name: `Student Three ${ts}`,
      email: `student_3_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
      phone: '03003333333',
    });
    student3Token = createToken(student3);

    student4 = await User.create({
      name: `Student Four ${ts}`,
      email: `student_4_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
      phone: '03004444444',
    });
    student4Token = createToken(student4);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  let booking1Id;
  let newBookingId;
  let assignedCode1;

  test('1. Pending booking has no residentCode', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({
        roomId: roomA1._id.toString(),
        emergencyContact: '03009999999',
      });

    expect(res.status).toBe(201);
    booking1Id = res.body.data._id;
    expect(res.body.data.status).toBe('Pending');
    expect(res.body.data.residentCode).toBeFalsy();

    const freshStudent = await User.findById(student1._id);
    expect(freshStudent.residentCode).toBeFalsy();
  });

  test('2. Approved booking has no residentCode', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${booking1Id}/approve`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Approved');
    expect(res.body.data.residentCode).toBeFalsy();

    const freshStudent = await User.findById(student1._id);
    expect(freshStudent.residentCode).toBeFalsy();

    // Verify room occupancy incremented on approval
    const room = await Room.findById(roomA1._id);
    expect(room.occupiedCount).toBe(1);
  });

  test('3. First CheckIn assigns permanent residentCode with hostel code prefix and 6-digit counter', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${booking1Id}/checkin`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CheckedIn');

    assignedCode1 = res.body.data.studentId.residentCode || res.body.data.residentCode;
    const expectedPrefix = `${hostelA.hostelCode}-RES-000001`;
    expect(assignedCode1).toBe(expectedPrefix);

    // Verify student user record and booking record hold residentCode
    const freshStudent = await User.findById(student1._id);
    expect(freshStudent.residentCode).toBe(assignedCode1);

    const freshBooking = await Booking.findById(booking1Id);
    expect(freshBooking.residentCode).toBe(assignedCode1);
  });

  test('4. Second resident at same hostel receives sequential code (-000002)', async () => {
    const bookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({
        roomId: roomA2._id.toString(),
        emergencyContact: '03008888888',
      });
    expect(bookRes.status).toBe(201);
    const booking2Id = bookRes.body.data._id;

    await request(app)
      .patch(`/api/bookings/${booking2Id}/approve`)
      .set('Authorization', `Bearer ${adminAToken}`);

    const checkInRes = await request(app)
      .patch(`/api/bookings/${booking2Id}/checkin`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(checkInRes.status).toBe(200);
    const assignedCode2 = checkInRes.body.data.studentId.residentCode || checkInRes.body.data.residentCode;

    const expectedCode2 = `${hostelA.hostelCode}-RES-000002`;
    expect(assignedCode2).toBe(expectedCode2);
    expect(assignedCode2).not.toBe(assignedCode1);

    const freshStudent2 = await User.findById(student2._id);
    expect(freshStudent2.residentCode).toBe(assignedCode2);
  });

  test('5. Resident at different hostel receives hostel-specific code starting at 000001 (independent counter)', async () => {
    // Student 3 books and checks into Hostel B
    const bookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${student3Token}`)
      .send({
        roomId: roomB1._id.toString(),
        emergencyContact: '03007777777',
      });
    expect(bookRes.status).toBe(201);
    const booking3Id = bookRes.body.data._id;

    await request(app)
      .patch(`/api/bookings/${booking3Id}/approve`)
      .set('Authorization', `Bearer ${adminBToken}`);

    const checkInRes = await request(app)
      .patch(`/api/bookings/${booking3Id}/checkin`)
      .set('Authorization', `Bearer ${adminBToken}`);

    expect(checkInRes.status).toBe(200);
    const assignedCode3 = checkInRes.body.data.studentId.residentCode || checkInRes.body.data.residentCode;

    const expectedCodeB1 = `${hostelB.hostelCode}-RES-000001`;
    expect(assignedCode3).toBe(expectedCodeB1);

    const freshStudent3 = await User.findById(student3._id);
    expect(freshStudent3.residentCode).toBe(assignedCode3);
  });

  test('6. Repeated reads / GET endpoints do not generate new codes or increment counters', async () => {
    const res1 = await request(app)
      .get(`/api/bookings/${booking1Id}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(res1.status).toBe(200);
    expect(res1.body.data.studentId.residentCode).toBe(assignedCode1);

    const res2 = await request(app)
      .get(`/api/bookings/hostel/${hostelA._id}/residents`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(res2.status).toBe(200);
    const residentRecord = res2.body.data.find(
      (b) => b.studentId?._id?.toString() === student1._id.toString()
    );
    expect(residentRecord).toBeDefined();
    expect(residentRecord.studentId.residentCode).toBe(assignedCode1);
    expect(residentRecord.residentCode).toBe(assignedCode1);
  });

  test('7. Checkout preserves residentCode in booking and student record', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${booking1Id}/checkout`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CheckedOut');

    const freshStudent = await User.findById(student1._id);
    expect(freshStudent.residentCode).toBe(assignedCode1);

    const freshBooking = await Booking.findById(booking1Id);
    expect(freshBooking.status).toBe('CheckedOut');
    expect(freshBooking.residentCode).toBe(assignedCode1);

    // Verify room occupancy decremented
    const room = await Room.findById(roomA1._id);
    expect(room.occupiedCount).toBe(0);
  });

  test('8. Same hostel return reuses previous residentCode for that hostel (TC-RES-RETURN)', async () => {
    // Student 1 books Room A1 again at Hostel A after having checked out
    const newBookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({
        roomId: roomA1._id.toString(),
        emergencyContact: '03009999999',
      });
    expect(newBookRes.status).toBe(201);
    newBookingId = newBookRes.body.data._id;

    await request(app)
      .patch(`/api/bookings/${newBookingId}/approve`)
      .set('Authorization', `Bearer ${adminAToken}`);

    const checkInRes = await request(app)
      .patch(`/api/bookings/${newBookingId}/checkin`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(checkInRes.status).toBe(200);
    const recheckedCode = checkInRes.body.data.studentId.residentCode || checkInRes.body.data.residentCode;
    // Must reuse assignedCode1, NOT generate -000003!
    expect(recheckedCode).toBe(assignedCode1);

    const freshStudent = await User.findById(student1._id);
    expect(freshStudent.residentCode).toBe(assignedCode1);
  });

  test('9. Different hostel check-in assigns new hostel-specific residentCode (TC-RES-MULTI)', async () => {
    // Student 1 checks out of Hostel A first so they can book another hostel
    const coRes = await request(app)
      .patch(`/api/bookings/${newBookingId}/checkout`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(coRes.status).toBe(200);

    // Student 1 (who has assignedCode1 at Hostel A) now books Room B2 at Hostel B
    const multiBookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({
        roomId: roomB2._id.toString(),
        emergencyContact: '03009999999',
      });
    expect(multiBookRes.status).toBe(201);
    const multiBookingId = multiBookRes.body.data._id;

    await request(app)
      .patch(`/api/bookings/${multiBookingId}/approve`)
      .set('Authorization', `Bearer ${adminBToken}`);

    const checkInRes = await request(app)
      .patch(`/api/bookings/${multiBookingId}/checkin`)
      .set('Authorization', `Bearer ${adminBToken}`);

    expect(checkInRes.status).toBe(200);
    const codeAtHostelB = checkInRes.body.data.studentId.residentCode || checkInRes.body.data.residentCode;

    // Must be scoped to Hostel B counter (second resident in Hostel B -> -000002)
    const expectedCodeB2 = `${hostelB.hostelCode}-RES-000002`;
    expect(codeAtHostelB).toBe(expectedCodeB2);

    // In Hostel A's resident list, Student 1's prior booking still preserves Hostel A code
    const resA = await request(app)
      .get(`/api/bookings/hostel/${hostelA._id}/residents`)
      .set('Authorization', `Bearer ${adminAToken}`);
    // Prior booking was checked out, so check directly from booking repository / find
    const priorBookingA = await Booking.findById(newBookingId);
    expect(priorBookingA.residentCode).toBe(assignedCode1);
  });

  test('10. Concurrent check-ins at same hostel receive sequential unique IDs without duplicates', async () => {
    const ts = Date.now();
    const cStudent1 = await User.create({
      name: `C Student 1 ${ts}`,
      email: `c_student1_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
      phone: '03005555555',
    });
    const cStudent2 = await User.create({
      name: `C Student 2 ${ts}`,
      email: `c_student2_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
      phone: '03006666666',
    });
    const cToken1 = createToken(cStudent1);
    const cToken2 = createToken(cStudent2);

    const b3Res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${cToken1}`)
      .send({ roomId: roomA3._id.toString(), emergencyContact: '03003333333' });
    const b4Res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${cToken2}`)
      .send({ roomId: roomA4._id.toString(), emergencyContact: '03004444444' });

    expect(b3Res.status).toBe(201);
    expect(b4Res.status).toBe(201);

    await request(app).patch(`/api/bookings/${b3Res.body.data._id}/approve`).set('Authorization', `Bearer ${adminAToken}`);
    await request(app).patch(`/api/bookings/${b4Res.body.data._id}/approve`).set('Authorization', `Bearer ${adminAToken}`);

    const [resConcurrent1, resConcurrent2] = await Promise.all([
      request(app).patch(`/api/bookings/${b3Res.body.data._id}/checkin`).set('Authorization', `Bearer ${adminAToken}`),
      request(app).patch(`/api/bookings/${b4Res.body.data._id}/checkin`).set('Authorization', `Bearer ${adminAToken}`),
    ]);

    expect(resConcurrent1.status).toBe(200);
    expect(resConcurrent2.status).toBe(200);

    const code3 = resConcurrent1.body.data.residentCode;
    const code4 = resConcurrent2.body.data.residentCode;

    expect(code3).not.toBe(code4);
    expect([`${hostelA.hostelCode}-RES-000003`, `${hostelA.hostelCode}-RES-000004`]).toContain(code3);
    expect([`${hostelA.hostelCode}-RES-000003`, `${hostelA.hostelCode}-RES-000004`]).toContain(code4);
  });

  test('11. Hostel name update does not change hostelCode (immutable)', async () => {
    const updated = await hostelService.update(hostelA._id, {
      name: `Royal Residency Updated Luxury ${Date.now()}`,
      hostelCode: 'FAKE_CODE',
    });

    expect(updated.hostelCode).toBe(hostelA.hostelCode);

    const freshHostel = await Hostel.findById(hostelA._id);
    expect(freshHostel.hostelCode).toBe(hostelA.hostelCode);
  });

  test('12. Collision safety: generateUniqueHostelCode handles collisions properly', async () => {
    // If collision occurs with "ZEB", next should be "ZEB2", then "ZEB3"
    const code1 = await generateUniqueHostelCode('Zebra Residency');
    expect(code1).toBe('ZEB');

    // Create a temporary hostel with code ZEB
    const tempHostel = await Hostel.create({
      name: 'Zebra Residency',
      hostelCode: 'ZEB',
      location: 'Test',
      priceTier: 10000,
      ownerAdminId: new mongoose.Types.ObjectId(),
    });

    const code2 = await generateUniqueHostelCode('Zebra Garden');
    expect(code2).toBe('ZEB2');

    const tempHostel2 = await Hostel.create({
      name: 'Zebra Garden',
      hostelCode: 'ZEB2',
      location: 'Test',
      priceTier: 10000,
      ownerAdminId: new mongoose.Types.ObjectId(),
    });

    const code3 = await generateUniqueHostelCode('Zebra Palace');
    expect(code3).toBe('ZEB3');

    // Clean up temporary hostels
    await Hostel.deleteMany({ _id: { $in: [tempHostel._id, tempHostel2._id] } });
  });

  test('13. Sequence exceeding 999999 continues naturally without truncation', async () => {
    const testHostelId = new mongoose.Types.ObjectId();
    const counterKey = `residentCode:${testHostelId.toString()}`;

    // Seed counter to 999999
    await Counter.findByIdAndUpdate(
      counterKey,
      { seq: 999999 },
      { upsert: true, new: true }
    );

    const nextCode = await generateNextResidentCodeForHostel(testHostelId, 'BIG');
    expect(nextCode).toBe('BIG-RES-1000000');

    // Clean up test counter
    await Counter.findByIdAndDelete(counterKey);
  });

  test('14. Admin cannot access or check-in foreign-hostel resident (tenant isolation preserved)', async () => {
    // Admin B attempts to access Hostel A residents
    const foreignListRes = await request(app)
      .get(`/api/bookings/hostel/${hostelA._id}/residents`)
      .set('Authorization', `Bearer ${adminBToken}`);
    expect(foreignListRes.status).toBe(403);

    // Admin B attempts to check in booking belonging to Hostel A
    const foreignCheckInRes = await request(app)
      .patch(`/api/bookings/${booking1Id}/checkin`)
      .set('Authorization', `Bearer ${adminBToken}`);
    expect(foreignCheckInRes.status).toBe(403);
  });

  test('15. Room occupancy remains strictly accurate across the lifecycle', async () => {
    // roomA1 had student1 checkout in test 9, so occupiedCount is 0
    const roomA1Doc = await Room.findById(roomA1._id);
    expect(roomA1Doc.occupiedCount).toBe(0);

    // roomA2 has student2 checked in, occupiedCount is 1
    const roomA2Doc = await Room.findById(roomA2._id);
    expect(roomA2Doc.occupiedCount).toBe(1);

    // roomB2 has student1 checked in at Hostel B, occupiedCount is 1
    const roomB2Doc = await Room.findById(roomB2._id);
    expect(roomB2Doc.occupiedCount).toBe(1);
  });
});
