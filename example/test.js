var path = require('path'),
    config = require(path.join(__dirname, 'config.json')),
    fs = require('fs'),
    express = require('express'),
    app = express();

var http_port = process.env.HTTP_PORT || 3000,
    https_port = process.env.HTTPS_PORT || 3443;


app.use(express.static(path.join(__dirname, 'public')));

app = require(path.join(__dirname, "..", "app.js"))({
    secret: config.secret,
    checkUser: require(path.join(__dirname, 'utils.js'))(config.db),
    redirectUrl: '/app',
    customLoginPage: true,
    httpsOnly: false
}, app);

app.use(express.static('bin'));

app.set('views', __dirname);
app.set('view engine', 'jade');

app.get('/login', function(req, res, next) {
    res.render('login_eikos', req.query);
});

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
