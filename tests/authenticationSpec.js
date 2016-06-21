var chai = require('chai'),
    request = require('supertest'),
    jwt = require('jsonwebtoken'),
    app = require('../app.js')({
      secret: 'test',
      checkUser: function (username, password, callback) {
            console.log(username, password);
            if(username === 'peter' && password === 'test1234') {
                callback(null, {username: 'peter'});
            } else {
                callback('Incorrect credentials');
            }
      },
      httpsOnly: false
    }),
    expect = chai.expect,
    agent = request.agent(app);

// chai.use(require('chai-string'));
// var assert = chai.assert;

/* global describe, it */
describe('Authentication Test', function () {
  describe('Login test', function () {
    it('should login', function(done) {
      agent.post('/auth/login')
        .send({ user: 'peter', pass: 'test1234' })
        .expect(302)
        .expect('set-cookie', /auth=[\w\-_]+?\.[\w\-_]+?\.[\w\-_]+; Path=\/; HttpOnly/)
        .expect(function (res) {
          var userCookieRegex = /auth=([\w\-_]+?\.[\w\-_]+?\.[\w\-_]+); Path=\/; HttpOnly/g;
          var userCookie = res.headers['set-cookie'][0];
          var matches = userCookieRegex.exec(userCookie);
          var token = matches[1];
          expect(token).to.not.be.a('null');
          expect(token).to.not.be.a('undefined');
          var decoded = jwt.verify(token, 'test');
          expect(decoded).to.be.an('object');
          expect(decoded).to.have.ownProperty('username');
          expect(decoded.username).to.equal('peter');
        })
        .end(done);
    });
    it('should verify that you are logged in', function (done) {
      agent.get('/auth/verify')
        .expect(200)
        .end(done);
    });
  });
  describe('Logout test', function () {
    it('should logout', function (done) {
      agent.get('/auth/logout')
        .expect(302)
        .expect('set-cookie', /auth=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT/)
        .end(done);
    });
  })
});
