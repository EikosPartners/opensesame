var Router = require('express').Router;
var router = new Router();

router.route('/').get(function(req, res, next) {
    console.log('test');
    res.render('login');
});

module.exports = router;
