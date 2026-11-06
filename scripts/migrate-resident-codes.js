const mongoose = require('mongoose');

async function migrate() {
  await mongoose.connect('mongodb://localhost:27017/hostelhive');
  const db = mongoose.connection.db;

  // 1. Ensure Royal Residency has hostelCode = 'ROY'
  const royalId = new mongoose.Types.ObjectId('6acd38d7a6f5a7f0bb1627ef');
  await db.collection('hostels').updateOne(
    { _id: royalId },
    { $set: { hostelCode: 'ROY' } }
  );
  console.log('Updated Royal Residency hostelCode to ROY');

  // Also ensure any other hostels have unique hostelCodes
  const allHostels = await db.collection('hostels').find().toArray();
  const usedCodes = new Set(['ROY']);
  for (const h of allHostels) {
    if (h._id.toString() === royalId.toString()) continue;
    let base = (h.name || 'HOS').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
    if (base.length < 3) base = base.padEnd(3, 'X');
    let code = base;
    let counter = 2;
    while (usedCodes.has(code)) {
      code = `${base}${counter++}`;
    }
    usedCodes.add(code);
    await db.collection('hostels').updateOne(
      { _id: h._id },
      { $set: { hostelCode: code } }
    );
    console.log(`Set hostelCode for ${h.name} -> ${code}`);
  }

  // 2. Find Hamza and Ali
  const hamza = await db.collection('users').findOne({ email: 'hamza@gmail.com' });
  const ali = await db.collection('users').findOne({ email: 'ali@gmail.com' });

  if (hamza) {
    await db.collection('users').updateOne(
      { _id: hamza._id },
      { $set: { residentCode: 'ROY-RES-000001' } }
    );
    await db.collection('bookings').updateMany(
      { studentId: hamza._id },
      { $set: { residentCode: 'ROY-RES-000001' } }
    );
    console.log('Updated Hamza to ROY-RES-000001');
  }

  if (ali) {
    await db.collection('users').updateOne(
      { _id: ali._id },
      { $set: { residentCode: 'ROY-RES-000002' } }
    );
    await db.collection('bookings').updateMany(
      { studentId: ali._id },
      { $set: { residentCode: 'ROY-RES-000002' } }
    );
    console.log('Updated Ali to ROY-RES-000002');
  }

  // 3. Counter for Royal Residency
  const royalCounterKey = `residentCode:${royalId.toString()}`;
  await db.collection('counters').updateOne(
    { _id: royalCounterKey },
    { $set: { seq: 2 } },
    { upsert: true }
  );
  console.log(`Set counter ${royalCounterKey} to 2`);

  const updatedHostel = await db.collection('hostels').findOne({ _id: royalId });
  console.log('Royal Residency now:', { id: updatedHostel._id, name: updatedHostel.name, hostelCode: updatedHostel.hostelCode });

  const updatedUsers = await db.collection('users').find({ email: { $in: ['hamza@gmail.com', 'ali@gmail.com'] } }).toArray();
  console.log('Users now:', updatedUsers.map(u => ({ email: u.email, residentCode: u.residentCode })));

  const updatedBookings = await db.collection('bookings').find({ studentId: { $in: [hamza?._id, ali?._id].filter(Boolean) } }).toArray();
  console.log('Bookings now:', updatedBookings.map(b => ({ studentId: b.studentId, status: b.status, residentCode: b.residentCode })));

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});

