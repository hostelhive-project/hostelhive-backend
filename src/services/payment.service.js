const dataRepository = require('../repositories/data.repository');
const AppError = require('../utils/AppError');
const env = require('../config/env');
const paymentRepository = require('../repositories/payment.repository');
const invoiceRepository = require('../repositories/invoice.repository');
const {
  constructWebhookEvent,
  createConnectedAccount,
  createOnboardingLink,
  retrieveAccount,
  retrieveCheckoutSession,
  createCheckoutSession,
} = require('../integrations/stripe');
const { Booking: Booking } = require('../repositories/data.repository');
const { Room: Room } = require('../repositories/data.repository');
const { Hostel: Hostel } = require('../repositories/data.repository');
const { User: User } = require('../repositories/data.repository');
const { Invoice: Invoice } = require('../repositories/data.repository');
const { Payment: Payment } = require('../repositories/data.repository');

const paymentService = {
  async handleWebhook(rawBody, signature) {
    
    let event;
    try {
      event = constructWebhookEvent(rawBody, signature);
    } catch (err) {
      throw new AppError('Webhook signature verification failed.', 400);
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await paymentService.settleFromWebhookSession(event.data.object);
        break;
      case 'checkout.session.expired':
        await paymentService.markFailed(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await paymentService.recordPaymentIntentFailure(event.data.object);
        break;
      case 'charge.refunded':
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        await require('../repositories/outbox.repository').enqueue(`stripe-adjustment:${event.id}`, 'StripeAdjustment', {
          type: event.type, id: event.data.object.id,
        });
        break;
      // account.updated fires as the Admin progresses through onboarding —
      // we don't need to act on it here since syncOnboardingStatus() checks
      // Stripe directly on demand, but logging it is useful for debugging.
      case 'account.updated':
        break;
      default:
        break;
    }

  },
  // ---- Admin-side: connecting the hostel's Stripe account ----

  /**
   * Creates the hostel's Stripe Express account (once) and returns a fresh
   * onboarding link. Safe to call again later if the Admin needs to
   * re-enter/finish onboarding — Stripe account links expire quickly, but
   * the underlying account is reused, not recreated.
   */
  async getOrCreateOnboardingLink(hostelId, adminId) {
    const hostel = await Hostel.findById(hostelId);
    if (!hostel) throw new AppError('Hostel not found', 404);

    if (!hostel.stripeAccountId) {
      const admin = await User.findById(adminId);
      const account = await createConnectedAccount({ email: admin?.email, hostelName: hostel.name });
      hostel.stripeAccountId = account.id;
      await dataRepository.save(hostel);
    }

    const link = await createOnboardingLink(hostel.stripeAccountId);
    return { url: link.url, stripeAccountId: hostel.stripeAccountId };
  },

  /**
   * Checks onboarding completion status directly against Stripe (rather
   * than trusting only our cached stripeOnboardingComplete flag) and syncs
   * the flag. Call this from a "Refresh status" button on the Admin UI, or
   * after the Admin is redirected back from Stripe's onboarding flow.
   */
  async syncOnboardingStatus(hostelId) {
    const hostel = await Hostel.findById(hostelId);
    if (!hostel) throw new AppError('Hostel not found', 404);
    if (!hostel.stripeAccountId) {
      return {
        connected: false,
        isConnected: false,
        onboardingComplete: false,
        stripeAccountId: null,
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        capabilities: {},
        requirementsPending: false,
        currentlyDue: [],
        disabledReason: null,
      };
    }

    const account = await retrieveAccount(hostel.stripeAccountId);

    const detailsSubmitted = Boolean(account.details_submitted);
    const chargesEnabled = Boolean(account.charges_enabled);
    const payoutsEnabled = Boolean(account.payouts_enabled);
    const currentlyDue = account.requirements?.currently_due || [];
    const requirementsPending = currentlyDue.length > 0;
    const disabledReason = account.requirements?.disabled_reason || null;

    // For destination charges in Stripe Connect:
    // Destination charges require the transfers capability to be active.
    const isReady = Boolean(
      account.details_submitted &&
      account.charges_enabled &&
      account.capabilities?.transfers === 'active'
    );

    hostel.stripeOnboardingComplete = isReady;
    await dataRepository.save(hostel);

    return {
      connected: true,
      isConnected: isReady,
      onboardingComplete: isReady,
      stripeAccountId: hostel.stripeAccountId,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      capabilities: {
        transfers: account.capabilities?.transfers || null,
        card_payments: account.capabilities?.card_payments || null,
      },
      requirementsPending,
      currentlyDue,
      disabledReason,
    };
  },

  // ---- Resident-side: paying an invoice ----

  /**
   * Step 1: resident asks to pay an invoice. Money is routed directly to
   * the hostel's own connected Stripe account (destination charge) — we
   * never hold funds. Payment is created "Processing"; only the webhook
   * (below) marks it Paid. Never trust the client-side redirect for money.
   */
  async initiateCheckout(invoiceId, requesterId) {
    const invoice = await invoiceRepository.findById(invoiceId);
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (invoice.status === 'Paid') throw new AppError('This invoice is already paid', 409);

    const booking = await Booking.findById(invoice.bookingId);
    if (!booking) throw new AppError('Booking for this invoice no longer exists', 404);
    if (booking.studentId.toString() !== requesterId) {
      throw new AppError('You can only pay your own invoices', 403);
    }

    const room = await Room.findById(booking.roomId);
    if (!room) throw new AppError('Room for this booking no longer exists', 404);
    const hostel = await Hostel.findById(room.hostelId);
    if (!hostel) throw new AppError('Hostel for this room no longer exists', 404);

    if (!hostel.stripeAccountId || !hostel.stripeOnboardingComplete) {
      throw new AppError('This hostel has not finished setting up payments yet. Please contact the hostel admin.', 409);
    }

    const rate = Number(env.pkrPerUsd);
    if (!rate || isNaN(rate) || rate <= 0) {
      throw new AppError('Payment processing is temporarily unavailable due to invalid exchange rate configuration.', 500);
    }

    if (!invoice.totalDue || invoice.totalDue <= 0) {
      throw new AppError('Invoice total due must be greater than zero to initiate checkout.', 400);
    }

    const usdCents = Math.round((invoice.totalDue / rate) * 100);
    if (usdCents <= 0) {
      throw new AppError('Converted payment amount is too low to process with Stripe.', 400);
    }

    const student = await User.findById(requesterId);
    const existingProcessingPayment = await paymentRepository.findProcessingByInvoice(invoice._id);
    if (existingProcessingPayment) {
      if (!existingProcessingPayment.transactionReference) {
        throw new AppError('A checkout session is already in progress for this invoice.', 409);
      }

      // Reconcile a previous attempt before allowing a new session. This also
      // avoids duplicate charges if Stripe completed payment but its webhook
      // has not reached this server yet.
      const existingSession = await retrieveCheckoutSession(existingProcessingPayment.transactionReference);
      if (existingSession.payment_status === 'paid') {
        await paymentService.settleFromWebhookSession(existingSession);
        throw new AppError('This invoice has already been paid.', 409);
      }
      if (existingSession.status === 'open' && existingSession.url) {
        // The student may have returned from Stripe without completing
        // checkout. Resume the same open session instead of blocking them or
        // creating another payable session for this invoice.
        return {
          payment: existingProcessingPayment,
          checkoutUrl: existingSession.url,
          reused: true,
        };
      }
      if (existingSession.status !== 'expired') {
        throw new AppError('A checkout session is already in progress for this invoice.', 409);
      }
      await paymentService.markFailed(existingSession);
    }

    const now = new Date();
    const sessionExpiresAt = new Date(now.getTime() + 35 * 60 * 1000);
    const lockExpiresAt = new Date(sessionExpiresAt.getTime() + 10 * 60 * 1000);
    const lockedInvoice = await Invoice.findOneAndUpdate(
      {
        _id: invoice._id,
        status: { $ne: 'Paid' },
        $or: [
          { checkoutLockUntil: null },
          { checkoutLockUntil: { $exists: false } },
          { checkoutLockUntil: { $lte: now } },
        ],
      },
      { $set: { checkoutLockUntil: lockExpiresAt, checkoutSessionId: null } },
      { new: true }
    );
    if (!lockedInvoice) {
      throw new AppError('A checkout session is already in progress for this invoice.', 409);
    }

    let payment = null;
    let session = null;
    try {
      payment = await paymentRepository.create({
        invoiceId: invoice._id,
        hostelId: hostel._id,
        amount: invoice.totalDue,
        paymentStatus: 'Processing',
        paymentMethod: 'Card',
        stripeAccountId: hostel.stripeAccountId,
        chargedAmountCents: usdCents, chargedCurrency: 'usd', exchangeRate: rate,
      });

      const usdApproxFormatted = (usdCents / 100).toFixed(2);
      session = await createCheckoutSession({
        paymentId: payment._id,
        invoiceId: invoice._id,
        bookingId: invoice.bookingId,
        unitAmountCents: usdCents,
        originalAmountPKR: invoice.totalDue,
        exchangeRatePKRPerUSD: rate,
        customerEmail: student?.email,
        description: `HostelHive Rent (${invoice.billingMonth}) — PKR ${Number(invoice.totalDue).toLocaleString()} (Approx. $${usdApproxFormatted} USD)`,
        stripeAccountId: hostel.stripeAccountId,
        expiresAt: sessionExpiresAt,
      });

      payment.transactionReference = session.id;
      payment.paymentIntentId = typeof session.payment_intent === 'object' ? session.payment_intent?.id : session.payment_intent;
      await dataRepository.save(payment);

      const sessionLinked = await Invoice.findOneAndUpdate(
        { _id: invoice._id, checkoutLockUntil: lockExpiresAt, status: { $ne: 'Paid' } },
        { $set: { checkoutSessionId: session.id } },
        { new: true }
      );
      if (!sessionLinked) {
        throw new AppError('Checkout session could not be attached to the invoice.', 409);
      }

      return { payment, checkoutUrl: session.url, reused: false };
    } catch (err) {
      if (payment && !session) {
        await Payment.updateOne({ _id: payment._id, paymentStatus: 'Processing' }, { $set: { paymentStatus: 'Failed' } }).catch(() => {});
      }
      // Once Stripe has created a session, keep the invoice locked until its
      // configured expiration. Releasing it here could let a retry create a
      // second payable session if a later database write failed.
      if (!session) {
        await Invoice.findOneAndUpdate(
          { _id: invoice._id, checkoutLockUntil: lockExpiresAt },
          { $set: { checkoutLockUntil: null, checkoutSessionId: null } }
        ).catch(() => {});
      }
      throw err;
    }
  },

  /**
   * Step 2: called only from the webhook handler, after signature
   * verification, when checkout.session.completed arrives. Single source
   * of truth for "did the money actually arrive at the hostel's account."
   */
  async settleFromWebhookSession(session) {
    if (session.payment_status !== 'paid') return null;
    return require('../repositories/settlement.repository').settle(session);
  },

  async markFailed(session) {
    return require('../repositories/payment.repository').expireCheckout(session.id);
  },

  async recordPaymentIntentFailure(intent) {
    // A decline can be retried in the same open Checkout Session. Record the
    // failed attempt without turning a resumable session into a terminal failure.
    return paymentRepository.recordIntentFailure(intent);
  },

  async listForInvoice(invoiceId, user = null) {
    if (!user || !['Student', 'Admin'].includes(user.role)) {
      throw new AppError('You do not have permission to view these payments', 403);
    }

    const invoice = await invoiceRepository.findById(invoiceId);
    if (!invoice) throw new AppError('Invoice not found', 404);
    const booking = await Booking.findById(invoice.bookingId);
    if (!booking) throw new AppError('Booking for this invoice no longer exists', 404);
    if (user.role === 'Student' && booking.studentId.toString() !== user.id) {
      throw new AppError('You can only view payments for your own invoice', 403);
    }
    if (user.role === 'Admin') {
      const room = await Room.findById(booking.roomId);
      if (!user.hostelId || !room || room.hostelId.toString() !== user.hostelId.toString()) {
        throw new AppError('You cannot view payments outside your assigned hostel', 403);
      }
    }
    return paymentRepository.findByInvoice(invoiceId);
  },

  async getById(id, user = null) {
    const payment = await paymentRepository.findById(id);
    if (!payment) throw new AppError('Payment not found', 404);

    if (!user || !['Student', 'Admin'].includes(user.role)) {
      throw new AppError('You do not have permission to view this payment', 403);
    }
    if (user.role === 'Admin' && (!user.hostelId || payment.hostelId.toString() !== user.hostelId.toString())) {
      throw new AppError('You cannot view payments outside your assigned hostel', 403);
    }
    if (user.role === 'Student') {
      const invoice = await invoiceRepository.findById(payment.invoiceId);
      if (!invoice) throw new AppError('Invoice for this payment no longer exists', 404);
      const booking = await Booking.findById(invoice.bookingId);
      if (!booking) throw new AppError('Booking for this payment no longer exists', 404);
      if (booking.studentId.toString() !== user.id) {
        throw new AppError('You can only view your own payments', 403);
      }
    }

    return payment;
  },

  async loaderById(req) {
    const payment = await Payment.findById(req.params.id).select('hostelId');
    if (!payment) return null;
    return { hostelId: payment.hostelId };
  },
};

module.exports = paymentService;
