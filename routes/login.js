var Router = require('express').Router;
var router = new Router();

router.route('/').get(function(req, res, next) {
    res.render('login');
});

module.exports = router;
