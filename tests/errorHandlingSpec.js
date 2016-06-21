var chai = require('chai'),
  request = require('supertest'),
  path = require('path'),
  opensesame = require(path.join(__dirname, '../app.js')),
  jwt = require('jsonwebtoken'),
  express = require('express'),
  AuthenticationError = require(path.join(__dirname, '../errors/AuthenticationError.js')),
  expect = chai.expect;


var config = {
    secret: 'test',
    checkUser: function (username, password, callback) {
      if(username === 'peter' && password === 'test1234') {
        callback(null, {username: 'peter'});
      } else {
        callback('Incorrect credentials');
      }
    },
    httpsOnly: false
  };


describe('Error Handling Test', function () {
  it('should run our error handler', function (done) {

    var app = express();

    app.get('/', function(req, res, next) {
      next(new Error('blah'));
    });

    app = opensesame(config, app);

    //error handler calls done--if this isn't called it'll timeout
    app.use(function (err, req, res, next) {
      done();
    });

    var agent = request.agent(app);

    agent.get('/')
      .expect(200)
      .end();
  });

  it('should not run our error handler', function (done) {

    var app = express();

    app.get('/', function(req, res, next) {
      next(new AuthenticationError('401', {
          message: 'Invalid username or password'
      }));
    });

    app = opensesame(config, app);

    //error handler makes preposterous assumption--this will cause the test to fail
    app.use(function (err, req, res, next) {
      expect(false).to.equal(true);
    });

    var agent = request.agent(app);

    agent.get('/')
      .expect(302)
      .end(done);
  });
});
