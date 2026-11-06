const AppError = require('../utils/AppError');
const active = new Map();
let total = 0;

module.exports = (req, res, next) => {
  const key = req.user.id;
  if (total >= 4 || (active.get(key) || 0) >= 2) return next(new AppError('Uploads are busy. Please try again shortly.', 429));
  total += 1; active.set(key, (active.get(key) || 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true; total -= 1;
    const remaining = (active.get(key) || 1) - 1;
    if (remaining) active.set(key, remaining); else active.delete(key);
  };
  res.once('finish', release); res.once('close', release);
  return next();
};
