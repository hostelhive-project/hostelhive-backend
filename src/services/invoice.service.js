const dataRepository = require('../repositories/data.repository');
const AppError = require('../utils/AppError');
const invoiceRepository = require('../repositories/invoice.repository');
const notificationService = require('./notification.service');
const { Invoice: Invoice } = require('../repositories/data.repository');
const { Payment: Payment } = require('../repositories/data.repository');
const { Booking: Booking } = require('../repositories/data.repository');
const { Room: Room } = require('../repositories/data.repository');
const { Hostel: Hostel } = require('../repositories/data.repository');
const { retrieveCheckoutSession } = require('../integrations/stripe');

function currentBillingMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BILLING_TIMEZONE || 'Asia/Karachi', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
}

function resolveBillingMonth(billingMonth) {
  if (billingMonth === undefined || billingMonth === null || billingMonth === '') {
    return currentBillingMonth();
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
    throw new AppError('billingMonth must use the YYYY-MM format.', 400);
  }
  return billingMonth;
}

async function generateForBookings(activeBookings, billingMonth) {
  const results = [];
  for (const booking of activeBookings) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const invoice = await invoiceService.generateForBooking(booking._id, { billingMonth });
      results.push({ bookingId: booking._id, invoiceId: invoice._id, status: 'ok' });
    } catch (err) {
      results.push({ bookingId: booking._id, status: 'failed', error: err.isOperational
        ? err.message : 'The invoice could not be generated. Please try again later.' });
    }
  }
  return results;
}

