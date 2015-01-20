'use strict';

var wreck = require('wreck');
var util = require('util');
var assert = require('assert');
var log = require('pine')();
var querystring = require('querystring');
var URL = require('url');

/**
 * Create an Requestor instance in the context of an appId, secret, returnUrl
 * and host (at a minimum). A requestor can perform requests against PayPal services
 * in the context of a user (defined by an access_token). A single Requestor object
 * can handle many users as each request can take the tokens in the options argument,
 * or you can pass tokens in the config to be used for all requests.
 * @constructor
 */
function Requestor(config) {
    this.config = util._extend({}, config);
    this.config.baseUrl = this.config.baseUrl || 'https://www.paypal.com/webapps/auth/';
}

module.exports = Requestor;

/**
 * Get token details from an access token (validity, scopes granted, etc)
 * @param token The access token
 * @param callback called with (error, details)
 */
Requestor.prototype.getTokenDetails = function (token, callback) {
    var body = querystring.stringify({
        'validate-Access-Token': 'Validate Access Token',
        access_token: token
    });
    wreck.post(this.config.baseUrl + 'protocol/openidconnect/v1/validatetoken', {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'Content-Length': body.length
        },
        payload: body
    }, function (wreckError, r) {
        if (wreckError) {
            return callback(wreckError);
        }
        var body;
        try {
            body = JSON.parse(r.body.toString());
        } catch (parseException) {
            return callback(parseException, null);
        }
        callback(null, body);
    });
};

/**
 * Refresh an access_token in tokenInfo using the refresh_token in tokenInfo
 * @param tokenInfo access_token and refresh_token
 * @param callback (error) - tokenInfo is modified in place
 */
Requestor.prototype.refresh = function (tokenInfo, callback) {
    var config = this.config, self = this;
    tokenInfo.access_token = tokenInfo.access_token || '<none>';

    var auth = 'Basic ' + new Buffer(config.client_id + ':' + config.secret).toString('base64');
    var poster = function (error, refresh_token) {
        if (error) {
            callback(error);
            return;
        }
        var body = querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        });
        var rqOptions = {
            headers: {
                'authorization': auth,
                'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
            },
            json: true,
            payload: body
        };
        if (self.config.strictSSL === false) {
            rqOptions.rejectUnauthorized = false;
        }
        if (self.config.secureProtocol) {
            rqOptions.secureProtocol = self.config.secureProtocol;
            rqOptions.agent = false;
        }

        self._internalRefresh(tokenInfo, config.baseUrl + 'protocol/openidconnect/v1/tokenservice', rqOptions, callback);
    };

    // Sometimes people may want to provide additional safety around the refresh token
    // In that case they can pass us a function and we'll call it before refreshing.
    // The function needs to call the poster function with either an error or the refresh token
    if (typeof(tokenInfo.refresh_token) === 'function') {
        (tokenInfo.refresh_token)(tokenInfo, poster);
    } else {
        poster(null, tokenInfo.refresh_token);
    }
};

/**
 * Call the refresh service and update the token with the response.
 * @private
 */
Requestor.prototype._internalRefresh = function (tokenInfo, url, rqOptions, callback) {
    var self = this;
    wreck.post(url, rqOptions, function (e, r, payload) {
        if (e) {
            log.warn('Failed to refresh access token: %s\n%s', e, e.stack);
            callback(e);
        } else if (r.statusCode < 200 || r.statusCode >= 300) {
            log.warn('Failed to refresh access token: %s\n%s', r.statusCode, r.headers);
            callback(new Error('HTTP Failure refreshing token '+ r.statusCode));
        } else {
            try {
                if (payload.error) {
                    log.warn('Failed to refresh access token: %s\n%s', payload.error, payload.error_description);
                    callback(new Error(payload.error));
                    return;
                }
                self._updateToken(tokenInfo, payload.access_token);
            } catch (ex) {
                log.warn('Invalid body received from token refresh: %s\n%s', ex, payload);
                callback(ex);
                return;
            }
            callback(null);
        }
    });
};

