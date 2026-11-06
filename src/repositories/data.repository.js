// Shared query primitives. Domain services use these repositories rather than
// importing models; specialized repositories retain domain-specific queries.
function repository(model) {
  const result = {};
  for (const method of ['find', 'findOne', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate',
    'findByIdAndDelete', 'deleteOne', 'deleteMany', 'updateOne', 'updateMany', 'countDocuments',
    'exists', 'distinct', 'aggregate', 'create', 'bulkWrite']) {
    result[method] = (...args) => model[method](...args);
  }
  for (const name of ['LAYOUT_TYPES', 'ROLES', 'BOOKING_STATUSES']) result[name] = model[name];
  return result;
}

for (const name of ['User', 'Room', 'Hostel', 'Booking', 'Invoice', 'Payment', 'Complaint',
  'CleaningTask', 'ChatMessage', 'Review', 'Notification', 'BlockchainRecord', 'Counter']) {
  module.exports[name] = repository(require(`../models/${name}`));
}
module.exports.save = (document, options) => document.save(options);
