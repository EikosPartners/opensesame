# OpenSesame
[![Build Status](https://travis-ci.org/EikosPartners/opensesame.svg?branch=master)](https://travis-ci.org/EikosPartners/opensesame)

OpenSesame is a authentication system that provides authentication through the use of Json Web Tokens (JWT) and secure, httpOnly cookies. It provides a login page and a register page but allows for custom login and register pages as well.

It provides the following routes for authentication purposes:
### API
- _POST_ __/auth/login__ - Authenticates a user using the value of req.body which is passed to the user-provided __config.checkUser__ function. Sets a cookie with the JWT on the client on sucess and redirects to __config.redirectUrl__
- _POST_ __/auth/register__ - Registers a user using the value of req.body and the user-provided __config.registerUser__ function. On success it logs the user in the same way /auth/login does.
- _GET_ __/auth/logout__ - Clears the cookie on the client and redirects to / effectively logging the user out.
- _GET_ __/auth/verify__ - Returns 200 when the user is authenticated.
- _GET_ __/auth/refresh__ - Generates a new JWT for an already authenticated user and sets their cookie to it.

### Views
- _GET_ __/login__ - Shows a default login page
- _GET_ __/register__ - Shows a default registration page


## Configuration options
The following are options that can be passed to opensesame:
### Required

- __secret__ - A string which is used by the JWT library to crpytographically sign and verify JWTs.
- __checkUser__ - A function that takes the object that the login page sends to the server and calls a callback with either an error or the user object that will be stored on the JWT. Should check that the username and password are correct. _function checkUser(userObject, callback)_
- __registerUser__ - A function that takes the object that the registration page sends to the server and calls a callback with either an error or the user object that will be stored on the JWT. Should store the user credentials somewhere for later lookup by the checkUser function. _function registerUser(userObject, callback)_
- __refreshUser__ - A function that gets an already authenticated user based on the value of the JWT. Should return an up to date user object that will be stored on the JWT. _function refreshUser(userObject, callback)_

### Optional

- __redirectUrl__ - A string specifying a route of where to redirect the user after authenticating. __/__ by default.
- __httpsOnly__ - Specifies whether the cookie should use the secure flag. If true then authentication only works over HTTPS. __true__ by default.
- __cookieKey__ - The name of the key that is set on the client browser's cookie. __auth__ by default.
- __useCookieParser__ - A flag specifying whether to use cookie parser middleware or not. OpenSesame will not work properly if cookie parser middleware is not used. __true__ by default
- __tokenExpiration__ - Specifies how long the JWT should remain valid for. Follows the [rauchg/ms(https://github.com/rauchg/ms.js)] convention. __24h__ by default.
- __loginUrl__ - The url that renders the login page. Users will be redirected here when they try to view a protected resource. __/login__ by default.
- __registerUrl__ - The url that renders the registration page. __/register__ by default.
- __customLoginPage__ - A flag that tells OpenSesame whether to set up its own login page. If true then OpenSesame will not set up the /login route and login page. __false__ by default.
- __customRegisterPage__ - A flag that tells OpenSesame whether to set up its own register page. If true then OpenSesame will not set up the /register route and register page. __false__ by default.

## Example
Check the example folder for a running example of how to use opensesame.
```
var openSesame = require('opensesame');
//you can give opensesame an express app object
openSesame({
    secret: 'testSecret',
    checkUser: function (userObject, callback) {
        if(userObject.user === 'peter' && userObject.pass === 'test1234') {
            callback(null, {username: 'peter'});
        } else {
            callback('Incorrect credentials');
        }
    },
    registerUser: function (userObject, callback) {
        callback(null, {username: 'peter'});
    },
    refreshUser: function (userObject, callback) {
        callback(null, userObject);
    },
    redirectUrl: '/app',
    httpsOnly: false
}, app);
```
```
//or have it generate one for you
var app = openSesame({
    secret: 'testSecret',
    checkUser: function (userObject, callback) {
        if(userObject.user === 'peter' && userObject.pass === 'test1234') {
            callback(null, {username: 'peter'});
        } else {
            callback('Incorrect credentials');
        }
    },
    registerUser: function (userObject, callback) {
        callback(null, {username: 'peter'});
    },
    refreshUser: function (userObject, callback) {
        callback(null, userObject);
    },
    redirectUrl: '/app',
    httpsOnly: false
});
```

Note: OpenSesame uses the cookieParser and the bodyParser.urlEncoded middleware.
