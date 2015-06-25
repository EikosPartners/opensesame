var express = require('express');
var app = express();

app.get('/', function(req, res, next) {
    res.render('login');
});

module.exports = app;
