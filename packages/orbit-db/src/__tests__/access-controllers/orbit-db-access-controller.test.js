'use strict'

const assert = require('assert')
const rmrf = require('rimraf')
const OrbitDB = require('../../src/OrbitDB.js')
import { IdentityProvider } from '@dao-xyz/orbit-db-identity-provider'
const Keystore = require('orbit-db-keystore')
const OrbitDBAccessController = require('orbit-db-access-controllers/src/orbitdb-access-controller')
const AccessControllers = require('orbit-db-access-controllers')

// Include test utilities
const {
  config,
  startIpfs,
  stopIpfs,
  testAPIs
} = require('orbit-db-test-utils')

const dbPath1 = './orbitdb/tests/orbitdb-access-controller/1'
const dbPath2 = './orbitdb/tests/orbitdb-access-controller/2'

Object.keys(testAPIs).forEach(API => {
  describe(`orbit-db - OrbitDBAccessController (${API})`, function () {
    jest.setTimeout(config.timeout)

    let ipfsd1, ipfsd2, ipfs1, ipfs2, id1, id2
    let orbitdb1, orbitdb2

    beforeAll(async () => {
      rmrf.sync(dbPath1)
      rmrf.sync(dbPath2)
      ipfsd1 = await startIpfs(API, config.daemon1)
      ipfsd2 = await startIpfs(API, config.daemon2)
      ipfs1 = ipfsd1.api
      ipfs2 = ipfsd2.api

      const keystore1 = new Keystore(dbPath1 + '/keys')
      const keystore2 = new Keystore(dbPath2 + '/keys')

      id1 = await IdentityProvider.createIdentity({ id: 'A', keystore: keystore1 })
      id2 = await IdentityProvider.createIdentity({ id: 'B', keystore: keystore2 })

      orbitdb1 = await OrbitDB.createInstance(ipfs1, {
        AccessControllers: AccessControllers,
        directory: dbPath1,
        identity: id1
      })

      orbitdb2 = await OrbitDB.createInstance(ipfs2, {
        AccessControllers: AccessControllers,
        directory: dbPath2,
        identity: id2
      })
    })

    afterAll(async () => {
      if (orbitdb1) {
        await orbitdb1.stop()
      }

      if (orbitdb2) {
        await orbitdb2.stop()
      }

      if (ipfsd1) {
        await stopIpfs(ipfsd1)
      }

      if (ipfsd2) {
        await stopIpfs(ipfsd2)
      }
    })

    describe('Constructor', function () {
      let accessController

      beforeAll(async () => {
        accessController = await OrbitDBAccessController.create(orbitdb1)
      })

      test('creates an access controller', () => {
        assert.notStrictEqual(accessController, null)
        assert.notStrictEqual(accessController, undefined)
      })

      test('sets the controller type', () => {
        assert.strictEqual(accessController.type, 'orbitdb')
      })

      test('has OrbitDB instance', async () => {
        assert.notStrictEqual(accessController._orbitdb, null)
        assert.strictEqual(accessController._orbitdb.id, orbitdb1.id)
      })

      test('has IPFS instance', async () => {
        const peerId1 = await accessController._orbitdb._ipfs.id()
        const peerId2 = await ipfs1.id()
        assert.strictEqual(peerId1.id, peerId2.id)
      })

      test('sets default capabilities', async () => {
        assert.deepStrictEqual(accessController.capabilities, {
          admin: new Set([id1.id])
        })
      })

      test('allows owner to append after creation', async () => {
        const mockEntry = {
          identity: id1
          // ...
          // doesn't matter what we put here, only identity is used for the check
        }
        const canAppend = await accessController.canAppend(mockEntry, id1.provider)
        assert.strictEqual(canAppend, true)
      })
    })

    describe('grant', function () {
      let accessController

      beforeAll(async () => {
        accessController = new OrbitDBAccessController(orbitdb1)
        await accessController.load('testdb/add')
      })

      test('loads the root access controller from IPFS', () => {
        assert.strictEqual(accessController._db.access.type, 'ipfs')
        assert.deepStrictEqual(accessController._db.access.write, [id1.id])
      })

      test('adds a capability', async () => {
        try {
          await accessController.grant('write', id1.id)
        } catch (e) {
          assert(e, null)
        }
        assert.deepStrictEqual(accessController.capabilities, {
          admin: new Set([id1.id]),
          write: new Set([id1.id])
        })
      })

      test('adds more capabilities', async () => {
        try {
          await accessController.grant('read', 'ABCD')
          await accessController.grant('delete', 'ABCD')
        } catch (e) {
          assert.strictEqual(e, null)
        }
        assert.deepStrictEqual(accessController.capabilities, {
          admin: new Set([id1.id]),
          write: new Set([id1.id]),
          read: new Set(['ABCD']),
          delete: new Set(['ABCD'])
        })
      })

      test('emit \'updated\' event when a capability was added', async () => {
        return new Promise((resolve, reject) => {
          accessController.on('updated', () => {
            try {
              assert.deepStrictEqual(accessController.capabilities, {
                admin: new Set([id1.id]),
                write: new Set([id1.id]),
                read: new Set(['ABCD', 'AXES']),
                delete: new Set(['ABCD'])
              })
              resolve()
            } catch (e) {
              reject(e)
            }
          })
          accessController.grant('read', 'AXES')
        })
      })

      test('can append after acquiring capability', async () => {
        try {
          await accessController.grant('write', id1.id)
          await accessController.grant('write', id2.id)
        } catch (e) {
          assert(e, null)
        }
        const mockEntry1 = {
          identity: id1
        }
        const mockEntry2 = {
          identity: id2
        }
        const canAppend1 = await accessController.canAppend(mockEntry1, id1.provider)
        const canAppend2 = await accessController.canAppend(mockEntry2, id2.provider)
        assert.strictEqual(canAppend1, true)
        assert.strictEqual(canAppend2, true)
      })
    })

    describe('revoke', function () {
      let accessController

      beforeAll(async () => {
        accessController = new OrbitDBAccessController(orbitdb1)
        await accessController.load('testdb/remove')
      })

      test('removes a capability', async () => {
        try {
          await accessController.grant('write', id1.id)
          await accessController.grant('write', 'AABB')
          await accessController.revoke('write', 'AABB')
        } catch (e) {
          assert.strictEqual(e, null)
        }
        assert.deepStrictEqual(accessController.capabilities, {
          admin: new Set([id1.id]),
          write: new Set([id1.id])
        })
      })

      test('can remove the creator\'s write access', async () => {
        try {
          await accessController.revoke('write', id1.id)
        } catch (e) {
          assert.strictEqual(e, null)
        }
        assert.deepStrictEqual(accessController.capabilities, {
          admin: new Set([id1.id])
        })
      })

      test('can\'t remove the creator\'s admin access', async () => {
        try {
          await accessController.revoke('admin', id1.id)
        } catch (e) {
          assert.strictEqual(e, null)
        }
        assert.deepStrictEqual(accessController.capabilities, {
          admin: new Set([id1.id])
        })
      })

      test('removes more capabilities', async () => {
        try {
          await accessController.grant('read', 'ABCD')
          await accessController.grant('delete', 'ABCD')
          await accessController.grant('write', id1.id)
          await accessController.revoke('read', 'ABCDE')
          await accessController.revoke('delete', 'ABCDE')
        } catch (e) {
          assert.strictEqual(e, null)
        }
        assert.deepStrictEqual(accessController.capabilities, {
          admin: new Set([id1.id]),
          delete: new Set(['ABCD']),
          read: new Set(['ABCD']),
          write: new Set([id1.id])
        })
      })

      test('can\'t append after revoking capability', async () => {
        try {
          await accessController.grant('write', id2.id)
          await accessController.revoke('write', id2.id)
        } catch (e) {
          assert(e, null)
        }
        const mockEntry1 = {
          identity: id1
        }
        const mockEntry2 = {
          identity: id2
        }
        const canAppend = await accessController.canAppend(mockEntry1, id1.provider)
        const noAppend = await accessController.canAppend(mockEntry2, id2.provider)
        assert.strictEqual(canAppend, true)
        assert.strictEqual(noAppend, false)
      })

      test('emits \'updated\' event when a capability was removed', async () => {
        await accessController.grant('admin', 'cats')
        await accessController.grant('admin', 'dogs')

        return new Promise((resolve, reject) => {
          accessController.on('updated', () => {
            try {
              assert.deepStrictEqual(accessController.capabilities, {
                admin: new Set([id1.id, 'dogs']),
                delete: new Set(['ABCD']),
                read: new Set(['ABCD']),
                write: new Set([id1.id])
              })
              resolve()
            } catch (e) {
              reject(e)
            }
          })
          accessController.revoke('admin', 'cats')
        })
      })
    })

    describe('save and load', function () {
      let accessController, dbName

      beforeAll(async () => {
        dbName = 'testdb-load-' + new Date().getTime()
        accessController = new OrbitDBAccessController(orbitdb1)
        await accessController.load(dbName)
        await accessController.grant('write', 'A')
        await accessController.grant('write', 'B')
        await accessController.grant('write', 'C')
        await accessController.grant('write', 'C') // double entry
        await accessController.grant('another', 'AA')
        await accessController.grant('another', 'BB')
        await accessController.revoke('another', 'AA')
        await accessController.grant('admin', id1.id)
        return new Promise((resolve) => {
          // Test that the access controller emits 'updated' after it was loaded
          accessController.on('updated', () => resolve())
          accessController.load(accessController.address)
        })
      })

      test('has the correct database address for the internal db', async () => {
        const addr = accessController._db.address.toString().spltest('/')
        assert.strictEqual(addr[addr.length - 1], '_access')
        assert.strictEqual(addr[addr.length - 2], dbName)
      })

      test('has correct capabalities', async () => {
        assert.deepStrictEqual(accessController.get('admin'), new Set([id1.id]))
        assert.deepStrictEqual(accessController.get('write'), new Set(['A', 'B', 'C']))
        assert.deepStrictEqual(accessController.get('another'), new Set(['BB']))
      })
    })
  })
  // TODO: use two separate peers for testing the AC
  // TODO: add tests for revocation correctness with a database (integration tests)
})
