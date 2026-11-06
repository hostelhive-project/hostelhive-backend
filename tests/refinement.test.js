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
const Invoice = require('../src/models/Invoice');
const Complaint = require('../src/models/Complaint');
const invoiceService = require('../src/services/invoice.service');

describe('Refinement Verification Suite: Pricing, Billing, Staff, Isolation, Lifecycle', () => {
  let admin, adminToken;
  let adminB, adminBToken;
  let hostel, hostelB;
  let roomDefaultPrice, roomCustomPrice;
  let student1, student1Token;
  let student2, student2Token;
  let createdStaff;

  const createToken = (user) =>
    jwt.sign(
      { sub: user._id.toString(), role: user.role },
      env.jwt.secret,
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    await connectDB();
    const ts = Date.now();

    // 1. Create Admins
    admin = await User.create({
      name: `Refine Admin ${ts}`,
      email: `refine_admin_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });
    adminToken = createToken(admin);

    adminB = await User.create({
      name: `Refine Admin B ${ts}`,
      email: `refine_admin_b_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Admin',
    });
    adminBToken = createToken(adminB);

    // 2. Create Hostels
    hostel = await Hostel.create({
      name: `Hostel Refine ${ts}`,
      location: 'Lahore West',
      priceTier: 14000,
      ownerAdminId: admin._id,
      chatbotInfo: {
        wifiPassword: 'SecretWifiPassword123',
        emergencyContact: '03001234567',
        additionalInfo: 'Private Admin Note',
        rules: ['No loud music after 10 PM'],
      },
    });
    admin.hostelId = hostel._id;
    await admin.save();

    hostelB = await Hostel.create({
      name: `Hostel Refine B ${ts}`,
      location: 'Lahore East',
      priceTier: 16000,
      ownerAdminId: adminB._id,
    });
    adminB.hostelId = hostelB._id;
    await adminB.save();

    // 3. Create Rooms: one using hostel priceTier fallback, one with room-level pricing
    roomDefaultPrice = await Room.create({
      hostelId: hostel._id,
      roomNumber: `R-DEF-${ts}`,
      layoutType: 'Single',
      capacity: 2,
      occupiedCount: 0,
      monthlyRent: null, // Should fallback to hostel.priceTier = 14000
    });

    roomCustomPrice = await Room.create({
      hostelId: hostel._id,
      roomNumber: `R-CUST-${ts}`,
      layoutType: 'Single',
      capacity: 1,
      occupiedCount: 0,
      monthlyRent: 22000, // Room-level pricing override
    });

    // 4. Create Students
    student1 = await User.create({
      name: `Student Refine 1 ${ts}`,
      email: `student1_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
    });
    student1Token = createToken(student1);

    student2 = await User.create({
      name: `Student Refine 2 ${ts}`,
      email: `student2_${ts}@test.com`,
      passwordHash: 'hash',
      role: 'Student',
    });
    student2Token = createToken(student2);
  });

  afterAll(async () => {
    await Hostel.deleteMany({ _id: { $in: [hostel?._id, hostelB?._id].filter(Boolean) } });
    await Room.deleteMany({ _id: { $in: [roomDefaultPrice?._id, roomCustomPrice?._id].filter(Boolean) } });
    await User.deleteMany({
      _id: { $in: [admin?._id, adminB?._id, student1?._id, student2?._id, createdStaff?._id].filter(Boolean) },
    });
    await Invoice.deleteMany({ bookingId: { $in: (await Booking.find({ studentId: { $in: [student1?._id, student2?._id].filter(Boolean) } }).select('_id')).map(item => item._id) } });
    await Complaint.deleteMany({ residentId: { $in: [student1?._id, student2?._id].filter(Boolean) } });
    await Booking.deleteMany({ studentId: { $in: [student1?._id, student2?._id].filter(Boolean) } });
    await mongoose.connection.close();
  });

  describe('1. Mess Removal & Billing Contract Verification', () => {
    test('Invoice model computes totalDue = rentAmount and messFeeAmount is stripped/not persisted', async () => {
      const inv = new Invoice({
        bookingId: new mongoose.Types.ObjectId(),
        billingMonth: '2026-10',
        rentAmount: 18000,
        dueDate: new Date(),
        status: 'Unpaid',
      });
      await inv.validate();
      expect(inv.totalDue).toBe(18000);
      expect(inv.messFeeAmount).toBeUndefined();
    });
  });

  describe('2. Admin Hostel Isolation & Staff Management', () => {
    test('Admin who already manages a hostel cannot create a second hostel (409)', async () => {
      const res = await request(app)
        .post('/api/hostels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Second Hostel Attempt',
          location: 'Lahore South',
          priceTier: 15000,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already managing a hostel/i);
    });

    test('Public registration rejects CleaningStaff role (400 validation)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Rogue Cleaner',
          email: 'cleaner@public.com',
          password: 'Password123!',
          role: 'CleaningStaff',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('Admin creates CleaningStaff via POST /api/users/staff -> auto-bound to Admin hostel', async () => {
      const res = await request(app)
        .post('/api/users/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Legit Cleaner',
          email: `cleaner_${Date.now()}@test.com`,
          password: 'Password123!',
          phone: '+92 300 9876543',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('CleaningStaff');
      expect(res.body.data.hostelId.toString()).toBe(hostel._id.toString());
      // The creation endpoint returns a pending invite. Activate the fixture
      // before exercising authenticated role and hostel-scope behavior.
      createdStaff = await User.findById(res.body.data._id);
      createdStaff.isActive = true;
      createdStaff.emailVerified = true;
      await createdStaff.save();
    });

    test('Assigning cleaning task for a room to staff of a different hostel is rejected with 400', async () => {
      // Staff belongs to hostel A; room in hostel B
      const roomInHostelB = await Room.create({
        hostelId: hostelB._id,
        roomNumber: `B-101-${Date.now()}`,
        layoutType: 'Single',
        capacity: 1,
      });

      const res = await request(app)
        .post('/api/cleaning-tasks')
        .set('Authorization', `Bearer ${adminBToken}`)
        .send({
          roomId: roomInHostelB._id.toString(),
          assignedStaffId: createdStaff._id.toString(),
          taskType: 'DeepClean',
          scheduledTime: new Date().toISOString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Staff member does not belong to the hostel of this room/i);
    });
  });

  describe('3. Booking Lifecycle, Pricing Snapshot, and Checkout Flow', () => {
    let booking1, booking2;

    test('Booking creation snapshots rent from room-level price when set', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          roomId: roomCustomPrice._id.toString(),
          emergencyContact: '03001112233',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('Pending');
      expect(res.body.data.monthlyRent).toBe(22000); // Room custom price
      booking1 = res.body.data;
    });

    test('Student with active Pending booking cannot submit another booking request (409)', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          roomId: roomDefaultPrice._id.toString(),
          emergencyContact: '03001112233',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/pending, approved or checked-in booking/i);
    });

    test('Admin approves booking -> room occupiedCount increments and approvedAt is set', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Approved');
      expect(res.body.data.approvedAt).toBeDefined();

      const updatedRoom = await Room.findById(roomCustomPrice._id);
      expect(updatedRoom.occupiedCount).toBe(1);
    });

    test('Admin B cannot check in Hostel A Approved booking (403)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkin`)
        .set('Authorization', `Bearer ${adminBToken}`);
      expect(res.status).toBe(403);
    });

    test('Student cannot check in Approved booking (403)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkin`)
        .set('Authorization', `Bearer ${student1Token}`);
      expect(res.status).toBe(403);
    });

    test('Unauthenticated request cannot check in (401)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkin`);
      expect(res.status).toBe(401);
    });

    test('Approved booking cannot be checked out directly (409)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkout`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Only a CheckedIn booking can be checked out/i);
    });

    test('Admin A checks in resident -> status CheckedIn and checkedInAt set, does not double increment occupiedCount', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkin`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CheckedIn');
      expect(res.body.data.checkedInAt).toBeDefined();

      const updatedRoom = await Room.findById(roomCustomPrice._id);
      expect(updatedRoom.occupiedCount).toBe(1); // Bed already reserved on approval, count stays 1
    });

    test('CheckedIn booking cannot be checked in again (409)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkin`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Only an Approved booking can be checked in/i);
    });

    test('Admin lists active residents for hostel -> returns populated studentId, roomId, and status', async () => {
      const res = await request(app)
        .get(`/api/bookings/hostel/${hostel._id}/residents`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const resident = res.body.data.find((b) => b._id === booking1._id.toString());
      expect(resident).toBeDefined();
      expect(resident.status).toBe('CheckedIn');
      expect(resident.studentId).toBeDefined();
      expect(resident.studentId.name).toBe(student1.name);
      expect(resident.studentId.email).toBe(student1.email);
      expect(resident.roomId).toBeDefined();
      expect(resident.roomId.roomNumber).toBe(roomCustomPrice.roomNumber);
      // Backwards compatibility alias fields
      expect(resident.student).toBeDefined();
      expect(resident.room).toBeDefined();
    });

    test('Admin B cannot list active residents of Hostel A (403 tenant isolation)', async () => {
      const res = await request(app)
        .get(`/api/bookings/hostel/${hostel._id}/residents`)
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(403);
    });

    test('Invoice generation for CheckedIn booking uses snapshotted monthlyRent without mess fee', async () => {
      const invoice = await invoiceService.generateForBooking(booking1._id);
      expect(invoice.rentAmount).toBe(22000);
      expect(invoice.totalDue).toBe(22000);
      expect(invoice.messFeeAmount).toBeUndefined();
    });

    test('POST /api/invoices/booking/:id/generate creates/returns invoice with snapshot rent and 201', async () => {
      const res = await request(app)
        .post(`/api/invoices/booking/${booking1._id}/generate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.data.rentAmount).toBe(22000);
      expect(res.body.data.totalDue).toBe(22000);
      expect(res.body.data.status).toBe('Unpaid');

      // Duplicate check: ensure calling again does not create duplicate document
      const count = await Invoice.countDocuments({ bookingId: booking1._id });
      expect(count).toBe(1);
    });

    test('Admin B cannot generate invoice for Hostel A booking (403 tenant isolation)', async () => {
      const res = await request(app)
        .post(`/api/invoices/booking/${booking1._id}/generate`)
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(403);
    });

    test('Admin can generate the selected billing month for all active hostel bookings', async () => {
      const billingMonth = '2099-12';
      const res = await request(app)
        .post('/api/invoices/generate-all')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ billingMonth });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ bookingId: booking1._id.toString(), status: 'ok' }),
        ])
      );

      const selectedInvoice = await Invoice.findOne({
        bookingId: booking1._id,
        billingMonth,
      });
      expect(selectedInvoice).toBeDefined();
    });

    test('POST /api/invoices/booking/:id/generate rejects invalid unknown body fields with 400', async () => {
      const res = await request(app)
        .post(`/api/invoices/booking/${booking1._id}/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ billingMonth: '2026-10', rentAmount: 15000 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/rentAmount/i);
    });

    test('Student cannot directly call checkout on own booking (403)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkout`)
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });

    test('CleaningStaff cannot checkout a resident (403)', async () => {
      const staffToken = createToken(createdStaff);
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkout`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(403);
    });

    test('Unauthenticated request cannot checkout (401)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkout`);

      expect(res.status).toBe(401);
    });

    test('Admin B cannot checkout Hostel A resident (403)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkout`)
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(403);
    });

    test('Admin A checkouts resident -> decrements occupiedCount and sets CheckedOut', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkout`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CheckedOut');
      expect(res.body.data.checkedOutAt).toBeDefined();

      const updatedRoom = await Room.findById(roomCustomPrice._id);
      expect(updatedRoom.occupiedCount).toBe(0);
    });

    test('Repeated Admin checkout returns 409 and does not decrement occupiedCount twice', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking1._id}/checkout`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Only a CheckedIn booking can be checked out/i);

      const updatedRoom = await Room.findById(roomCustomPrice._id);
      expect(updatedRoom.occupiedCount).toBe(0);
    });

    test('Booking creation fallback to hostel.priceTier when room has no monthlyRent', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student2Token}`)
        .send({
          roomId: roomDefaultPrice._id.toString(),
          emergencyContact: '03004445566',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.monthlyRent).toBe(14000); // hostel priceTier fallback
      booking2 = res.body.data;
    });

    test('Pending booking cannot directly become CheckedIn (409)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking2._id}/checkin`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Only an Approved booking can be checked in/i);
    });

    test('Admin rejects booking -> sets status Rejected (not Cancelled)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${booking2._id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Incomplete documentation' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Rejected');
      expect(res.body.data.rejectionReason).toBe('Incomplete documentation');
    });
  });

  describe('4. Complaint Ownership & Feature Gating', () => {
    test('Non-checked-in student cannot file complaints (403)', async () => {
      const res = await request(app)
        .post('/api/complaints')
        .set('Authorization', `Bearer ${student2Token}`)
        .send({
          description: 'Noisy corridor outside my room',
          severityTier: 'Low',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Only checked-in residents can file complaints/i);
    });
  });

  describe('5. Chatbot Privacy & Review Eligibility', () => {
    test('Public chatbot-info strips wifiPassword, emergencyContact, and additionalInfo', async () => {
      const res = await request(app).get(`/api/hostels/${hostel._id}/chatbot-info`);

      expect(res.status).toBe(200);
      expect(res.body.data.rules).toBeDefined();
      expect(res.body.data.wifiPassword).toBeUndefined();
      expect(res.body.data.emergencyContact).toBeUndefined();
      expect(res.body.data.additionalInfo).toBeUndefined();
    });

    test('Student with CheckedOut booking is eligible to write a review', async () => {
      const res = await request(app)
        .post(`/api/hostels/${hostel._id}/reviews`)
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          rating: 5,
          comment: 'Wonderful stay, checked out yesterday without issues!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rating).toBe(5);
    });

    test('Student with no completed stay cannot write a review (403)', async () => {
      const res = await request(app)
        .post(`/api/hostels/${hostel._id}/reviews`)
        .set('Authorization', `Bearer ${student2Token}`)
        .send({
          rating: 1,
          comment: 'Fake review attempt',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/can only review a hostel you have stayed at/i);
    });
  });

  describe('6. Student Cancellation & Awaiting Check-In Filtering', () => {
    let cancelBookingPending;
    let cancelBookingApproved;

    test('Student can cancel own Pending booking -> sets Cancelled, occupancy unchanged', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          roomId: roomCustomPrice._id.toString(),
          emergencyContact: '03009998877',
        });
      expect(res.status).toBe(201);
      cancelBookingPending = res.body.data;

      // Another student cannot cancel this booking (403)
      const nonOwnerRes = await request(app)
        .patch(`/api/bookings/${cancelBookingPending._id}/cancel`)
        .set('Authorization', `Bearer ${student2Token}`);
      expect(nonOwnerRes.status).toBe(403);
      expect(nonOwnerRes.body.message).toMatch(/only cancel your own booking/i);

      // Student cancels Pending booking
      const cancelRes = await request(app)
        .patch(`/api/bookings/${cancelBookingPending._id}/cancel`)
        .set('Authorization', `Bearer ${student1Token}`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('Cancelled');
      expect(cancelRes.body.data.rejectionReason).toBe('Cancelled by student');

      const roomAfter = await Room.findById(roomCustomPrice._id);
      expect(roomAfter.occupiedCount).toBe(0);

      // Repeated cancellation fails with 409
      const repeatRes = await request(app)
        .patch(`/api/bookings/${cancelBookingPending._id}/cancel`)
        .set('Authorization', `Bearer ${student1Token}`);
      expect(repeatRes.status).toBe(409);
      expect(repeatRes.body.message).toMatch(/Cannot cancel a booking with status "Cancelled"/i);
    });

    test('Student can submit new booking after cancellation (Cancelled is not active)', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          roomId: roomCustomPrice._id.toString(),
          emergencyContact: '03009998877',
        });
      expect(res.status).toBe(201);
      cancelBookingApproved = res.body.data;
    });

    test('Student cancels Approved booking -> decrements occupiedCount and unlocks room', async () => {
      // 1. Admin approves booking -> room occupiedCount becomes 1, locked because capacity is 1
      const appRes = await request(app)
        .patch(`/api/bookings/${cancelBookingApproved._id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(appRes.status).toBe(200);
      expect(appRes.body.data.status).toBe('Approved');

      let room = await Room.findById(roomCustomPrice._id);
      expect(room.occupiedCount).toBe(1);
      expect(room.isLocked).toBe(true);

      // 2. Student cancels Approved booking
      const cancelRes = await request(app)
        .patch(`/api/bookings/${cancelBookingApproved._id}/cancel`)
        .set('Authorization', `Bearer ${student1Token}`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('Cancelled');

      // 3. Room occupiedCount decremented and unlocked
      room = await Room.findById(roomCustomPrice._id);
      expect(room.occupiedCount).toBe(0);
      expect(room.isLocked).toBe(false);

      // 4. Repeated cancellation returns 409 and does not double decrement
      const repeatRes = await request(app)
        .patch(`/api/bookings/${cancelBookingApproved._id}/cancel`)
        .set('Authorization', `Bearer ${student1Token}`);
      expect(repeatRes.status).toBe(409);

      room = await Room.findById(roomCustomPrice._id);
      expect(room.occupiedCount).toBe(0);
    });

    test('Student cannot cancel CheckedIn booking (409)', async () => {
      const createRes = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          roomId: roomCustomPrice._id.toString(),
          emergencyContact: '03009998877',
        });
      expect(createRes.status).toBe(201);
      const bId = createRes.body.data._id;

      await request(app)
        .patch(`/api/bookings/${bId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      await request(app)
        .patch(`/api/bookings/${bId}/checkin`)
        .set('Authorization', `Bearer ${adminToken}`);

      const cancelRes = await request(app)
        .patch(`/api/bookings/${bId}/cancel`)
        .set('Authorization', `Bearer ${student1Token}`);
      expect(cancelRes.status).toBe(409);
      expect(cancelRes.body.message).toMatch(/Cannot cancel a booking with status "CheckedIn"/i);

      // Clean up by checking out so student1 has no active residency
      await request(app)
        .patch(`/api/bookings/${bId}/checkout`)
        .set('Authorization', `Bearer ${adminToken}`);
    });

    test('Admin Web query GET /api/bookings/hostel/:hostelId?status=Approved strictly filters by status', async () => {
      const pendingRes = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student2Token}`)
        .send({
          roomId: roomDefaultPrice._id.toString(),
          emergencyContact: '03005556677',
        });
      expect(pendingRes.status).toBe(201);
      const pendingId = pendingRes.body.data._id;

      const createApprovedRes = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          roomId: roomCustomPrice._id.toString(),
          emergencyContact: '03001112233',
        });
      expect(createApprovedRes.status).toBe(201);
      const approvedId = createApprovedRes.body.data._id;

      await request(app)
        .patch(`/api/bookings/${approvedId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Query with ?status=Approved
      const filteredRes = await request(app)
        .get(`/api/bookings/hostel/${hostel._id}?status=Approved`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(filteredRes.status).toBe(200);
      expect(Array.isArray(filteredRes.body.data)).toBe(true);
      expect(filteredRes.body.data.length).toBeGreaterThan(0);

      // Verify EVERY returned booking has status === 'Approved'
      filteredRes.body.data.forEach((b) => {
        expect(b.status).toBe('Approved');
      });

      // Verify pending booking is NOT in the returned list
      const hasPending = filteredRes.body.data.some((b) => b._id.toString() === pendingId.toString());
      expect(hasPending).toBe(false);

      // Verify approved booking IS in the returned list
      const hasApproved = filteredRes.body.data.some((b) => b._id.toString() === approvedId.toString());
      expect(hasApproved).toBe(true);
    });

    test('GET /api/admin/dashboard/recent-activity populates studentId.name and roomId.roomNumber, preserving own-hostel scope', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/recent-activity')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data.recentBookings)).toBe(true);
      expect(res.body.data.recentBookings.length).toBeGreaterThan(0);

      const bookingActivity = res.body.data.recentBookings[0];
      // Student is populated object, NOT a raw ObjectId string
      expect(typeof bookingActivity.studentId).toBe('object');
      expect(bookingActivity.studentId).toHaveProperty('name');
      expect(typeof bookingActivity.studentId.name).toBe('string');

      // Room is populated object, NOT a raw ObjectId string
      expect(typeof bookingActivity.roomId).toBe('object');
      expect(bookingActivity.roomId).toHaveProperty('roomNumber');
      expect(typeof bookingActivity.roomId.roomNumber).toBe('string');

      // Admin B (own-hostel security) does not see Hostel A bookings
      const resB = await request(app)
        .get('/api/admin/dashboard/recent-activity')
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(resB.status).toBe(200);
      expect(Array.isArray(resB.body.data.recentBookings)).toBe(true);
      const containsHostelABooking = resB.body.data.recentBookings.some(
        (b) => b._id.toString() === bookingActivity._id.toString()
      );
      expect(containsHostelABooking).toBe(false);
    });
  });

  describe('Gallery Image Limit Validation (Max 5 Images)', () => {
    test('Updating hostel with 6 images is rejected with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/hostels/${hostel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          images: [
            'https://ik.imagekit.io/hostelhive/img1.jpg',
            'https://ik.imagekit.io/hostelhive/img2.jpg',
            'https://ik.imagekit.io/hostelhive/img3.jpg',
            'https://ik.imagekit.io/hostelhive/img4.jpg',
            'https://ik.imagekit.io/hostelhive/img5.jpg',
            'https://ik.imagekit.io/hostelhive/img6.jpg',
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot contain more than 5|maximum of 5/i);
    });

    test('Updating hostel with 5 images succeeds with HTTP 200', async () => {
      const res = await request(app)
        .put(`/api/hostels/${hostel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          images: [
            'https://ik.imagekit.io/hostelhive/img1.jpg',
            'https://ik.imagekit.io/hostelhive/img2.jpg',
            'https://ik.imagekit.io/hostelhive/img3.jpg',
            'https://ik.imagekit.io/hostelhive/img4.jpg',
            'https://ik.imagekit.io/hostelhive/img5.jpg',
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.images).toHaveLength(5);
    });

    test('Updating hostel with 0 images succeeds with HTTP 200', async () => {
      const res = await request(app)
        .put(`/api/hostels/${hostel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          images: [],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.images).toHaveLength(0);
    });
  });
});
