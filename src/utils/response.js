function success(res, statusCode, data, message = undefined) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function fail(res, statusCode, message, details = undefined) {
  return res.status(statusCode).json({
    success: false,
    message,
    details,
  });
}

module.exports = { success, fail };
