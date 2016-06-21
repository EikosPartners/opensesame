/* global require, module */

var debug = require('debug')('opensesame'),
    path = require('path'),
    fs = require('fs'),
    jwt = require('express-jwt'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    onFinished = require('on-finished'),
    unless = require('express-unless'),
    express = require('express');

module.exports = function (config, app) {

    if(!app) {
        app = express();
    }

    if(!config.hasOwnProperty('redirectUrl')) {
        config.redirectUrl = '/';
    }

    if(!config.hasOwnProperty('httpsOnly')) {
        config.httpsOnly = true;
    }

    if(!config.hasOwnProperty('cookieKey')) {
      config.cookieKey = 'auth';
    }

    if(!config.hasOwnProperty('loginUrl')) {
        config.loginUrl = '/login';
    }

    if(!config.hasOwnProperty('customLoginPage')) {
        config.customLoginPage = false;
    }

    // needed for login forms
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    //needed for login cookie
    app.use(cookieParser());

    var jwtCheck = jwt({
        secret: config.secret,
        getToken: function (req) {
            if(req.cookies[config.cookieKey]) {
                debug(req.cookies[config.cookieKey]);
                return req.cookies[config.cookieKey];
            } else {
                return null;
            }
        }
    });
    jwtCheck.unless = unless;

    if(!config.customLoginPage) {
        app.set('views', path.join(__dirname, 'views'));
        app.set('view engine', 'jade');
        app.use(express.static(path.join(__dirname, 'public')));
        app.use(config.loginUrl, require(path.join(__dirname, 'routes/login.js')));
    }

    app.use(jwtCheck.unless({path: ['/auth/login', config.loginUrl] }));

    app.use('/auth', require(path.join(__dirname, 'routes/auth.js'))(config));

    // all other requests redirect to 404
    // app.all('*', function (req, res, next) {
    //     next(new NotFoundError('404'));
    // });

    // error handler for all the applications
    app.use(function (err, req, res, next) {
        debug('err:', err);
        var errorType = typeof err,
            code = 500,
            msg = { message: 'Internal Server Error' };

        switch (err.name) {
            case 'UnauthorizedAccessError':
            case 'UnauthorizedError':
                debug(req);
                if(req.originalUrl.indexOf('/auth/login') !== -1) {
                    res.redirect(config.loginUrl + '?unauthorized=' + encodeURIComponent(err.message));
                } else {
                    res.redirect(config.loginUrl + '?unauthorized=' + encodeURIComponent(err.message) + '&redirectUrl=' + encodeURIComponent(req.originalUrl));
                }
                break;
            default:
                code = err.status;
                msg = err.inner;
                return res.status(code).json(msg);
        }

    });

    return app;

};
