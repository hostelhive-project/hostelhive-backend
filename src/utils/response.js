function success(res, statusCode, data, message = undefined) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

module.exports = { success };
