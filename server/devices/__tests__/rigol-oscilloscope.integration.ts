/**
 * Rigol Oscilloscope Integration Tests
 *
 * These tests run against real hardware. Run manually with:
 *   npx tsx server/devices/__tests__/rigol-oscilloscope.integration.ts
 *
 * Requirements:
 *   - Rigol DS/MSO series oscilloscope connected via USB
 */

import { createUSBTMCTransport } from '../transports/usbtmc.js';
import { createRigolOscilloscope } from '../drivers/rigol-oscilloscope.js';
import type { OscilloscopeDriver } from '../types.js';

const RIGOL_VENDOR_ID = 0x1ab1;

async function findOscilloscope(): Promise<OscilloscopeDriver | null> {
  // Try to find a Rigol USB device
  const usb = await import('usb');

  const devices = usb.getDeviceList();
  for (const device of devices) {
    if (device.deviceDescriptor.idVendor === RIGOL_VENDOR_ID) {
      console.log(`Found Rigol device: VID=${device.deviceDescriptor.idVendor.toString(16)}, PID=${device.deviceDescriptor.idProduct.toString(16)}`);

      const transport = createUSBTMCTransport(device);
      const driver = createRigolOscilloscope(transport);

      const openResult = await transport.open();
      if (!openResult.ok) {
        console.log(`Failed to open transport: ${openResult.error.message}`);
        continue;
      }

      const probeResult = await driver.probe();
      if (probeResult.ok) {
        console.log(`✓ Identified: ${driver.info.model} (${driver.info.serial})`);
        return driver;
      }

      await transport.close();
    }
  }

  return null;
}

// Small delay between USB-TMC commands to avoid overwhelming the device
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runBenchmarks(driver: OscilloscopeDriver): Promise<void> {
  console.log('\n=== Transfer Time Benchmarks ===\n');

  // Benchmark 1: Status query time
  console.log('Benchmark 1: Status query...');
  const statusStart = Date.now();
  const statusResult = await driver.getStatus();
  const statusTime = Date.now() - statusStart;
  console.log(`  Status query: ${statusTime}ms`);

  if (statusResult.ok) {
    const status = statusResult.value;
    console.log(`  Trigger status: ${status.triggerStatus}`);
    console.log(`  Sample rate: ${(status.sampleRate / 1e6).toFixed(2)} MSa/s`);
    console.log(`  Memory depth: ${status.memoryDepth} points`);
    console.log(`  Channels:`, Object.keys(status.channels).filter(ch => status.channels[ch].enabled));
  } else {
    console.log(`  Error: ${statusResult.error.message}`);
  }

  await delay(100);

  // Benchmark 2: Measurement query time
  console.log('\nBenchmark 2: Single measurement...');
  const measStart = Date.now();
  const vppResult = await driver.getMeasurement('CHAN1', 'VPP');
  const measTime = Date.now() - measStart;
  console.log(`  VPP query: ${measTime}ms`);

  if (vppResult.ok) {
    const vpp = vppResult.value;
    console.log(`  Value: ${vpp !== null ? vpp.toFixed(3) : 'no signal'} V`);
  } else {
    console.log(`  Error: ${vppResult.error.message}`);
  }

  await delay(100);

  // Benchmark 3: Multiple measurements (with delays between each)
  console.log('\nBenchmark 3: Multiple measurements (sequential)...');
  const measurementTypes = ['VPP', 'VAVG', 'FREQ', 'RISE', 'FALL'];
  const results: Record<string, number | null> = {};
  const multiMeasStart = Date.now();
  for (const type of measurementTypes) {
    const measResult = await driver.getMeasurement('CHAN1', type);
    if (measResult.ok) {
      results[type] = measResult.value;
    } else {
      console.log(`    ${type}: Error - ${measResult.error.message}`);
      results[type] = null;
    }
    await delay(50);
  }
  const multiMeasTime = Date.now() - multiMeasStart;
  console.log(`  5 measurements: ${multiMeasTime}ms`);
  for (const [key, value] of Object.entries(results)) {
    console.log(`    ${key}: ${value !== null ? value : 'N/A'}`);
  }

  await delay(100);

  // Benchmark 4: Waveform transfer (NORM mode - 1200 points)
  console.log('\nBenchmark 4: Waveform transfer (NORM mode)...');
  const waveStart = Date.now();
  const waveResult = await driver.getWaveform('CHAN1');
  const waveTime = Date.now() - waveStart;

  if (waveResult.ok) {
    const waveform = waveResult.value;
    console.log(`  1200 points (NORM): ${waveTime}ms`);
    console.log(`  Actual points: ${waveform.points.length}`);
    console.log(`  X increment: ${waveform.xIncrement.toExponential(3)} s`);
    console.log(`  Y increment: ${waveform.yIncrement.toExponential(3)} V`);

    // Calculate effective transfer rate
    const bytesPerSecond = (waveform.points.length / (waveTime / 1000));
    console.log(`  Transfer rate: ${(bytesPerSecond / 1000).toFixed(1)} KB/s`);

    // Calculate possible FPS for streaming
    const possibleFps = 1000 / waveTime;
    console.log(`  Possible FPS: ${possibleFps.toFixed(1)}`);
  } else {
    console.log(`  Waveform fetch failed: ${waveResult.error.message}`);
  }

  await delay(100);

  // Benchmark 5: Screenshot transfer
  console.log('\nBenchmark 5: Screenshot transfer...');
  const screenshotStart = Date.now();
  const screenshotResult = await driver.getScreenshot();
  const screenshotTime = Date.now() - screenshotStart;

  if (screenshotResult.ok) {
    const screenshot = screenshotResult.value;
    console.log(`  Screenshot: ${screenshotTime}ms`);
    console.log(`  Size: ${(screenshot.length / 1024).toFixed(1)} KB`);
  } else {
    console.log(`  Screenshot fetch failed: ${screenshotResult.error.message}`);
  }

  await delay(100);

  // Benchmark 6: Sequential channel waveforms
  console.log('\nBenchmark 6: Sequential channel waveforms...');
  const seqStart = Date.now();
  const chan1Result = await driver.getWaveform('CHAN1');
  await delay(50);
  const chan2Result = await driver.getWaveform('CHAN2');
  const seqTime = Date.now() - seqStart;

  if (chan1Result.ok && chan2Result.ok) {
    console.log(`  2 channels sequential: ${seqTime}ms`);
    console.log(`  Per channel: ${(seqTime / 2).toFixed(0)}ms`);
  } else {
    console.log(`  Sequential fetch failed`);
  }
}

