import usb from 'usb';
import { createUSBTMCTransport } from '../transports/usbtmc.js';
import { createRigolOscilloscope } from '../drivers/rigol-oscilloscope.js';

async function test() {
  // Find any Rigol device (vendor 0x1ab1)
  const devices = usb.getDeviceList();
  const rigolDevices = devices.filter(d => d.deviceDescriptor.idVendor === 0x1ab1);

  if (rigolDevices.length === 0) {
    console.log('No Rigol devices found');
    return;
  }

  // Find the DS1000Z oscilloscope (PID 0x0517)
  const device = rigolDevices.find(d => d.deviceDescriptor.idProduct === 0x0517);
  if (!device) {
    console.log('DS1000Z oscilloscope (PID 0x0517) not found');
    console.log('Available Rigol devices:', rigolDevices.map(d => `0x${d.deviceDescriptor.idProduct.toString(16)}`).join(', '));
    return;
  }
  console.log('Using DS1000Z oscilloscope (PID 0x0517)');

  // Test with Rigol quirk mode
  const transport = createUSBTMCTransport(device, { rigolQuirk: true });
  const scope = createRigolOscilloscope(transport);

  await transport.open();
  await scope.probe();

  console.log('=== TESTING RIGOL QUIRK MODE (single REQUEST, IEEE block header) ===\n');
  console.log(`Device: ${scope.info.model} (${scope.info.serial})\n`);

  // First, test raw binary query to see what we're getting
  await transport.write(':WAV:SOUR CHAN1');
  await transport.write(':WAV:MODE NORM');
  await transport.write(':WAV:FORM BYTE');
  if (!transport.queryBinary) {
    throw new Error('Transport does not support binary queries');
  }
  const rawData = await transport.queryBinary(':WAV:DATA?');
  console.log(`Raw queryBinary returned: ${rawData.length} bytes`);
  console.log(`First 20 bytes: ${Array.from(rawData.subarray(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  if (rawData[0] === 0x23) {
    const numDigits = parseInt(String.fromCharCode(rawData[1]), 10);
    const lengthStr = rawData.subarray(2, 2 + numDigits).toString('ascii');
    console.log(`IEEE header: #${numDigits}${lengthStr} (${parseInt(lengthStr, 10)} data bytes expected)`);
  }
  console.log('');

  for (let i = 1; i <= 3; i++) {
    const wf = await scope.getWaveform('CHAN1');
    console.log(`--- Read ${i} ---`);
    console.log(`  Points: ${wf.points.length}`);

    // Check the problematic region (685-694)
    const region = wf.points.slice(685, 695).map(v => v.toFixed(2)).join(', ');
    console.log(`  Points 685-694: ${region}`);

    // Check for suspicious values (corruption showed ~-5V or huge jumps)
    const suspicious = wf.points.slice(680, 700).filter(v => v < -4 || v > 10);
    if (suspicious.length > 0) {
      console.log(`  ⚠️ SUSPICIOUS VALUES: ${suspicious.map(v => v.toFixed(2)).join(', ')}`);
    } else {
      console.log(`  ✓ No suspicious values in region 680-700`);
    }

    // Check max voltage jump in problem region
    let maxJump = 0, maxJumpIdx = 0;
    for (let j = 686; j < 693; j++) {
      const jump = Math.abs(wf.points[j+1] - wf.points[j]);
      if (jump > maxJump) { maxJump = jump; maxJumpIdx = j; }
    }
    console.log(`  Max voltage jump in 686-693: ${maxJump.toFixed(3)}V at ${maxJumpIdx}->${maxJumpIdx+1}\n`);
  }

  await transport.close();
  console.log('Done!');
}

test().catch(console.error);
