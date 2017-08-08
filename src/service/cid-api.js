/**
 * Copyright 2017 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {getCookie, setCookie} from '../cookies';
import {Services} from '../services';
import {dev} from '../log';
import {dict} from '../utils/object';

const GOOGLE_API_URL = 'https://ampcid.google.com/v1/publisher:getClientId?key=';
const API_KEYS = {
  'googleanalytics': 'AIzaSyA65lEHUEizIsNtlbNo-l2K18dT680nsaM',
};

const TAG = 'GoogleCidApi';
const AMP_TOKEN = 'AMP_TOKEN';

/** @enum {string} */
const TokenStatus = {
  RETRIEVING: '$RETRIEVING',
  OPT_OUT: '$OPT_OUT',
  ERROR: '$ERROR',
};

const TIMEOUT = 30000;
const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

/**
 * Client impl for Google CID API
 */
export class GoogleCidApi {

  /**
   * @param {!Window} win
   */
  constructor(win) {
    this.win_ = win;
    /**
     * @private {!./timer-impl.Timer}
     */
    this.timer_ = Services.timerFor(this.win_);

    /**
     * @private {!Object<string, !Promise<?string>>}
     */
    this.cidPromise_ = {};
  }

  /**
   * @param {string} apiClient
   * @param {string} scope
   * @param {string=} opt_cookieName
   * @return {!Promise<?string>}
   */
  getScopedCid(apiClient, scope, opt_cookieName) {
    const url = this.getUrl_(apiClient);
    if (!url) {
      return Promise.resolve(/** @type {?string} */(null));
    }

    if (this.cidPromise_[scope]) {
      return this.cidPromise_[scope];
    }
    const cookieName = opt_cookieName || scope;
    let token;
    // Block the request if a previous request is on flight
    // Poll every 200ms. Longer interval means longer latency for the 2nd CID.
    return this.cidPromise_[scope] = this.timer_.poll(200, () => {
      token = getCookie(this.win_, AMP_TOKEN);
      return token !== TokenStatus.RETRIEVING;
    }).then(() => {
      if (token === TokenStatus.OPT_OUT) {
        return null;
      }
      if (token === TokenStatus.ERROR) {
        return getCookie(this.win_, cookieName);
      }

      if (!token) {
        this.persistToken_(TokenStatus.RETRIEVING, TIMEOUT);
      }
      return this.fetchCid_(dev().assertString(url), scope, token)
          .then(this.handleResponse_.bind(this, cookieName))
          .catch(e => {
            this.persistToken_(TokenStatus.ERROR, TIMEOUT);
            dev().error(TAG, e);
            return getCookie(this.win_, cookieName);
          });
    });
  }

  /**
   * @param {string} url
   * @param {string} scope
   * @param {?string} token
   * @return {!Promise<!JsonObject>}
   */
  fetchCid_(url, scope, token) {
    const payload = dict({
      'originScope': scope,
    });
    if (token) {
      payload['securityToken'] = token;
    }
    return this.timer_.timeoutPromise(
        TIMEOUT,
        Services.xhrFor(this.win_).fetchJson(url, {
          method: 'POST',
          ampCors: false,
          credentials: 'include',
          mode: 'cors',
          body: payload,
        }).then(res => res.json()));
  }

  /**
   * @param {string} cookieName
   * @param {!JsonObject} res
   * @return {?string}
   */
  handleResponse_(cookieName, res) {
    if (res['optOut']) {
      this.persistToken_(TokenStatus.OPT_OUT, YEAR);
      return null;
    }
    if (res['clientId']) {
      this.persistToken_(res['securityToken'], YEAR);
      setCookie(this.win_, cookieName, res['clientId'], this.expiresIn_(YEAR));
      return res['clientId'];
    } else {
      this.persistToken_(TokenStatus.ERROR, DAY);
      return getCookie(this.win_, cookieName);
    }
  }

  /**
   * @param {string} apiClient
   * @return {?string}
   */
  getUrl_(apiClient) {
    const key = API_KEYS[apiClient];
    if (!key) {
      return null;
    }
    return GOOGLE_API_URL + key;
  }

  /**
   * @param {string|undefined} tokenValue
   * @param {number} expires
   */
  persistToken_(tokenValue, expires) {
    if (tokenValue) {
      setCookie(this.win_, AMP_TOKEN, tokenValue, this.expiresIn_(expires));
    }
  }

  /**
   * @param {number} time
   * @return {number}
   */
  expiresIn_(time) {
    return this.win_.Date.now() + time;
  }
}