"use strict";

module.exports = function (secret) {
    var debug = require('debug')('app:utils:' + process.pid),
        path = require('path'),
        util = require('util'),
        _ = require("lodash"),
        jsonwebtoken = require("jsonwebtoken"),
        TOKEN_EXPIRATION = 60,
        TOKEN_EXPIRATION_SEC = TOKEN_EXPIRATION * 60,
        UnauthorizedAccessError = require(path.join(__dirname, 'errors', 'UnauthorizedAccessError.js'));

    console.log("Loaded");

    return {
        create: function (user, req, res, next) {

            console.log("Create token");

            if (_.isEmpty(user)) {
                return next(new Error('User data cannot be empty.'));
            }

            var data = {
                // _id: user._id,
                username: user,
                // access: user.access,
                // name: user.name,
                // email: user.email,
                token: jsonwebtoken.sign({ _id: user._id }, secret, {
                    expiresInMinutes: TOKEN_EXPIRATION
                })
            };

            var decoded = jsonwebtoken.decode(data.token);

            data.token_exp = decoded.exp;
            data.token_iat = decoded.iat;

            console.log("Token generated for user: %s, token: %s", data.username, data.token);

            req.user = data;
            next();

            return data;

        },
        TOKEN_EXPIRATION: TOKEN_EXPIRATION,
        TOKEN_EXPIRATION_SEC: TOKEN_EXPIRATION_SEC
    };

}
