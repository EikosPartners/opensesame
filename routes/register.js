var Router = require('express').Router;
var router = new Router();

router.route('/').get(function(req, res, next) {
    res.render('register', req.query);
});

module.exports = router;
