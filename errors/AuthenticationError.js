"use strict";
function AuthenticationError(code, error) {
    Error.call(this, error.message);
    Error.captureStackTrace(this, this.constructor);
    this.name = "AuthenticationError";
    this.message = error.message;
    this.code = code;
    this.status = 401;
    this.inner = error;
}

AuthenticationError.prototype = Object.create(Error.prototype);
AuthenticationError.prototype.constructor = AuthenticationError;

module.exports = AuthenticationError;
