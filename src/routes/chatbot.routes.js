const router = require('express').Router();
const chatbotController = require('../controllers/chatbot.controller');
const authenticate = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { sendMessageSchema } = require('../validators/chatbot.validator');

router.use(authenticate);

router.post('/message', validate(sendMessageSchema), chatbotController.sendMessage);
router.get('/history', chatbotController.getHistory); // ?sessionId=...
router.get('/sessions', chatbotController.listSessions);

module.exports = router;
