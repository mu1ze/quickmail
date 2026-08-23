import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Domain, User } from '$lib/types';
import {
	buildAdminPermissionMatrix,
	domainIsVisibleToUser,
	effectiveDomainPermission,
	flagsFromRow,
	FULL_DOMAIN_PERMISSION,
	isFullDomainPermission,
	parseDomainPermissionFlags,
	permissionMapForUser
} from './domain-permissions';

const domain = (id: string, name: string): Domain => ({
	id,
	name,
	status: 'verified',
	region: null,
	sending_enabled: true,
	receiving_enabled: true,
	catchall_user_id: null,
	created_at: '2026-01-01T00:00:00.000Z',
	synced_at: null
});

const user = (id: string, is_admin: boolean): User => ({
	id,
	email: `${id}@example.com`,
	name: id,
	is_admin,
	created_at: '2026-01-01T00:00:00.000Z'
});

describe('domain permissions', () => {
	test('a missing row is full access', () => {
		assert.deepEqual(flagsFromRow(null), FULL_DOMAIN_PERMISSION);
		assert.equal(isFullDomainPermission(FULL_DOMAIN_PERMISSION), true);
	});

	test('stored zeros throttle that capability', () => {
		assert.deepEqual(
			flagsFromRow({
				domain_id: 'dom-1',
				can_send: 0,
				can_receive: 1,
				can_create_address: 0
			}),
			{ can_send: false, can_receive: true, can_create_address: false }
		);
	});

	test('admins ignore stored throttles', () => {
		assert.deepEqual(
			effectiveDomainPermission(
				{ is_admin: true },
				{
					domain_id: 'dom-1',
					can_send: 0,
					can_receive: 0,
					can_create_address: 0
				}
			),
			FULL_DOMAIN_PERMISSION
		);
	});

	test('a domain stays visible when the user already has mail there', () => {
		const denied = { can_send: false, can_receive: false, can_create_address: false };
		assert.equal(domainIsVisibleToUser('dom-1', denied, new Set()), false);
		assert.equal(domainIsVisibleToUser('dom-1', denied, new Set(['dom-1'])), true);
		assert.equal(
			domainIsVisibleToUser('dom-1', { ...denied, can_send: true }, new Set()),
			true
		);
	});

	test('parseDomainPermissionFlags requires all three booleans', () => {
		assert.equal(parseDomainPermissionFlags({ can_send: true }), null);
		assert.deepEqual(
			parseDomainPermissionFlags({
				domainId: 'dom-1',
				can_send: false,
				can_receive: true,
				can_create_address: true
			}),
			{ can_send: false, can_receive: true, can_create_address: true }
		);
	});

	test('permissionMapForUser defaults to full access', () => {
		const domains = [domain('dom-1', 'a.test'), domain('dom-2', 'b.test')];
		const map = permissionMapForUser(user('u1', false), domains, new Map());
		assert.deepEqual(map['dom-1'], FULL_DOMAIN_PERMISSION);
		assert.deepEqual(map['dom-2'], FULL_DOMAIN_PERMISSION);
	});

	test('buildAdminPermissionMatrix overlays stored rows and keeps admins open', () => {
		const users = [user('admin', true), user('member', false)];
		const domains = [domain('dom-1', 'a.test')];
		const matrix = buildAdminPermissionMatrix(users, domains, [
			{
				user_id: 'member',
				domain_id: 'dom-1',
				can_send: 1,
				can_receive: 0,
				can_create_address: 0
			},
			{
				user_id: 'admin',
				domain_id: 'dom-1',
				can_send: 0,
				can_receive: 0,
				can_create_address: 0
			}
		]);

		assert.deepEqual(matrix.admin['dom-1'], FULL_DOMAIN_PERMISSION);
		assert.deepEqual(matrix.member['dom-1'], {
			can_send: true,
			can_receive: false,
			can_create_address: false
		});
	});
});
