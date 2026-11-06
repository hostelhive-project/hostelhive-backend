const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');

const invoiceRepository = {
  updateOverdue() {
    return Invoice.updateMany({ status: { $in: ['Unpaid', 'PartiallyPaid'] }, dueDate: { $lt: new Date() } }, { $set: { status: 'Overdue' } });
  },
  create(data) {
    return Invoice.create(data);
  },
  findById(id) {
    return Invoice.findById(id);
  },
  findReceiptDetails(id) {
    return Invoice.findById(id).populate({
      path: 'bookingId',
      select: 'studentId roomId residentCode',
      populate: [
        { path: 'studentId', select: 'name email residentCode' },
        {
          path: 'roomId',
          select: 'roomNumber hostelId',
          populate: { path: 'hostelId', select: 'name location' },
        },
      ],
    });
  },
  findPaymentsForReceipt(invoiceId) {
    return Payment.find({ invoiceId }).sort({ transactionDate: 1, createdAt: 1 });
  },
  findByBooking(bookingId) {
    return Invoice.find({ bookingId }).sort({ billingMonth: -1 });
  },
  findByBookingAndMonth(bookingId, billingMonth) {
    return Invoice.findOne({ bookingId, billingMonth });
  },
  updateById(id, updates) {
    return Invoice.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
  },
  findByBookingIds(bookingIds, statusFilter) {
    const filter = { bookingId: { $in: bookingIds } };
    if (statusFilter) filter.status = statusFilter;
    return Invoice.find(filter).sort({ billingMonth: -1, createdAt: -1 });
  },
};

module.exports = invoiceRepository;
