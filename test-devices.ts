/**
 * Test harness to verify device drivers work with real hardware
 * Read-only operations - no setting values
 */

import usb from 'usb';
import { SerialPort } from 'serialport';
import { createUSBTMCTransport } from './server/devices/transports/usbtmc.js';
import { createSerialTransport } from './server/devices/transports/serial.js';
import { createRigolDL3021 } from './server/devices/drivers/rigol-dl3021.js';
import { createMatrixWPS300S } from './server/devices/drivers/matrix-wps300s.js';

async function testRigol() {
  console.log('\n=== Testing Rigol DL3021 ===');

  const device = usb.findByIds(0x1AB1, 0x0E11);
  if (!device) {
    console.log('Rigol DL3021 not found');
    return;
  }

  console.log('Found Rigol USB device');

  const transport = createUSBTMCTransport(device);
  const driver = createRigolDL3021(transport);

  try {
    await driver.connect();
    console.log('Connected');

    const probed = await driver.probe();
    console.log('Probe result:', probed);
    console.log('Device info:', driver.info);

    const status = await driver.getStatus();
    console.log('Status:');
    console.log('  Mode:', status.mode);
    console.log('  Output enabled:', status.outputEnabled);
    console.log('  Setpoints:', status.setpoints);
    console.log('  Measurements:');
    console.log('    Voltage:', status.measurements.voltage?.toFixed(3), 'V');
    console.log('    Current:', status.measurements.current?.toFixed(3), 'A');
    console.log('    Power:', status.measurements.power?.toFixed(3), 'W');

    await driver.disconnect();
    console.log('Disconnected');
  } catch (err) {
    console.error('Error:', err);
  }
}

async function testMatrix() {
  console.log('\n=== Testing Matrix WPS300S ===');

  const ports = await SerialPort.list();
  const serialPort = ports.find(p => /usbserial/i.test(p.path));

  if (!serialPort) {
    console.log('Matrix WPS300S not found (no usbserial port)');
    console.log('Available ports:', ports.map(p => p.path));
    return;
  }

  // On macOS, use cu. instead of tty. for outgoing connections
  const portPath = serialPort.path.replace('/dev/tty.', '/dev/cu.');
  console.log('Found serial port:', portPath);

  const transport = createSerialTransport({
    path: portPath,
    baudRate: 115200,
    commandDelay: 50,
  });
  const driver = createMatrixWPS300S(transport);

  try {
    await driver.connect();
    console.log('Connected');

    const probed = await driver.probe();
    console.log('Probe result:', probed);
    console.log('Device info:', driver.info);

    const status = await driver.getStatus();
    console.log('Status:');
    console.log('  Mode:', status.mode);
    console.log('  Output enabled:', status.outputEnabled);
    console.log('  Setpoints:');
    console.log('    Voltage:', status.setpoints.voltage?.toFixed(3), 'V');
    console.log('    Current:', status.setpoints.current?.toFixed(3), 'A');
    console.log('  Measurements:');
    console.log('    Voltage:', status.measurements.voltage?.toFixed(3), 'V');
    console.log('    Current:', status.measurements.current?.toFixed(4), 'A');
    console.log('    Power:', status.measurements.power?.toFixed(3), 'W');

    await driver.disconnect();
    console.log('Disconnected');
  } catch (err) {
    console.error('Error:', err);
  }
}

async function main() {
  console.log('Device Driver Test Harness');
  console.log('==========================');

  await testRigol();
  await testMatrix();

  console.log('\nDone!');
  process.exit(0);
}

main();
