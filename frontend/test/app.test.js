import test from 'node:test';
import assert from 'node:assert/strict';
test('short code comes from the last URL path segment',()=>assert.equal('/ABC_123/'.split('/').filter(Boolean).at(-1),'ABC_123'));
