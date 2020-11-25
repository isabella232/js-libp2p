'use strict'
/* eslint-env mocha */

const { expect } = require('aegir/utils/chai')
const sinon = require('sinon')
const AddressManager = require('../../src/address-manager')
const TransportManager = require('../../src/transport-manager')
const Transport = require('libp2p-tcp')
const mockUpgrader = require('../utils/mockUpgrader')
const multiaddr = require('multiaddr')
const addrs = [
  multiaddr('/ip4/127.0.0.1/tcp/0'),
  multiaddr('/ip4/0.0.0.0/tcp/0')
]
const NatManager = require('../../src/nat-manager')
const delay = require('delay')

describe('Nat Manager (TCP)', () => {
  let am
  let tm
  let nm

  beforeEach(async () => {
    am = new AddressManager({ listen: addrs })
    tm = new TransportManager({
      libp2p: {
        addressManager: am
      },
      upgrader: mockUpgrader,
      onConnection: () => {}
    })
    nm = new NatManager({
      peerId: 'peer-id',
      addressManager: am,
      transportManager: tm,
      enabled: true
    })

    tm.add(Transport.prototype[Symbol.toStringTag], Transport)
    await tm.listen()
  })

  afterEach(async () => {
    await nm.stop()
    await tm.removeAll()
    expect(tm._transports.size).to.equal(0)
  })

  it('should map TCP connections to external ports', async () => {
    nm._client = {
      externalIp: sinon.stub().resolves('82.3.1.5'),
      map: sinon.stub()
    }

    let announce = am.getAnnounceAddrs().map(ma => ma.toString())
    expect(announce).to.be.empty()

    await nm._start()

    announce = am.getAnnounceAddrs().map(ma => ma.toString())
    expect(announce).to.not.be.empty()

    const internalPorts = tm.getAddrs()
      .filter(ma => ma.isThinWaistAddress())
      .map(ma => ma.toOptions())
      .filter(({ host, transport }) => host !== '127.0.0.1' && transport === 'tcp')
      .map(({ port }) => port)

    expect(nm._client.map.called).to.be.true()

    internalPorts.forEach(port => {
      expect(nm._client.map.getCall(0).args[0]).to.include({
        privatePort: port,
        protocol: 'TCP'
      })
    })
  })

  it('should not map TCP connections when double-natted', async () => {
    nm._client = {
      externalIp: sinon.stub().resolves('192.168.1.1'),
      map: sinon.stub()
    }

    let announce = am.getAnnounceAddrs().map(ma => ma.toString())
    expect(announce).to.be.empty()

    await expect(nm._start()).to.eventually.be.rejectedWith(/double NAT/)

    announce = am.getAnnounceAddrs().map(ma => ma.toString())
    expect(announce).to.be.empty()

    expect(nm._client.map.called).to.be.false()
  })

  it('should do nothing when disabled', async () => {
    nm = new NatManager({
      peerId: 'peer-id',
      addressManager: am,
      transportManager: tm,
      enabled: false
    })

    nm._client = {
      externalIp: sinon.stub().resolves('82.3.1.5'),
      map: sinon.stub()
    }

    nm.start()

    await delay(100)

    expect(nm._client.externalIp.called).to.be.false()
    expect(nm._client.map.called).to.be.false()
  })
})
