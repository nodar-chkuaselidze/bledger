'use strict';

const usb = require('usb');
const bledger = require('../lib/bledger');
const {LedgerBcoin} = bledger;
const Logger = require('blgr');

const Device = bledger.USB.Device;
//const Device = bledger.HID.Device;

(async () => {
  usb.setDebugLevel(4);

  const logger = new Logger({
    console: true,
    level: 'spam'
  });

  await logger.open();

  const devices = await Device.getDevices();

  const device = new Device({
    device: devices[0],
    timeout: 3000,
    logger
  });

  await device.open();

  const ledgerBcoin = new LedgerBcoin({
    device,
    logger
  });

  const pk1 = await ledgerBcoin.getPublicKey('m/44\'/0\'/0\'/0/0');
  console.log(pk1);

  await device.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
