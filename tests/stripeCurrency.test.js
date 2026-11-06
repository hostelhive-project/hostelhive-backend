process.env.NODE_ENV = 'test';
const env = require('../src/config/env');
const stripeIntegration = require('../src/integrations/stripe');

describe('Stripe Currency Handling & Conversion (PKR -> USD)', () => {
  const originalPkrRate = env.pkrPerUsd;

  afterEach(() => {
    env.pkrPerUsd = originalPkrRate;
    jest.restoreAllMocks();
  });

  describe('Exchange Rate & Cent Calculation Math', () => {
    test('converts PKR 10,000 at 280 PKR/USD to 3571 cents ($35.71)', () => {
      const pkrAmount = 10000;
      const rate = 280;
      const usdCents = Math.round((pkrAmount / rate) * 100);
      expect(usdCents).toBe(3571);
      expect((usdCents / 100).toFixed(2)).toBe('35.71');
    });

    test('converts PKR 18,000 at 280 PKR/USD to 6429 cents ($64.29)', () => {
      const pkrAmount = 18000;
      const rate = 280;
      const usdCents = Math.round((pkrAmount / rate) * 100);
      expect(usdCents).toBe(6429);
      expect((usdCents / 100).toFixed(2)).toBe('64.29');
    });

    test('converts PKR 25,000 at 280 PKR/USD to 8929 cents ($89.29)', () => {
      const pkrAmount = 25000;
      const rate = 280;
      const usdCents = Math.round((pkrAmount / rate) * 100);
      expect(usdCents).toBe(8929);
      expect((usdCents / 100).toFixed(2)).toBe('89.29');
    });
  });

  describe('createCheckoutSession payload structure and mock verification', () => {
    test('builds correct session payload with unitAmountCents, metadata, and PKR descriptions', async () => {
      const stripeClient = stripeIntegration.getStripeClient();
      const mockCreate = jest.spyOn(stripeClient.checkout.sessions, 'create').mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      });

      const res = await stripeIntegration.createCheckoutSession({
        invoiceId: 'inv_abc_123',
        unitAmountCents: 3571,
        originalAmountPKR: 10000,
        exchangeRatePKRPerUSD: 280,
        customerEmail: 'student@example.com',
        description: 'HostelHive Rent (October 2026) — PKR 10,000 (Approx. $35.71 USD)',
        stripeAccountId: 'acct_test_xyz',
      });

      expect(res.id).toBe('cs_test_123');
      expect(mockCreate).toHaveBeenCalledTimes(1);

      const payload = mockCreate.mock.calls[0][0];
      expect(payload.customer_email).toBe('student@example.com');
      expect(payload.line_items).toHaveLength(1);
      expect(payload.line_items[0].price_data.currency).toBe('usd');
      expect(payload.line_items[0].price_data.unit_amount).toBe(3571);
      expect(payload.line_items[0].price_data.product_data.name).toBe(
        'HostelHive Rent (October 2026) — PKR 10,000 (Approx. $35.71 USD)'
      );
      expect(payload.line_items[0].price_data.product_data.description).toBe(
        'Original invoice amount: PKR 10,000'
      );
      expect(payload.metadata).toEqual({
        invoiceId: 'inv_abc_123',
        stripeAccountId: 'acct_test_xyz',
        originalAmountPKR: '10000',
        exchangeRatePKRPerUSD: '280',
      });
      expect(payload.payment_intent_data.transfer_data.destination).toBe('acct_test_xyz');
    });
  });

  describe('paymentService.initiateCheckout validation', () => {
    const paymentService = require('../src/services/payment.service');
    const invoiceRepository = require('../src/repositories/invoice.repository');
    const Booking = require('../src/models/Booking');
    const Room = require('../src/models/Room');
    const Hostel = require('../src/models/Hostel');
    const User = require('../src/models/User');

    const fakeRequesterId = '507f1f77bcf86cd799439011';
    const fakeInvoice = {
      _id: '507f1f77bcf86cd799439012',
      bookingId: '507f1f77bcf86cd799439013',
      totalDue: 10000,
      billingMonth: 'October 2026',
      status: 'Issued',
    };

    beforeEach(() => {
      jest.spyOn(invoiceRepository, 'findById').mockResolvedValue(fakeInvoice);
      jest.spyOn(Booking, 'findById').mockResolvedValue({
        _id: fakeInvoice.bookingId,
        studentId: { toString: () => fakeRequesterId },
        roomId: '507f1f77bcf86cd799439014',
      });
      jest.spyOn(Room, 'findById').mockResolvedValue({
        _id: '507f1f77bcf86cd799439014',
        hostelId: '507f1f77bcf86cd799439015',
      });
      jest.spyOn(Hostel, 'findById').mockResolvedValue({
        _id: '507f1f77bcf86cd799439015',
        stripeAccountId: 'acct_test_connected_123',
        stripeOnboardingComplete: true,
      });
      jest.spyOn(User, 'findById').mockResolvedValue({
        _id: fakeRequesterId,
        email: 'resident@hostelhive.com',
      });
    });

    test('fails safely with 500 AppError when PKR_PER_USD is 0 or negative', async () => {
      env.pkrPerUsd = 0;
      await expect(paymentService.initiateCheckout(fakeInvoice._id, fakeRequesterId))
        .rejects
        .toThrow('Payment processing is temporarily unavailable due to invalid exchange rate configuration.');

      env.pkrPerUsd = -100;
      await expect(paymentService.initiateCheckout(fakeInvoice._id, fakeRequesterId))
        .rejects
        .toThrow('Payment processing is temporarily unavailable due to invalid exchange rate configuration.');
    });

    test('fails safely with 500 AppError when PKR_PER_USD is NaN', async () => {
      env.pkrPerUsd = NaN;
      await expect(paymentService.initiateCheckout(fakeInvoice._id, fakeRequesterId))
        .rejects
        .toThrow('Payment processing is temporarily unavailable due to invalid exchange rate configuration.');
    });

    test('fails with 400 AppError when invoice totalDue is 0 or negative', async () => {
      env.pkrPerUsd = 280;
      jest.spyOn(invoiceRepository, 'findById').mockResolvedValue({
        ...fakeInvoice,
        totalDue: 0,
      });

      await expect(paymentService.initiateCheckout(fakeInvoice._id, fakeRequesterId))
        .rejects
        .toThrow('Invoice total due must be greater than zero to initiate checkout.');
    });

    test('settlement dispatches only a provider-confirmed paid session', async () => {
      const settlement = require('../src/repositories/settlement.repository');
      const paid = { id: 'cs_test_session', payment_status: 'paid' };
      jest.spyOn(settlement, 'settle').mockResolvedValue({ paymentStatus: 'Paid', amount: 10000 });
      expect(await paymentService.settleFromWebhookSession({ ...paid, payment_status: 'unpaid' })).toBeNull();
      expect(await paymentService.settleFromWebhookSession(paid)).toEqual({ paymentStatus: 'Paid', amount: 10000 });
      expect(settlement.settle).toHaveBeenCalledTimes(1);
    });
  });

  (process.env.RUN_LIVE_STRIPE_TESTS === 'true' ? describe : describe.skip)('Real Stripe API Session Creation (Integration Test against Stripe Testnet)', () => {
    test('creates an actual Stripe Checkout Session and returns valid checkout session with USD cents amount', async () => {
      if (!env.integrations.stripe.secretKey || !env.integrations.stripe.secretKey.startsWith('sk_test_')) {
        // Skip if no test key configured
        return;
      }

      const pkrAmount = 10000;
      const rate = 280;
      const usdCents = Math.round((pkrAmount / rate) * 100);

      const session = await stripeIntegration.createCheckoutSession({
        invoiceId: '507f1f77bcf86cd799439099',
        unitAmountCents: usdCents,
        originalAmountPKR: pkrAmount,
        exchangeRatePKRPerUSD: rate,
        customerEmail: 'test-student@hostelhive.com',
        description: `HostelHive Rent (October 2026) — PKR 10,000 (Approx. $${(usdCents / 100).toFixed(2)} USD)`,
      });

      expect(session).toBeDefined();
      expect(session.id).toMatch(/^cs_test_/);
      expect(session.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
      expect(session.amount_total).toBe(3571); // $35.71 USD in cents
      expect(session.currency).toBe('usd');
      expect(session.metadata.originalAmountPKR).toBe('10000');
      expect(session.metadata.exchangeRatePKRPerUSD).toBe('280');
      expect(session.metadata.invoiceId).toBe('507f1f77bcf86cd799439099');
    }, 20000);
  });
});
