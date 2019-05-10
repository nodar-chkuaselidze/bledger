/*!
 * usb.js - Ledger USB communication
 * Copyright (c) 2019, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const {assert, enforce} = require('bsert');

const usb = require('usb');
const {Lock}  = require('bmutex');

const Logger = require('blgr');
const protocol = require('../protocol');
const {LedgerProtocol, LedgerError} = protocol;
const {ProtocolWriter, ProtocolReader} = protocol;

const {Device, DeviceInfo} = require('./device');

/**
 * Ledger USB Packetsize
 * @const {Number}
 */
const PACKET_SIZE = 64;

/*
 * USB Configurations.
 */

const interfaceNumber = 2;

class USBDevice extends Device {
  constructor(options) {
    super();

    this.lock = new Lock(false);
    this.device = null;
    this._device = null;
    this._interface = null;
    this._inEP = null;
    this._outEP = null;

    this.opened = false;
    this.closed = false;

    if (options)
      this.set(options);
  }

  set(options) {
    enforce(options && typeof options === 'object', 'options', 'object');

    if (options.device != null) {
      enforce(typeof options.device === 'object', 'device', 'object');
      this.device = options.device;
      this._device = options.device._device;
    }
  }

  async open() {
    assert(this.opened === false);
    assert(this.closed === false);
    assert(this._device);
    this.opened = true;

    this._device.open();

    this._interface = this._device.interface(interfaceNumber);
    this._interface.claim();

    this._inEP = this._interface.endpoints[0];
    this._outEP = this._interface.endpoints[1];
  }

  async close() {
    assert(this.opened === true);
    assert(this.closed === false);
    assert(this._device);

    this.opened = false;
    this.closed = true;

    return new Promise((res, rej) => {
      this._interface.release((err) => {
        if (err) {
          rej(err);
          return;
        }

        this._device.close();

        this._device = null;
        this.device = null;
        res();
      });
    });
  }

  /**
   * Pads the buffer to PACKET_SIZE
   * @private
   * @param {Buffer} message
   * @returns {Buffer} - padded
   */

  _padMessage(message) {
    const paddedMessage = Buffer.alloc(PACKET_SIZE);

    message.copy(paddedMessage);
    return paddedMessage;
  }

  /**
   * Write device data
   * @private
   * @param {Buffer} data
   */

  _write(data) {
    return new Promise((resolve, reject) => {
      this._outEP.transfer(data, (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });
  }

  /**
   * Read device data
   * @private
   * @returns {Promise}
   */

  _read() {
    return new Promise((resolve, reject) => {
      this._inEP.transfer(64, (err, data) => {
        if (err || !data) {
          reject(err);
          return;
        }

        resolve(data);
      });
    });
  }

  /**
   * Exchange APDU commands with device
   * Lock
   * @param {Buffer} apdu
   * @returns {Promise<Buffer>} - Response data
   * @throws {LedgerError}
   */

  async exchange(apdu) {
    const unlock = await this.lock.lock();

    try {
      return await this._exchange(apdu);
    } finally {
      unlock();
    }
  }

  /**
   * Exchange APDU command with device
   * without lock
   * @param {Buffer} apdu
   * @returns {Promise<Buffer>} - Response data
   * @throws {LedgerError}
   */

  async _exchange(apdu) {
    assert(this.opened === true, 'Connection is not open');

    const writer = new ProtocolWriter({
      channelID: LedgerProtocol.CHANNEL_ID,
      tag: LedgerProtocol.TAG_APDU,
      data: apdu,
      packetSize: PACKET_SIZE
    });

    const reader = new ProtocolReader({
      channelID: LedgerProtocol.CHANNEL_ID,
      tag: LedgerProtocol.TAG_APDU,
      packetSize: PACKET_SIZE
    });

    const messages = writer.toMessages();

    for (const message of messages) {
      await this._write(this._padMessage(message));
    }

    while (!reader.finished) {
      const data = await this._readTimeout();

      reader.pushMessage(data);
    }

    return reader.getData();
  }

  static async getDevices() {
    const allDevices = usb.getDeviceList();
    const devices = [];

    for (const device of allDevices) {
      if (USBDeviceInfo.isLedgerDevice(device)) {
        devices.push(USBDeviceInfo.fromUSBDevice(device));
      }
    }

    return devices;
  }
}

class USBDeviceInfo extends DeviceInfo {
  constructor(options) {
    super();
    this._device = null;

    if (options)
      this.set(options);
  }

  set(options) {
    super.set(options);

    enforce(options && typeof options === 'object', 'options', 'object');
    assert(options.device, 'Device not present.');

    this._device = options.device;

    return this;
  }

  async getStringDescriptor(stringDescriptor) {
    assert(this._device);

    return new Promise((resolve, reject) => {
      this._device.getStringDescriptor(stringDescriptor, (error, str) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(str);
      });
    });
  }

  static fromOptions(options) {
    return new this().set(options);
  }

  /**
   * @param {usb.Device} device
   * @returns {USBDeviceInfo}
   */

  static fromUSBDevice(device) {
    const {deviceDescriptor} = device;

    return this.fromOptions({
      device: device,
      vendorId: deviceDescriptor.idVendor,
      productId: deviceDescriptor.idProduct
    });
  }

  /**
   * @param {usb.Device}
   * @returns {Boolean}
   */

  static isLedgerDevice(device) {
    const {deviceDescriptor} = device;

    return deviceDescriptor.idVendor === 0x2c97
      || (device.idVendor === 0x2581 && device.idProduct === 0x3b7c);
  }
}

exports.Device = USBDevice;
exports.DeviceInfo = USBDeviceInfo;