const invoiceService = {
  async getById(id, user = null) {
    await invoiceRepository.updateOverdue();
    const invoice = await invoiceRepository.findById(id);
    if (!invoice) throw new AppError('Invoice not found', 404);

    if (!user || !['Student', 'Admin'].includes(user.role)) {
      throw new AppError('You do not have permission to view this invoice', 403);
    }

    const booking = await Booking.findById(invoice.bookingId);
    if (!booking) throw new AppError('Booking for this invoice no longer exists', 404);
    if (user.role === 'Student' && booking.studentId.toString() !== user.id) {
      throw new AppError('You can only view invoices for your own booking', 403);
    }
    if (user.role === 'Admin') {
      const room = await Room.findById(booking.roomId);
      if (!user.hostelId || !room || room.hostelId.toString() !== user.hostelId.toString()) {
        throw new AppError('You cannot view invoices outside your assigned hostel', 403);
      }
    }

    return invoice;
  },

  async getReceipt(id, user = null) {
    const invoice = await this.getById(id, user);
    if (invoice.status !== 'Paid') {
      throw new AppError('A receipt is available only after this invoice is paid.', 409);
    }

    const [receiptInvoice, allPayments] = await Promise.all([
      invoiceRepository.findReceiptDetails(id),
      invoiceRepository.findPaymentsForReceipt(id),
    ]);
    const booking = receiptInvoice?.bookingId;
    const student = booking?.studentId;
    const room = booking?.roomId;
    const hostel = room?.hostelId;
    const paidPayments = allPayments.filter((payment) => payment.paymentStatus === 'Paid');
    const netAmount = (payment) => Math.max(0, Number(payment.amount || 0) - Number(payment.refundedAmount || 0) - Number(payment.disputeLossAmount || 0));
    if (paidPayments.length && paidPayments.every(payment => netAmount(payment) === 0) && invoice.totalDue > 0) {
      throw new AppError('The payment was fully refunded or reversed. A paid receipt is no longer available.', 409);
    }
    const latestPayment = paidPayments[paidPayments.length - 1] || null;

    return {
      receiptNumber: `HH-${invoice._id.toString().slice(-8).toUpperCase()}`,
      invoiceId: invoice._id,
      billingMonth: invoice.billingMonth,
      status: invoice.status,
      currency: 'PKR',
      rentAmount: invoice.rentAmount,
      totalPaid: paidPayments.length
        ? paidPayments.reduce((total, payment) => total + netAmount(payment), 0)
        : invoice.totalDue,
      paidAt: latestPayment?.transactionDate || (invoice.totalDue === 0 ? invoice.createdAt : null),
      paymentMethod: latestPayment?.paymentMethod || (invoice.totalDue === 0 ? 'No payment required' : 'Legacy offline record; original settlement details unavailable'),
      refundedAmount: paidPayments.reduce((total, payment) => total + Number(payment.refundedAmount || 0), 0),
      resident: student ? {
        name: student.name,
        email: student.email,
        residentCode: student.residentCode || booking?.residentCode || null,
      } : null,
      hostel: hostel ? { name: hostel.name, location: hostel.location } : null,
      roomNumber: room?.roomNumber || null,
      transactions: paidPayments.map((payment) => ({
        amount: netAmount(payment),
        originalAmount: payment.amount,
        refundedAmount: payment.refundedAmount || 0,
        method: payment.paymentMethod,
        reference: payment.transactionReference || null,
        paidAt: payment.transactionDate || payment.createdAt,
      })),
    };
  },

  async listForBooking(bookingId, user) {
    await invoiceRepository.updateOverdue();
    if (!user || !['Student', 'Admin'].includes(user.role)) {
      throw new AppError('You do not have permission to view these invoices', 403);
    }
    const booking = await Booking.findById(bookingId);
    if (!booking) throw new AppError('Booking not found', 404);
    if (user.role === 'Student' && booking.studentId.toString() !== user.id) {
      throw new AppError('You can only view invoices for your own booking', 403);
    }
    if (user.role === 'Admin') {
      const room = await Room.findById(booking.roomId);
      if (!user.hostelId || !room || room.hostelId.toString() !== user.hostelId.toString()) {
        throw new AppError('You cannot view invoices outside your assigned hostel', 403);
      }
    }
    return invoiceRepository.findByBooking(bookingId);
  },

  /**
   * Generates (or returns, if it already exists) this month's invoice for a
   * single CheckedIn booking. Rent comes from the booking's snapshotted rent,
   * the room's monthlyRent, or the hostel's priceTier.
   */
  async generateForBooking(bookingId, options = {}) {
    const booking = await Booking.findById(bookingId);
    if (!booking) throw new AppError('Booking not found', 404);
    if (booking.status !== 'CheckedIn' && !(options.allowHistorical && booking.status === 'CheckedOut')) {
      throw new AppError('Invoices can only be generated for a CheckedIn booking', 409);
    }

    const room = await Room.findById(booking.roomId);
    if (!room) throw new AppError('Room for this booking no longer exists', 404);
    const hostel = await Hostel.findById(room.hostelId);
    if (!hostel) throw new AppError('Hostel for this room no longer exists', 404);

    const targetBillingMonth = resolveBillingMonth(options.billingMonth);
    const existing = await invoiceRepository.findByBookingAndMonth(bookingId, targetBillingMonth);
    if (existing) return existing;

    const rentAmount = (booking.monthlyRent != null)
      ? booking.monthlyRent
      : ((room.monthlyRent != null) ? room.monthlyRent : hostel.priceTier);

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 10); // due in 10 days, matches "Outstanding" framing in UI

    let invoice;
    try { invoice = await invoiceRepository.create({
      bookingId,
      billingMonth: targetBillingMonth,
      rentAmount,
      dueDate,
      status: rentAmount === 0 ? 'Paid' : 'Unpaid',
    }); } catch (error) {
      if (error.code !== 11000) throw error;
      return invoiceRepository.findByBookingAndMonth(bookingId, targetBillingMonth);
    }

    await notificationService.notify({
      userId: booking.studentId,
      type: 'RentDue',
      title: rentAmount === 0 ? `No rent due for ${targetBillingMonth}` : `Rent due for ${targetBillingMonth}`,
      body: rentAmount === 0 ? `Your invoice for ${targetBillingMonth} is settled. No payment is required.`
        : `Your rent of ${invoice.totalDue} for ${targetBillingMonth} is due by ${dueDate.toDateString()}.`,
      relatedEntityId: invoice._id,
    });

    return invoice;
  },

  async reconcileBilling() {
    await invoiceRepository.updateOverdue();
    const current = currentBillingMonth();
    const state = await require('../repositories/billingState.repository').initialize(current);
    const bookings = Booking.find({ status: { $in: ['CheckedIn', 'CheckedOut'] } }).cursor();
    for await (const booking of bookings) {
      // An undated legacy checkout cannot establish which months were occupied.
      // Leave it for explicit administrator review rather than inventing dues.
      if (booking.status === 'CheckedOut' && !booking.checkedOutAt) continue;
      let month = currentBillingMonth(booking.checkedInAt || booking.createdAt);
      if (month < state.enabledFrom) month = state.enabledFrom;
      const last = booking.status === 'CheckedOut' && booking.checkedOutAt
        ? currentBillingMonth(booking.checkedOutAt) : current;
      while (month <= last && month <= current) {
        try { await this.generateForBooking(booking.id, { billingMonth: month, allowHistorical: true }); }
        catch (error) { console.error('[billing] Reconciliation deferred for booking', booking.id, error.message); break; }
        const [year, number] = month.split('-').map(Number);
        month = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`;
      }
    }
  },

  async generateForHostelActiveBookings(hostelId, billingMonth) {
    if (!hostelId) throw new AppError('Admin must be assigned to a hostel to generate invoices', 400);
    const roomIds = await Room.find({ hostelId }).distinct('_id');
    const activeBookings = await Booking.find({ roomId: { $in: roomIds }, status: 'CheckedIn' });
    return generateForBookings(activeBookings, billingMonth);
  },

  async markInvoiceStatus(invoiceId, status, actorId, details = {}) {
    if (status === 'Paid') {
      const processingPayment = await Payment.findOne({ invoiceId, paymentStatus: 'Processing' });
      if (processingPayment) {
        if (!processingPayment.transactionReference) {
          throw new AppError('An online checkout is still being created for this invoice.', 409);
        }
        const session = await retrieveCheckoutSession(processingPayment.transactionReference);
        if (session.payment_status === 'paid') {
          throw new AppError('Stripe has completed payment for this invoice. Wait for payment confirmation before recording an offline payment.', 409);
        }
        if (session.status !== 'expired') {
          throw new AppError('An online checkout is still open for this invoice. Wait for it to complete or expire before recording an offline payment.', 409);
        }
        processingPayment.paymentStatus = 'Failed';
        await dataRepository.save(processingPayment);
        await Invoice.findOneAndUpdate(
          { _id: invoiceId, checkoutSessionId: session.id },
          { $set: { checkoutLockUntil: null, checkoutSessionId: null } }
        );
      }

      return require('../repositories/offlinePayment.repository').record(invoiceId, actorId, details);
    }
    const invoice = await invoiceRepository.updateById(invoiceId, { status });
    if (!invoice) throw new AppError('Invoice not found', 404);
    return invoice;
  },

  async listForHostel(hostelId, statusFilter) {
    await invoiceRepository.updateOverdue();
    const rooms = await Room.find({ hostelId }).select('_id roomNumber');
    const roomIds = rooms.map((r) => r._id);
    const roomMap = new Map(rooms.map((r) => [r._id.toString(), r.roomNumber]));

    const bookings = await Booking.find({ roomId: { $in: roomIds } })
      .populate('studentId', 'name email phone')
      .select('_id studentId roomId status');
    const bookingIds = bookings.map((b) => b._id);
    const bookingMap = new Map(bookings.map((b) => [b._id.toString(), b]));

    const invoices = await invoiceRepository.findByBookingIds(bookingIds, statusFilter);

    return invoices.map((inv) => {
      const booking = bookingMap.get(inv.bookingId.toString());
      const roomNumber = booking ? roomMap.get(booking.roomId.toString()) : undefined;
      return {
        ...inv.toObject(),
        booking: booking
          ? {
              _id: booking._id,
              student: booking.studentId,
              roomNumber,
            }
          : null,
      };
    });
  },

  loaderById: async (req) => {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return null;
    const booking = await Booking.findById(invoice.bookingId);
    if (!booking) return null;
    const room = await Room.findById(booking.roomId);
    if (!room) return null;
    return { hostelId: room.hostelId };
  },
};

module.exports = invoiceService;
