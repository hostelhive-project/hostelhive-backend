process.env.NODE_ENV = 'test';
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const env = require('../src/config/env');
const Hostel = require('../src/models/Hostel');
const Room = require('../src/models/Room');

// All fixtures live in a dedicated, disposable database, never the configured app database.
const testDb = `hostelhive_room_catalog_test_${process.pid}_${Date.now()}`;

describe('Public room catalog and paginated room options', () => {
  let hostel;
  let emptyHostel;
  const url = (path) => `/api/hostels/${hostel._id}/${path}`;

  beforeAll(async () => {
    await mongoose.connect(env.mongoUri, { dbName: testDb, serverSelectionTimeoutMS: 5000 });
    const createHostel = (name, code) => Hostel.create({
      name, hostelCode: code, ownerAdminId: new mongoose.Types.ObjectId(), location: 'Test location', priceTier: 19000,
    });
    hostel = await createHostel('Room catalog test', 'RCT');
    emptyHostel = await createHostel('Empty catalog', 'ECT');
    const other = await createHostel('Other hostel', 'OCT');
    const rooms = Array.from({ length: 21 }, (_, i) => ({
      hostelId: hostel._id, roomNumber: `H-${String(i + 1).padStart(2, '0')}`, layoutType: 'Shared-2', capacity: 2,
      occupiedCount: i === 0 ? 1 : i === 1 ? 2 : 0,
      isLocked: i === 2,
      monthlyRent: i === 0 ? null : i === 1 ? 10000 : i === 2 ? 2000 : i === 3 ? 0 : 14000 + i * 100,
    }));
    rooms.push(
      { hostelId: hostel._id, roomNumber: 'S-01', layoutType: 'Single', capacity: 1, occupiedCount: 0, monthlyRent: 25000 },
      { hostelId: hostel._id, roomNumber: 'S.[02]', layoutType: 'Single', capacity: 1, occupiedCount: 1, monthlyRent: 5000 },
      { hostelId: hostel._id, roomNumber: 'F-01', layoutType: 'Shared-4', capacity: 4, occupiedCount: 0, isLocked: true },
      { hostelId: other._id, roomNumber: 'OTHER', layoutType: 'Single', capacity: 1, occupiedCount: 0, monthlyRent: 1 },
    );
    await Room.create(rooms);
  }, 15000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === testDb && testDb.startsWith('hostelhive_room_catalog_test_')) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  });

  test('summarizes all layouts and counts only unlocked rooms with free beds', async () => {
    const res = await request(app).get(url('room-catalog'));
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ totalRooms: 24, availableRooms: 20, availableBeds: 38, startingRent: 0 });
    expect(res.body.data.types).toHaveLength(3);
    expect(res.body.data.types.find((type) => type.layoutType === 'Shared-2')).toEqual({
      layoutType: 'Shared-2', totalRooms: 21, availableRooms: 19, availableBeds: 37, startingRent: 0,
    });
    expect(res.body.data.types.find((type) => type.layoutType === 'Shared-4')).toMatchObject({
      availableRooms: 0, availableBeds: 0, startingRent: null,
    });
  });

  test('paginates 24 rooms as 10/10/4, without overlaps or rooms from other hostels', async () => {
    const pages = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await request(app).get(url(`room-options?page=${page}`));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ total: 24, totalPages: 3, page, limit: 10, hasMore: page < 3 });
      pages.push(res.body.data.items);
    }
    expect(pages.map((page) => page.length)).toEqual([10, 10, 4]);
    const items = pages.flat();
    expect(new Set(items.map((item) => item._id)).size).toBe(24);
    expect(items.every((item) => item.hostelId === hostel.id)).toBe(true);
  });

  test('combines layout, available-only and literal room-number search', async () => {
    const res = await request(app).get(url('room-options?layoutType=Shared-2&available=true&q=h-0&limit=30'));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(7);
    expect(res.body.data.items.every((room) => room.layoutType === 'Shared-2' && !room.isLocked && room.occupiedCount < room.capacity)).toBe(true);
    const literal = await request(app).get(url('room-options')).query({ q: '.[02]' });
    expect(literal.body.data.items.map((room) => room.roomNumber)).toEqual(['S.[02]']);
    const regex = await request(app).get(url('room-options')).query({ q: '.*' });
    expect(regex.body.data.total).toBe(0);
  });

  test('sorts by effective rent, retaining valid zero rent and hostel rent fallback', async () => {
    const asc = await request(app).get(url('room-options?available=true&sort=rent-asc&limit=30'));
    const desc = await request(app).get(url('room-options?available=true&sort=rent-desc&limit=30'));
    expect(asc.status).toBe(200);
    expect(desc.status).toBe(200);
    const rents = asc.body.data.items.map((room) => room.effectiveRent);
    expect(rents).toEqual([...rents].sort((a, b) => a - b));
    expect(rents[0]).toBe(0);
    expect(asc.body.data.items.find((room) => room.roomNumber === 'H-01').effectiveRent).toBe(19000);
    expect(desc.body.data.items.map((room) => room.effectiveRent)).toEqual([...rents].reverse());
    const catalogSingle = await request(app).get(url('room-catalog'));
    expect(catalogSingle.body.data.types.find((type) => type.layoutType === 'Single').startingRent).toBe(25000);
  });

  test('preserves legacy array responses and excludes full/locked rooms when available=true', async () => {
    const all = await request(app).get(url('rooms'));
    const available = await request(app).get(url('rooms?available=true'));
    expect(Array.isArray(all.body.data)).toBe(true);
    expect(all.body.data).toHaveLength(24);
    expect(available.body.data).toHaveLength(20);
    expect(available.body.data.every((room) => !room.isLocked && room.occupiedCount < room.capacity)).toBe(true);
    const explicitAll = await request(app).get(url('room-options?available=false&limit=30'));
    expect(explicitAll.body.data.total).toBe(24);
  });

  test('returns truthful empty summaries, empty pages and missing-hostel errors', async () => {
    const empty = await request(app).get(`/api/hostels/${emptyHostel.id}/room-catalog`);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ types: [], summary: { totalRooms: 0, availableRooms: 0, availableBeds: 0, startingRent: null } });
    const options = await request(app).get(`/api/hostels/${emptyHostel.id}/room-options`);
    expect(options.body.data).toMatchObject({ items: [], total: 0, totalPages: 0, hasMore: false });
    const last = await request(app).get(url('room-options?page=99'));
    expect(last.body.data).toMatchObject({ items: [], total: 24, hasMore: false });
    for (const endpoint of ['room-catalog', 'room-options']) {
      const missing = await request(app).get(`/api/hostels/${new mongoose.Types.ObjectId()}/${endpoint}`);
      expect(missing.status).toBe(404);
      const invalid = await request(app).get(`/api/hostels/invalid/${endpoint}`);
      expect(invalid.status).toBe(400);
    }
  });

  test.each(['page=0', 'page=1.5', 'limit=31', 'limit=-1', 'layoutType=Double', 'sort=unknown', 'available=maybe', `q=${'a'.repeat(101)}`])(
    'rejects invalid query %s', async (query) => {
      expect((await request(app).get(url(`room-options?${query}`))).status).toBe(400);
    }
  );

  test('catalog counts and paged availability refresh after capacity is used', async () => {
    await Room.updateOne({ hostelId: hostel.id, roomNumber: 'S-01' }, { $set: { occupiedCount: 1 } });
    const res = await request(app).get(url('room-catalog'));
    expect(res.body.data.summary.availableRooms).toBe(19);
    expect(res.body.data.summary.availableBeds).toBe(37);
    expect(res.body.data.types.find((type) => type.layoutType === 'Single')).toMatchObject({ availableRooms: 0, startingRent: null });
    const single = await request(app).get(url('room-options?layoutType=Single&available=true'));
    expect(single.body.data.total).toBe(0);
  });
});
