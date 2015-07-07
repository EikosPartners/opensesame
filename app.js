'use strict';

var debug = require('debug')('app:' + process.pid),
    path = require('path'),
    fs = require('fs'),
    http_port = process.env.HTTP_PORT || 3000,
    https_port = process.env.HTTPS_PORT || 3443,
    jwt = require('express-jwt'),
    cookieParser = require('cookie-parser'),
    config = require('./config.json'),
    mongoose_uri = process.env.MONGOOSE_URI || 'localhost/express-jwt-auth',
    onFinished = require('on-finished'),
    NotFoundError = require(path.join(__dirname, 'errors', 'NotFoundError.js')),
    utils = require(path.join(__dirname, 'utils.js')),
    unless = require('express-unless');

console.log('Starting application');

console.log('Loading Mongoose functionality');
var mongoose = require('mongoose');
mongoose.set('debug', true);
mongoose.connect(mongoose_uri);
mongoose.connection.on('error', function () {
    console.log('Mongoose connection error');
});
mongoose.connection.once('open', function callback() {
    console.log('Mongoose connected to the database');
});

console.log('Initializing express');
var express = require('express'), app = express();

console.log('Attaching plugins');
app.use(require('morgan')('dev'));
var bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(require('compression')());
app.use(require('response-time')());

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

app.use(express.static('public'));

app.use(jwtCheck.unless({path: ['/api/login', '/login'] }));
app.use(utils.middleware().unless({path: ['/api/login', '/login'] }));

// app.use('/', require(path.join(__dirname, 'routes', 'default.js')));
app.use('/login', require(path.join(__dirname, 'routes', 'login.js')));
app.use('/api', require(path.join(__dirname, 'routes', 'api.js'))());

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

    // next();

});

app.use(express.static('bin'));

console.log('Creating HTTP server on port: %s', http_port);
require('http').createServer(app).listen(http_port, function () {
    console.log('HTTP Server listening on port: %s, in %s mode', http_port, app.get('env'));
});

console.log('Creating HTTPS server on port: %s', https_port);
require('https').createServer({
    key: fs.readFileSync(path.join(__dirname, 'keys', 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'keys', 'server.crt')),
    ca: fs.readFileSync(path.join(__dirname, 'keys', 'ca.crt')),
    requestCert: true,
    rejectUnauthorized: false
}, app).listen(https_port, function () {
    console.log('HTTPS Server listening on port: %s, in %s mode', https_port, app.get('env'));
});
