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

    this.strategy = new (PayPalPassport.Strategy)(envStrategyArgs(env, config),
        // Delay bind this function so that you can set saveToPersistentStore on your own OR in subclass proto.
        function (expressRequest, accessToken, refreshToken, profile, done) {
            return this.saveToPersistentStore(expressRequest, accessToken, refreshToken, profile, done);
        }
    );

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