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
        var username = req.body.user,
            password = req.body.pass;

        if (_.isEmpty(username) || _.isEmpty(password)) {
            return next(new AuthenticationError('401', {
                message: 'Invalid username or password'
            }));
        }

        process.nextTick(function () {
            config.checkUser(username, password, function (err, user) {
                if (user && !err) {
                    debug('User authenticated, generating token');
                    utils.create(user, req, res, next);
                } else {
                    return next(new AuthenticationError('401', {
                        message: 'Invalid username or password'
                    }));
                }
            });

        });


    };

    var router = new Router();

    router.route('/verify').get(function (req, res, next) {
        return res.status(200).end();
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

    router.unless = require('express-unless');

    return router;
};
