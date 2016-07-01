"use strict";

module.exports = function (config) {
    var debug = require('debug')('opensesame'),
        path = require('path'),
        util = require('util'),
        _ = require("lodash"),
        jsonwebtoken = require("jsonwebtoken"),
        secret = config.secret,
        AuthenticationError = require(path.join(__dirname, './errors/AuthenticationError.js')),
        TOKEN_EXPIRATION = config.tokenExpiration;

    let createJWT = function (user, req, res, next) {

        debug("Create token");

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
        data.decoded = decoded;

        debug("Token generated for user: %s, token: %s", user.username, data.token);

        return data;

    };

    return {
        create: createJWT,
        setAuthCookie: function (value, req, res, next) {
            res.cookie(config.cookieKey, value, {secure: config.httpsOnly, httpOnly: true});
        },
        authenticate: function (req, res, next) {
            debug('Processing authenticate middleware');
            debug('req.body: ' + JSON.stringify(req.body));
            var userObject = req.body;

            if (_.isEmpty(userObject)) {
                return next(new AuthenticationError('401', {
                    message: 'Missing username or password'
                }));
            }

            process.nextTick(function () {
                config.checkUser(userObject, function (err, user) {
                    if (user && !err) {
                        debug('User authenticated, generating token');
                        var data = createJWT(user, req, res, next);
                        req.user = data.token;
                        next();
                    } else {
                        return next(new AuthenticationError('401', {
                            message: err
                        }));
                    }
                });

            });
        },
        register: function (req, res, next) {
            debug('Processing register middleware');
            debug('req.body: ' + JSON.stringify(req.body));
            var userObject = req.body;

            if (_.isEmpty(userObject)) {
                return next(new AuthenticationError('401', {
                    message: 'Missing username or password'
                }));
            }

            if(!config.customRegisterPage && userObject.password !== userObject.password2) {
                return next(new AuthenticationError('401', {
                    message: 'Passwords do not match'
                }));
            }

            process.nextTick(function () {
                config.registerUser(userObject, function (err, user) {
                    if (user && !err) {
                        debug('User registered, generating token');
                        var data = createJWT(user, req, res, next);
                        req.user = data.token;
                        next();
                    } else {
                        return next(new AuthenticationError('401', {
                            message: err
                        }));
                    }
                });

            });
        },
        refresh: function (req, res, next) {
            debug('Processing refresh middleware')
            process.nextTick(function () {
                config.refreshUser(req.user, function (err, user) {
                    if (user && !err) {
                        debug('User refreshed, generating new token');
                        var data = createJWT(user, req, res, next);
                        req.user = data.token;
                        next();
                    } else {
                        return next(new AuthenticationError('401', {
                            message: err
                        }));
                    }
                });
            });
        },
        TOKEN_EXPIRATION: TOKEN_EXPIRATION
    };

}
