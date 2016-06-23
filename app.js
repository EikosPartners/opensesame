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

    if(!config.hasOwnProperty('useCookieParser')) {
        config.useCookieParser = true;
    }

    if(!config.hasOwnProperty('loginUrl')) {
        config.loginUrl = '/login';
    }

    if(!config.hasOwnProperty('registerUrl')) {
        config.registerUrl = '/register';
    }

    if(!config.hasOwnProperty('customLoginPage')) {
        config.customLoginPage = false;
    }

    if(!config.hasOwnProperty('customRegisterPage')) {
        config.customRegisterPage = false;
    }

    //needed for login cookie
    if(config.useCookieParser) {
        app.use(cookieParser());
    }

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

    if(!config.customLoginPage || !config.customRegisterPage) {
        // needed for default login form--a custom form can use bodyParser.json()--as long as the parameters get put on req.body
        app.use(bodyParser.urlencoded({ extended: true }));
        app.set('views', path.join(__dirname, 'views'));
        app.set('view engine', 'pug');
        app.use(express.static(path.join(__dirname, 'public')));
    }

    if(!config.customLoginPage) {
        app.use(config.loginUrl, require(path.join(__dirname, 'routes/login.js')));
    }

    if(!config.customRegisterPage) {
        app.use(config.registerUrl, require(path.join(__dirname, 'routes/register.js')));
    }

    app.use(jwtCheck.unless({path: ['/auth/login', '/auth/register', config.loginUrl, config.registerUrl] }));

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

        debug('error: ', err.name)

        switch (err.name) {
            case 'AuthenticationError':
                res.redirect(config.loginUrl + '?unauthorized=' + encodeURIComponent(err.message));
                break;
            case 'UnauthorizedError':
                debug(req);
                if(req.originalUrl.indexOf('/auth/login') !== -1) {
                    // this is run when you click sign in on the login page and it redirects you back to /login
                    // if this branch was not here it would keep appending &redirectUrl=/auth/login everytime
                    // you typed a bad login
                    res.redirect(config.loginUrl + '?unauthorized=' + encodeURIComponent(err.message));
                } else {
                    res.redirect(config.loginUrl + '?unauthorized=' + encodeURIComponent(err.message) + '&redirectUrl=' + encodeURIComponent(req.originalUrl));
                }
                break;
            default:
                next(err);
        }

    });

    return app;

};
