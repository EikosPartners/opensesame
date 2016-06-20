"use strict";

module.exports = function (config) {
    var debug = require('debug')('app:utils:' + process.pid),
        path = require('path'),
        util = require('util'),
        _ = require("lodash"),
        jsonwebtoken = require("jsonwebtoken"),
        secret = config.secret,
        TOKEN_EXPIRATION = config.tokenExpiration || '24h',
        UnauthorizedAccessError = require(path.join(__dirname, 'errors', 'UnauthorizedAccessError.js'));

    console.log("Loaded");

    return {
        create: function (user, req, res, next) {

            console.log("Create token");

            if (_.isEmpty(user)) {
                return next(new Error('User data cannot be empty.'));
            }

            var data = {
                user: user,
                token: jsonwebtoken.sign(user, secret, {
                    expiresIn: TOKEN_EXPIRATION
                })
            };

            var decoded = jsonwebtoken.decode(data.token);

            data.token_exp = decoded.exp;
            data.token_iat = decoded.iat;

            console.log("Token generated for user: %s, token: %s", data.username, data.token);

            req.user = data.token;
            next();

            return data;

        },
        TOKEN_EXPIRATION: TOKEN_EXPIRATION
    };

}
