const router = require('express').Router();
const blockchainController = require('../controllers/blockchain.controller');
const authenticate = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/:sourceType/:sourceId/verify', blockchainController.verify);

module.exports = router;
