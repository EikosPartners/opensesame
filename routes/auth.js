'use strict';

module.exports = function (config) {

    var debug = require('debug')('opensesame'),
        _ = require('lodash'),
        path = require('path'),
        utils = require('../utils.js')(config),
        Router = require('express').Router,        
        jwt = require('express-jwt');

    var router = new Router();

    router.route('/verify').get(function (req, res, next) {
        return res.status(200).end();
    });

    router.route('/refresh').get(utils.refresh, function (req, res, next) {
        res.cookie(config.cookieKey, req.user, {secure: config.httpsOnly, httpOnly: true});
        res.status(200).end();
    });

    router.route('/logout').get(function (req, res, next) {
        res.clearCookie(config.cookieKey);
        res.redirect('/');
    });

    router.route('/login').post(utils.authenticate, function (req, res, next) {
        res.cookie(config.cookieKey, req.user, {secure: config.httpsOnly, httpOnly: true});
        if(req.query.redirectUrl) {
            res.redirect(req.query.redirectUrl);
        } else {
            res.redirect(config.redirectUrl);
        }
    });

    router.route('/register').post(utils.register, function (req, res, next) {
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
