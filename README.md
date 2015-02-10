This module provides methods to setup one or more PayPal environments in a Kraken Node.js application with
passport.js. It provides basic controllers for outbound and incoming auth handling and scaffolding to minimize
your duplicated code for multi-environment resolution, etc. It also provides HTTP/S clients to use the credentials
you receive and automatically handle token refresh.

Here's a sample script that configures the module for multiple environments based on your config.json:

````
var util = require('util'),
    PayPalPassport = require('kraken-paypal-passport');

var MePassport = function () {
    MePassport.super_.apply(this, arguments);
};

util.inherits(MePassport, PayPalPassport);

MePassport.prototype.saveToPersistentStore = function (expressRequest, accessToken, refreshToken, profile, done) {
    // Save the profile/token info to a db and then call done
};

function configurePassport(app, config) {
    PayPalPassport.attachToKraken(app, function () {
        // You can now add handlers to the app that require the passport stuff to be sorted out by the time they run
    });

    PayPalPassport.setSerializers(function serializePassportUser(authInfo, done) {
        // Come up with an id that can be saved to the cookie (runs after saveToPersistentStore)
        done(null, some_id);
    }, function deserializePassportUser(authInfo, done) {
        // Take the id and reconstitute the user object (usually from a db)
        done(null, user_object);
    });

    var liwpConfig = config.get('loginWithPayPal');
    for (var env in liwpConfig) {
        log.debug('Creating passport environment %s', env);
        var cfg = util._extend({return_url:config.get('siteBaseUrl')+'/oauth/return'}, liwpConfig[env]);
        // You probably want to store this in some exported variable
        new MePassport(env, cfg);
    }
}
````

And the sample controllers to send and receive a user from PayPal:

````
    router.get('/login/:env', function (req, res, next) {
        return passport.environments[req.params.env].sendToPayPal(req, res, next);
    });

    router.get('/return', function (req, res, next) {
        passport.environments[req.session.passportEnv].returnedFromPayPal(req, res, next);
    });
````