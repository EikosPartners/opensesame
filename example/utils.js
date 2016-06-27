var bb = require('bluebird');
var bcrypt = require('bcryptjs');
var sql = bb.promisifyAll(require('mssql'));
bb.promisifyAll(sql.Request.prototype);

module.exports = function (config) {
    return {
        checkUser: function (userObject, callback) {
            if(userObject.user === 'peter' && userObject.pass === 'test1234') {
                callback(null, {username: 'peter'});
            } else {
                callback('Incorrect credentials');
            }
            // sql.connectAsync(config).then(function () {
            //     var request = new sql.Request();
            //     request.input('Username', sql.NVarChar, username);
            //     return request.executeAsync('getUser');
            // }).spread(function (recordsets, returnValue) {
            //     console.log(recordsets);
            //     if(recordsets[0].length === 0) {
            //         //no user with name username
            //         console.log('No user with username: ', username);
            //         return callback(null, false);
            //     } else {
            //         bcrypt.compare(password, recordsets[0][0].Password, function (err, isMatch) {
            //             if (err) {
            //                 console.log('bcrypt err: ', err);
            //                 return callback(err);
            //             }
            //             console.log('bcrypt isMatch: ', isMatch);
            //             return callback(null, isMatch);
            //         });
            //     }
            // }).catch(function(err) {
            //     console.error(err);
            //     callback(err);
            //     return;
            // });
        },
        registerUser: function (userObject, callback) {
            callback(null, {username: 'peter'});
        },
        refreshUser: function (userObject, callback) {
            callback(null, userObject);
        }
    };
};
