'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src');
test('allows only HTTP(S) destinations', () => { assert.equal(_test.validUrl('javascript:alert(1)'), null); assert.equal(_test.validUrl('https://example.com/a'), 'https://example.com/a'); });
test('rejects malformed JSON', () => assert.equal(_test.bodyOf({ body: '{' }), null));
test('sets expiration to 30 days', () => assert.equal(_test.ttlSeconds, 30 * 86400));
