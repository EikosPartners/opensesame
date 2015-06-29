'use strict';

var debug = require('debug')('app:routes:default' + process.pid),
    _ = require('lodash'),
    util = require('util'),
    path = require('path'),
    bcrypt = require('bcryptjs'),
    utils = require('../utils.js'),
    Router = require('express').Router,
    UnauthorizedAccessError = require(path.join(__dirname, '..', 'errors', 'UnauthorizedAccessError.js')),
    User = require(path.join(__dirname, '..', 'models', 'user.js')),
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

        User.findOne({
            username: username
        }, function (err, user) {

            if (err || !user) {
                return next(new UnauthorizedAccessError('401', {
                    message: 'Invalid username or password'
                }));
            }

            user.comparePassword(password, function (err, isMatch) {
                if (isMatch && !err) {
                    console.log('User authenticated, generating token');
                    utils.create(user, req, res, next);
                } else {
                    return next(new UnauthorizedAccessError('401', {
                        message: 'Invalid username or password'
                    }));
                }
            });
        });

    });


};

module.exports = function () {

    var router = new Router();

    router.route('/verify').get(function (req, res, next) {
        return res.status(200).json(undefined);
    });

    router.route('/logout').get(function (req, res, next) {
        res.clearCookie('user');
        res.redirect('/');
    });

    router.route('/login').post(authenticate, function (req, res, next) {
        res.cookie('user', req.user);
        res.redirect('/');
    });

    router.unless = require('express-unless');

    return router;
};

console.log('Loaded');
