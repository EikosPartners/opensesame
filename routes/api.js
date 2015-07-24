'use strict';

module.exports = function (config) {

    var debug = require('debug')('app:routes:default' + process.pid),
        _ = require('lodash'),
        path = require('path'),
        utils = require('../utils.js')(config.secret),
        Router = require('express').Router,
        UnauthorizedAccessError = require(path.join(__dirname, '..', 'errors', 'UnauthorizedAccessError.js')),
        // User = require(path.join(__dirname, '..', 'models', 'user.js')),
        jwt = require('express-jwt');

    var authenticate = function (req, res, next) {

        console.log('Processing authenticate middleware');

        var username = req.body.user,
            password = req.body.pass;

        if (_.isEmpty(username) || _.isEmpty(password)) {
            return next(new UnauthorizedAccessError('401', {
                message: 'Invalid username or password'
            }));
        }

        process.nextTick(function () {
            config.checkUser(username, password, function (err, isMatch) {
                if (isMatch && !err) {
                    console.log('User authenticated, generating token');
                    utils.create(username, req, res, next);
                } else {
                    return next(new UnauthorizedAccessError('401', {
                        message: 'Invalid username or password'
                    }));
                }
            });

            // User.findOne({
            //     username: username
            // }, function (err, user) {
            //
            //     if (err || !user) {
            //         return next(new UnauthorizedAccessError('401', {
            //             message: 'Invalid username or password'
            //         }));
            //     }
            //
            //     user.comparePassword(password, function (err, isMatch) {
            //         if (isMatch && !err) {
            //             console.log('User authenticated, generating token');
            //             utils.create(user, req, res, next);
            //         } else {
            //             return next(new UnauthorizedAccessError('401', {
            //                 message: 'Invalid username or password'
            //             }));
            //         }
            //     });
            // });

        });


    };

    var router = new Router();

    router.route('/verify').get(function (req, res, next) {
        return res.status(200).json(undefined);
    });

    router.route('/logout').get(function (req, res, next) {
        res.clearCookie('user');
        res.redirect('/');
    });

    router.route('/login').post(authenticate, function (req, res, next) {
        res.cookie('user', req.user, {secure: true, httpOnly: true});
        res.redirect(config.redirectUrl);
    });

    router.unless = require('express-unless');

    return router;
};

console.log('Loaded');
