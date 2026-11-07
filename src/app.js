const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const env = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const AppError = require('./utils/AppError');
const database = require('./config/db');
const { apiLimiter, authLimiter } = require('./middleware/ipRateLimit.middleware');

// Fully implemented (roadmap steps 1-5)
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const hostelRoutes = require('./routes/hostel.routes'); // includes Stripe Connect onboarding, reviews, chatbot-info form
const roomRoutes = require('./routes/room.routes');

// Fully implemented (roadmap steps 6-12)
const bookingRoutes = require('./routes/booking.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const paymentRoutes = require('./routes/payment.routes');
const paymentController = require('./controllers/payment.controller');
const complaintRoutes = require('./routes/complaint.routes');
const cleaningTaskRoutes = require('./routes/cleaningTask.routes');
const adminRoutes = require('./routes/admin.routes');
const notificationRoutes = require('./routes/notification.routes');
const chatbotRoutes = require('./routes/chatbot.routes');
const blockchainRoutes = require('./routes/blockchain.routes');
const uploadRoutes = require('./routes/upload.routes');

const allowedOrigins = new Set((env.cors.webOrigins || [env.cors.webOrigin]).filter(Boolean));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // In development mode, permit localhost, 127.0.0.1, and private LAN IP origins dynamically
    if (
      env.nodeEnv === 'development' &&
      /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new AppError('This browser origin is not allowed to access the API.', 403));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy', 'Retry-After'],
  optionsSuccessStatus: 204,
};

const app = express();
// Trust only the explicitly configured host proxy before deriving client IPs.
app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');

// --- Global middleware ---
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!app.locals.draining || req.path === '/health') return next();
  res.set('Retry-After', '5');
  return next(new AppError('The server is restarting. Please try again shortly.', 503));
});

// Request logs contain no query strings, auth headers or request bodies.
if (env.nodeEnv !== 'test') {
  morgan.token('safe-path', (req) => req.originalUrl.split('?')[0]);
  app.use(morgan(':method :safe-path :status :response-time ms'));
}

// Stripe webhook MUST receive the raw request body for signature verification,
// so it's registered here, before the global express.json() parser, on its
// exact path. Mounting it after express.json() would leave req.body as an
// already-parsed object instead of a Buffer, and constructWebhookEvent()
// would fail every time. Handles checkout.session.completed (resident
// payments) and account.updated (Connect onboarding progress).
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);

// Limit before parsing API bodies. Provider webhooks stay signature-verified
// above; health/readiness probes and browser preflights do not consume quotas.
app.use('/api', apiLimiter);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 100 }));

// --- Health check ---
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', env: env.nodeEnv }));
app.get('/ready', (req, res) => {
  const ready = !app.locals.draining && database.isReady();
  res.set('Cache-Control', 'no-store');
  return res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
});

// --- Routes: roadmap steps 1-5, fully implemented ---
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/hostels', hostelRoutes); // includes nested /:hostelId/reviews, /:hostelId/stripe/*, /:hostelId/chatbot-info
app.use('/api/rooms', roomRoutes);

// --- Routes: roadmap steps 6-12, fully implemented ---
app.use('/api/bookings', bookingRoutes);
app.use('/api/invoices', invoiceRoutes); // includes a manual mark-paid endpoint for offline payments
app.use('/api/payments', paymentRoutes); // webhook path is mounted separately above
app.use('/api/complaints', complaintRoutes);
app.use('/api/cleaning-tasks', cleaningTaskRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/blockchain', blockchainRoutes);
app.use('/api/upload', uploadRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
