const router = require('express').Router();
const hostelController = require('../controllers/hostel.controller');
const roomController = require('../controllers/room.controller');
const reviewController = require('../controllers/review.controller');
const paymentController = require('../controllers/payment.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const validate = require('../middleware/validate');
const hostelService = require('../services/hostel.service');
const {
  createHostelSchema,
  updateHostelSchema,
  createRoomSchema,
  chatbotInfoSchema,
  exploreHostelsQuerySchema,
  roomCatalogParamsSchema,
  roomOptionsQuerySchema,
  publishHostelSchema,
} = require('../validators/hostel.validator');
const { createReviewSchema } = require('../validators/review.validator');

// Public / student-facing search — no auth required (matches Table 10: GET /api/hostels, None input)
router.get('/', hostelController.search);
router.get('/explore', validate(exploreHostelsQuerySchema, 'query'), hostelController.searchExplore);
router.get('/:id', hostelController.getById);
router.get('/:id/rooms', hostelController.listRooms);
// Public discovery, same access policy as hostel details and the legacy rooms list.
router.get('/:id/room-catalog', validate(roomCatalogParamsSchema, 'params'), hostelController.roomCatalog);
router.get('/:id/room-options', validate(roomCatalogParamsSchema, 'params'), validate(roomOptionsQuerySchema, 'query'), hostelController.roomOptions);

// Admin-only mutations, scoped to their own hostel branch
router.post('/', authenticate, requireRole('Admin'), validate(createHostelSchema), hostelController.create);
router.post('/:id/publish', authenticate, requireRole('Admin'), validate(roomCatalogParamsSchema, 'params'),
  scopeToOwnHostel(hostelService.loaderById), validate(publishHostelSchema), hostelController.publish);
router.put(
  '/:id',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(hostelService.loaderById),
  validate(updateHostelSchema),
  hostelController.update
);
router.delete(
  '/:id',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(hostelService.loaderById),
  hostelController.remove
);

router.post(
  '/:id/rooms',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(hostelService.loaderById),
  validate(createRoomSchema),
  roomController.create
);

// Reviews — nested under hostels per the corrected API design (Part 5 of the
// understanding doc). Public read, Student/Resident-only write.
router.get('/:hostelId/reviews', reviewController.listForHostel);
router.post(
  '/:hostelId/reviews',
  authenticate,
  requireRole('Student'),
  validate(createReviewSchema),
  reviewController.create
);

// Stripe Connect onboarding — Admin connects the hostel to receive rent
// payments directly (destination charges; HostelHive never holds funds).
router.get(
  '/:hostelId/stripe/onboard',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(hostelService.loaderByHostelIdParam),
  paymentController.getOnboardingLink
);
router.get(
  '/:hostelId/stripe/status',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(hostelService.loaderByHostelIdParam),
  paymentController.getOnboardingStatus
);

// AI Chatbot grounding — Admin's "one-page form" of hostel facts.
// Public read (residents' chat sessions need this indirectly via the
// chatbot service, but there's no harm in it being directly readable too —
// it's the same info shown on the hostel details page).
router.get('/:hostelId/chatbot-info', hostelController.getChatbotInfo);
router.put(
  '/:hostelId/chatbot-info',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(hostelService.loaderByHostelIdParam),
  validate(chatbotInfoSchema),
  hostelController.updateChatbotInfo
);

module.exports = router;