/**
 * Private method to update the tokenInfo with a new token and optionally call the
 * access_token_updated callback on tokenInfo in case somebody wants to know about it.
 * @private
 */
Requestor.prototype._updateToken = function (tokenInfo, new_token) {
    tokenInfo.access_token = new_token;
    log.debug('Successfully refreshed access token.');
    if (tokenInfo.access_token_updated) {
        tokenInfo.access_token_updated(tokenInfo);
    }
};

/**
 * Adorn a wreck request option object with the appropriate Authorization header
 * and other options for a particular token
 * @private
 */
Requestor.prototype._setRequestOptions = function (tokenInfo, options) {
    options.headers = options.headers || {};
    options.headers.authorization = 'Bearer ' + tokenInfo.access_token;
    if (this.config.strictSSL === false) {
        options.rejectUnauthorized = false;
    }
    if (this.config.secureProtocol) {
        options.secureProtocol = this.config.secureProtocol;
        options.agent = false;
    }
};

/**
 * Make an HTTP/HTTPS request given the access_token in options.tokens, and refresh if necessary.
 * @param options Normal wreck options, and tokens for the access_token and refresh_token info. You can also
 *      set json: true to have us parse the results as JSON. You can also set the tokens property on the Liwp
 *      object itself, if you intend to make all calls with the same token.
 * @param callback (error, responseBodyOrJson, rawResponse)
 */
Requestor.prototype.request = function (options, callback) {
    options = util._extend(options);
    var config = this.config, self = this;
    var tokenInfo = options.tokens || config.tokens;

    assert(tokenInfo, 'Missing "tokens" in options argument, cannot use PayPal services without an access_token and/or refresh_token in this option.');
    assert(tokenInfo.access_token || tokenInfo.refresh_token, 'Missing access_token and refresh_token on token object. Need at least one of them.');

    if (!tokenInfo.access_token) {
        log.debug('No access_token for request, refreshing immediately.');
        return this.refresh(tokenInfo, function (refreshError) {
            if (refreshError) {
                callback(refreshError);
            } else {
                self.request(options, callback);
            }
        });
    }
    this._setRequestOptions(tokenInfo, options);

    var start = new Date().getTime();
    wreck.request(options.method, options.url, options, function (error, response) {
        log.debug('%s %s (%s elapsed): %s', options.method, options.url, new Date().getTime() - start, response?response.statusCode:error);
        if (error) {
            log.error('PayPal request error: %s\n%s', error.message, error.stack);
            return callback(error);
        }

        var needsRefresh = response &&
            (response.statusCode === 401 || response.statusCode === 403) &&
            !options._alreadyRefreshed;

        if (needsRefresh) {
            log.debug('Received 401 indicating expired access_token - attempting a token refresh.');
            options._alreadyRefreshed = true;
            self.refresh(tokenInfo, function (refreshError) {
                if (refreshError) {
                    callback(refreshError);
                } else {
                    self.request(options, callback);
                }
            });
        } else {
            wreck.read(response, {json: options.json}, function (readError, payload) {
                if (readError) {
                    log.error('hereapi read error: %s\n%s', readError.message, readError.stack);
                }
                if (payload && options.json && Buffer.isBuffer(payload)) {
                    try {
                        // Sometimes wreck doesn't notice it's JSON even though the caller asked
                        payload = JSON.parse(payload.toString());
                    } catch (x) {
                        log.error('Expected JSON but got something else: %s', payload.toString());
                    }
                }
                callback(readError, payload, response);
            });
        }
    });
};


var methods = {
    GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE',
    HEAD: 'HEAD', OPTIONS: 'OPTIONS', TRACE: 'TRACE',
    CONNECT: 'CONNECT', PATCH: 'PATCH'
};

/*
 * Build helper methods for http operations. Example: wreck.get, wreck.post...
 */
Object.keys(methods).forEach(function (method) {
    var fn = function (options, callback) {
        options = util._extend(options);
        options.method = method;
        return this.request(options, callback);
    };

    method = method.toLowerCase();

    Requestor.prototype[method] = fn;
});
