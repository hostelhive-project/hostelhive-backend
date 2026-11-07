
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;
  let errors = err.errors;

  // Body-parser errors are client errors; never echo submitted JSON or values.
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'The request body must contain valid JSON.';
    details = undefined;
    errors = undefined;
  } else if (err.type === 'entity.too.large' || err.type === 'parameters.too.many') {
    statusCode = 413;
    message = 'The request body exceeds the allowed size.';
    details = undefined;
    errors = undefined;
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errors = {};
    const msgs = [];
    for (const [key, val] of Object.entries(err.errors || {})) {
      errors[key] = val.message;
      msgs.push(val.message);
    }
    details = msgs;
    message = msgs[0] || 'Database validation failed';
  }

  // Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    if (field === 'email') {
      message = 'An account with this email address already exists.';
    } else if (field === 'transactionReference') {
      message = 'A payment with this transaction reference has already been processed.';
    } else {
      message = field ? `A record with this ${field} already exists.` : 'Duplicate record conflict.';
    }
    details = [message];
  }

  // Mongoose cast error (bad ObjectId etc.)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ID format for ${err.path || 'resource'}`;
    details = [message];
  }

  // Multer file upload errors
  if (err.name === 'MulterError') {
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File size exceeds limit (maximum 5MB allowed per image).';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = `Unexpected upload field: ${err.field || 'file'}.`;
    } else {
      message = err.message || 'File upload error.';
    }
    details = [message];
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Your authentication session has expired or is invalid. Please log in again.';
    details = [message];
  }

  // Log internal unexpected errors
  if (!err.isOperational && statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[unexpected error] ${req.method} ${req.originalUrl.split('?')[0]}: ${err.name || 'Error'}`);
    message = 'The server could not complete your request. Please try again later.';
    details = undefined;
    errors = undefined;
  }

  const responseBody = {
    success: false,
    message,
  };

  if (errors && Object.keys(errors).length > 0) {
    responseBody.errors = errors;
  }
  if (details && details.length > 0) {
    responseBody.details = details;
  }

  res.status(statusCode).json(responseBody);
}

module.exports = errorHandler;

