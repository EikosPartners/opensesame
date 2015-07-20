var bb = require('bluebird');
var sql = bb.promisifyAll(require('mssql'));
bb.promisifyAll(sql.Request.prototype);

module.exports = function (config) {
    return function (username, password, callback) {
        sql.connectAsync(config).then(function () {
            var request = new sql.Request();
            request.input('Username', sql.NVarChar, username);
            request.input('Password', sql.NVarChar, password);
            return request.executeAsync('checkUserName');
        }).spread(function (recordsets, returnValue) {
            console.log(recordsets);
            console.log(recordsets.length > 0);
            callback(null, recordsets.length > 0);
        }).catch(function(err) {
            console.error(err);
            callback(err);
            return;
        });
    }

}
