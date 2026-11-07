const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

async function prepareProductionDatabase() {
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if ((!topology.setName && topology.msg !== 'isdbgrid') || topology.logicalSessionTimeoutMinutes == null) {
    throw new Error('Production MongoDB must support transactions. Use Atlas or a replica set.');
  }

  // Include models used only by background jobs before building their indexes.
  const directory = path.join(__dirname, '..', 'models');
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.js')).sort()) {
    require(path.join(directory, filename));
  }
  // Create declared indexes without dropping provider/operator-managed indexes.
  // Sequential initialization bounds memory and database work on small instances.
  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes();
  }
}

module.exports = { prepareProductionDatabase };
