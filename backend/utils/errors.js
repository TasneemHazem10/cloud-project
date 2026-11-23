class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function validationError(message, details) {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

function notFoundError(message) {
  return new AppError(404, 'NOT_FOUND', message);
}

module.exports = { AppError, validationError, notFoundError };
