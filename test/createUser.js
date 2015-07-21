var path = require('path');
var bb = require('bluebird');
var bcrypt = require('bcryptjs');
var sql = bb.promisifyAll(require('mssql'));
var config = require(path.join(__dirname, 'config.json')).db;
bb.promisifyAll(sql.Request.prototype);

var args = process.argv.slice(2);

var username = args[0];
var password = args[1];

if (args.length < 2) {
    console.log("usage: node %s %s %s", path.basename(process.argv[1]), "user", "password");
    process.exit();
}

console.log("Username: %s", username);
console.log("Password: %s", password);

console.log("Creating a new user in MS SQL");

bcrypt.genSalt(10, function (err, salt) {
    if (err) {
        console.log('bcrypt genSalt err: ', err);
        return;
    }
    bcrypt.hash(password, salt, function (err, hash) {
        if (err) {
            console.log('bcrypt hash err: ', err);
            return;
        }
        password = hash
        console.log("Hashed Password: %s", password);

        sql.connectAsync(config).then(function () {
            var request = new sql.Request();
            request.input('Username', sql.NVarChar, username);
            request.input('Password', sql.NVarChar, password);
            return request.executeAsync('createUser');
        }).spread(function (recordsets, returnValue) {
            console.log('recordsets: ', recordsets);
            console.log('returnValue: ', returnValue);
        }).catch(function(err) {
            console.error(err);
        });

    });
});
