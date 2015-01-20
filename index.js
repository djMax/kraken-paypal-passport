'use strict';

var Strategy = require('./strategy');
var Requestor = require('./requestor');
var passport = require('passport');

var PayPalPassport = function (env, config) {
    var envName = env;
    if (env === 'live') {
        envName = null;
    }
    if (!envName) {
        this.isLive = true;
    }
    this.environmentName = env;
    this.config = config;

    var self = this;
    this.strategy = new (PayPalPassport.Strategy)(envStrategyArgs(env, config),
        // Delay bind this function so that you can set saveToPersistentStore on your own OR in subclass proto.
        function (expressRequest, accessToken, refreshToken, profile, done) {
            self.saveToPersistentStore(expressRequest, accessToken, refreshToken, profile, done);
        }
    );
    passport.use(this.strategy);

    this.request = new Requestor(config);
};

/**
 * This only needs to be called once per app, regardless of the number of environments configured.
 * @param app The Kraken app to which the passport handlers will be attached.
 * @param done Called after the handlers have been attached to Kraken.
 */
PayPalPassport.attachToKraken = function (app, done) {
    /**
     * Setup Pasport authentication right after the core session store is setup
     */
    app.on('middleware:after:session', function addPassportToSession() {
        app.use(passport.initialize());
        app.use(passport.session());
        if (done) {
            done(app);
        }
    });
};

PayPalPassport.setSerializers = function (serialize, deserialize) {
    passport.serializeUser(serialize);
    passport.deserializeUser(deserialize);
}

PayPalPassport.logout = function (req) {
    delete req.session.returnUrl;
    req.logout();
};

PayPalPassport.prototype.sendToPayPal = function (req, res, next) {
    req.session.passportEnv = this.environmentName;
    if (req.query.returnUrl || req.body.returnUrl) {
        req.session.returnUrl = req.query.returnUrl || req.body.returnUrl;
    }
    passport.authenticate(this.environmentName, {
        scope: this.config.scopes
    })(req, res, next);
};

PayPalPassport.prototype.returnedFromPayPal = function (req, res, next) {
    if (req.session.passportEnv !== this.environmentName) {
        throw new Error('returnedFromPayPal called with a different environment than sendToPayPal');
    }
    var self = this;
    passport.authenticate(this.environmentName, function(err, user, info) {
        if (err) { return next(err); }
        if (!user) {
            res.redirect(self.failureRedirect);
        }
        req.logIn(user, function(err) {
            if (err) { return next(err); }
            res.redirect(req.session.returnUrl || '/');
        });
    })(req, res, next);
};

/**
 * The strategy class, in case you need to extend it. If you do extend it, you can replace this value
 * and new PayPalPassport() will use your extension.
 * @type {Strategy|exports}
 */
PayPalPassport.Strategy = Strategy;

module.exports = PayPalPassport;

function envStrategyArgs(env, cfg) {
    var strategyArgs = {
        clientID: cfg.client_id,
        clientSecret: cfg.secret,
        callbackURL: cfg.return_url,
        passReqToCallback: true,
        name: env
    };
    if (cfg.authorizationUrl) {
        strategyArgs.authorizationURL = cfg.authorizationUrl;
    }
    if (cfg.identityUrl) {
        strategyArgs.tokenURL = cfg.identityUrl + 'tokenservice';
        strategyArgs.profileURL = cfg.identityUrl + 'userinfo?schema=openid';
    }
    if (cfg.insecure) {
        strategyArgs.insecure = true;
    }
    if (cfg.secureProtocol) {
        strategyArgs.secureProtocol = cfg.secureProtocol;
    }
    return strategyArgs;
}