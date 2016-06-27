'use strict';

module.exports = function (config) {

    var debug = require('debug')('opensesame'),
        _ = require('lodash'),
        path = require('path'),
        utils = require('../utils.js')(config),
        Router = require('express').Router,
        AuthenticationError = require(path.join(__dirname, '../errors/AuthenticationError.js')),
        jwt = require('express-jwt');

    var authenticate = function (req, res, next) {
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
                    utils.create(user, req, res, next);
                } else {
                    return next(new AuthenticationError('401', {
                        message: err
                    }));
                }
            });

        });
    };

    var register = function (req, res, next) {
        debug('Processing register middleware');
        debug('req.body: ' + JSON.stringify(req.body));
        var userObject = req.body;

        if (_.isEmpty(userObject)) {
            return next(new AuthenticationError('401', {
                message: 'Missing username or password'
            }));
        }

        if(!config.customRegisterPage && userObject.pass !== userObject.pass2) {
            return next(new AuthenticationError('401', {
                message: 'Passwords do not match'
            }));
        }

        process.nextTick(function () {
            config.registerUser(userObject, function (err, user) {
                if (user && !err) {
                    debug('User registered, generating token');
                    utils.create(user, req, res, next);
                } else {
                    return next(new AuthenticationError('401', {
                        message: err
                    }));
                }
            });

        });
    };

    var refresh = function (req, res, next) {
        debug('Processing refresh middleware')
        process.nextTick(function () {
            config.refreshUser(req.user, function (err, user) {
                if (user && !err) {
                    debug('User refreshed, generating new token');
                    utils.create(user, req, res, next);
                } else {
                    return next(new AuthenticationError('401', {
                        message: err
                    }));
                }
            });
        });
    };

    var router = new Router();

    router.route('/verify').get(function (req, res, next) {
        return res.status(200).end();
    });

    router.route('/refresh').get(refresh, function (req, res, next) {
        res.cookie(config.cookieKey, req.user, {secure: config.httpsOnly, httpOnly: true});
        res.status(200).end();
    });

    router.route('/logout').get(function (req, res, next) {
        res.clearCookie(config.cookieKey);
        res.redirect('/');
    });

    router.route('/login').post(authenticate, function (req, res, next) {
        res.cookie(config.cookieKey, req.user, {secure: config.httpsOnly, httpOnly: true});
        if(req.query.redirectUrl) {
            res.redirect(req.query.redirectUrl);
        } else {
            res.redirect(config.redirectUrl);
        }
    });

    router.route('/register').post(register, function (req, res, next) {
        res.cookie(config.cookieKey, req.user, {secure: config.httpsOnly, httpOnly: true});
        if(req.query.redirectUrl) {
            res.redirect(req.query.redirectUrl);
        } else {
            res.redirect(config.redirectUrl);
        }
    });

    router.unless = require('express-unless');

    return router;
};
