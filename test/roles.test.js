const { test, describe } = require('node:test');
const assert = require('node:assert');

const { hasRole } = require('../src/roles');

// Two shapes turn up in practice: a GuildMemberRoleManager (has .cache, a
// discord.js Collection) and a plain array of role id strings.
const withRoleManager = (ids) => ({ member: { roles: { cache: new Map(ids.map((id) => [id, {}])) } } });
const withRoleArray = (ids) => ({ member: { roles: ids } });

describe('hasRole', () => {
    test('finds a role via the role manager cache', () => {
        assert.strictEqual(hasRole(withRoleManager(['vip123']), 'vip123'), true);
    });

    test('finds a role in a plain array of ids', () => {
        assert.strictEqual(hasRole(withRoleArray(['vip123']), 'vip123'), true);
    });

    test('returns false when the member lacks the role', () => {
        assert.strictEqual(hasRole(withRoleManager(['other']), 'vip123'), false);
        assert.strictEqual(hasRole(withRoleArray(['other']), 'vip123'), false);
    });

    test('an unset role id means the feature is off, not that everyone qualifies', () => {
        assert.strictEqual(hasRole(withRoleManager(['vip123']), ''), false);
        assert.strictEqual(hasRole(withRoleManager(['vip123']), undefined), false);
    });

    test('a DM/interaction with no member does not throw', () => {
        assert.strictEqual(hasRole({}, 'vip123'), false);
        assert.strictEqual(hasRole({ member: {} }, 'vip123'), false);
    });
});
