'use strict';

module.exports = function (config) {

    var debug = require('debug')('app:' + process.pid),
        path = require('path'),
        fs = require('fs'),
        jwt = require('express-jwt'),
        bodyParser = require('body-parser'),
        cookieParser = require('cookie-parser'),
        // mongoose_uri = process.env.MONGOOSE_URI || 'localhost/express-jwt-auth',
        onFinished = require('on-finished'),
        // NotFoundError = require(path.join(__dirname, 'errors', 'NotFoundError.js')),
        unless = require('express-unless'),
        express = require('express'),
        morgan = require('morgan')('dev'),
        compression = require('compression')();
        // responseTime = require('response-time')(),
        // mongoose = require('mongoose');


    var app = express();

    console.log('Starting application');

    console.log('Loading Mongoose functionality');
    // mongoose.set('debug', true);
    // mongoose.connect(mongoose_uri);
    // mongoose.connection.on('error', function () {
    //     console.log('Mongoose connection error');
    // });
    // mongoose.connection.once('open', function callback() {
    //     console.log('Mongoose connected to the database');
    // });

    console.log('Initializing express');

    console.log('Attaching plugins');
    app.use(morgan);
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());
    app.use(compression);
    // app.use(responseTime);

    // view engine setup
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'jade');

    app.use(function (req, res, next) {

        onFinished(res, function (err) {
            console.log('[%s] finished request', req.connection.remoteAddress);
        });

        next();

    });

    var jwtCheck = jwt({
        secret: config.secret,
        getToken: function fromHeaderOrQuerystring (req) {
            if(req.cookies.user) {
                console.log(req.cookies.user.token);
                return req.cookies.user.token;
            } else {
                return null;
            }
        }
    });
    jwtCheck.unless = unless;

    app.use(express.static(path.join(__dirname, 'public')));

    app.use(jwtCheck.unless({path: ['/api/login', '/login'] }));

    app.use('/login', require(path.join(__dirname, 'routes', 'login.js')));
    app.use('/api', require(path.join(__dirname, 'routes', 'api.js'))(config));

    // all other requests redirect to 404
    // app.all('*', function (req, res, next) {
    //     next(new NotFoundError('404'));
    // });
    //
    // error handler for all the applications
    app.use(function (err, req, res, next) {
        console.log('err:', err);
        var errorType = typeof err,
            code = 500,
            msg = { message: 'Internal Server Error' };

        switch (err.name) {
            case 'UnauthorizedAccessError':
            case 'UnauthorizedError':
                res.redirect('/login');
                break;
            default:
                code = err.status;
                msg = err.inner;
                return res.status(code).json(msg);
        }

    });

    return app;

};