async function testStreamingPerformance(driver: OscilloscopeDriver): Promise<void> {
  console.log('\n=== Streaming Performance Test ===\n');

  const iterations = 20;
  const times: number[] = [];

  // Warm up
  console.log('Warming up...');
  await driver.getWaveform('CHAN1');
  await delay(50);

  // Test sustained waveform fetching
  console.log(`Fetching ${iterations} waveforms in tight loop...`);
  const overallStart = Date.now();

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const result = await driver.getWaveform('CHAN1');
    if (result.ok) {
      const elapsed = Date.now() - start;
      times.push(elapsed);
      process.stdout.write(`\r  Iteration ${i + 1}/${iterations}: ${elapsed}ms`);
    } else {
      console.log(`\n  Error on iteration ${i}: ${result.error.message}`);
      break;
    }
  }

  const overallTime = Date.now() - overallStart;
  console.log('\n');

  // Calculate statistics
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const fps = 1000 / avg;

  console.log('Results:');
  console.log(`  Total time: ${overallTime}ms for ${iterations} frames`);
  console.log(`  Average: ${avg.toFixed(1)}ms per frame`);
  console.log(`  Min: ${min}ms, Max: ${max}ms`);
  console.log(`  Achievable FPS: ${fps.toFixed(1)}`);
  console.log(`  Actual FPS: ${(iterations / (overallTime / 1000)).toFixed(1)}`);

  // Test with minimal delay between fetches
  console.log('\nTesting with 10ms delay between fetches...');
  const delayedTimes: number[] = [];
  const delayedStart = Date.now();

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const result = await driver.getWaveform('CHAN1');
    if (result.ok) {
      const elapsed = Date.now() - start;
      delayedTimes.push(elapsed);
      await delay(10);
    } else {
      console.log(`  Error on iteration ${i}: ${result.error.message}`);
      break;
    }
  }

  const delayedTotal = Date.now() - delayedStart;
  const delayedAvg = delayedTimes.reduce((a, b) => a + b, 0) / delayedTimes.length;
  console.log(`  With 10ms delays: ${delayedTotal}ms total, ${delayedAvg.toFixed(1)}ms avg fetch`);
  console.log(`  Effective FPS with delays: ${(iterations / (delayedTotal / 1000)).toFixed(1)}`);

  // Recommendation
  console.log('\n--- Streaming Recommendation ---');
  if (fps >= 10) {
    console.log('✓ 10+ FPS achievable - smooth real-time display possible');
  } else if (fps >= 5) {
    console.log('✓ 5-10 FPS achievable - acceptable real-time display');
  } else if (fps >= 2) {
    console.log('⚠ 2-5 FPS achievable - noticeable lag but usable');
  } else {
    console.log('✗ <2 FPS - manual refresh recommended');
  }
}

async function testBasicControl(driver: OscilloscopeDriver): Promise<void> {
  console.log('\n=== Basic Control Tests ===\n');

  // Get current state
  const initialResult = await driver.getStatus();
  if (initialResult.ok) {
    console.log(`Initial trigger status: ${initialResult.value.triggerStatus}`);
  }

  // Test stop
  console.log('Sending STOP...');
  await driver.stop();
  await new Promise(r => setTimeout(r, 100));
  const afterStopResult = await driver.getStatus();
  if (afterStopResult.ok) {
    console.log(`After stop: ${afterStopResult.value.triggerStatus}`);
  }

  // Test run
  console.log('Sending RUN...');
  await driver.run();
  await new Promise(r => setTimeout(r, 100));
  const afterRunResult = await driver.getStatus();
  if (afterRunResult.ok) {
    console.log(`After run: ${afterRunResult.value.triggerStatus}`);
  }

  // Test single
  console.log('Sending SINGLE...');
  await driver.single();
  await new Promise(r => setTimeout(r, 100));
  const afterSingleResult = await driver.getStatus();
  if (afterSingleResult.ok) {
    console.log(`After single: ${afterSingleResult.value.triggerStatus}`);
  }

  // Restore to running
  await driver.run();
}

async function main(): Promise<void> {
  console.log('=== Rigol Oscilloscope Integration Test ===\n');

  const driver = await findOscilloscope();
  if (!driver) {
    console.log('No Rigol oscilloscope found. Make sure it is connected via USB.');
    process.exit(1);
  }

  try {
    // Run benchmarks
    await runBenchmarks(driver);

    // Run streaming performance test
    await testStreamingPerformance(driver);

    // Run basic control tests
    await testBasicControl(driver);

    console.log('\n=== All tests completed ===\n');
  } finally {
    await driver.disconnect();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
