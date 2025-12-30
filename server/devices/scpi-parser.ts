/**
 * SCPI Response Parser
 *
 * Utilities for parsing SCPI (Standard Commands for Programmable Instruments)
 * responses. Works over any transport (USB-TMC, serial, GPIB, ethernet).
 *
 * These parsers consolidate patterns from the three existing drivers:
 * - Matrix WPS300S (PSU)
 * - Rigol DL3021 (Electronic Load)
 * - Rigol DS1000Z/DS2000 (Oscilloscope)
 */

import { Result, Ok, Err } from '../../shared/types.js';

/**
 * Rigol oscilloscopes return 9.9E37 for invalid/overflow measurements.
 * Any value above this threshold is considered invalid.
 */
const RIGOL_OVERFLOW_THRESHOLD = 9e36;

/**
 * Rigol oscilloscopes return "****" for invalid measurements (no signal).
 */
const RIGOL_INVALID_MARKER = '****';

export const ScpiParser = {
  /**
   * Parse a numeric SCPI response.
   *
   * Handles:
   * - Standard numeric responses ("1.234", "-5.67E-3")
   * - Rigol invalid markers ("****")
   * - Rigol overflow values (9.9E37)
   * - "AUTO" and other non-numeric responses
   * - Empty responses
   *
   * @param response - Raw SCPI response string
   * @returns Result with parsed number, or error string describing the issue
   */
  parseNumber(response: string): Result<number, string> {
    const trimmed = response.trim();

    if (trimmed === '') {
      return Err('empty response');
    }

    if (trimmed.includes(RIGOL_INVALID_MARKER)) {
      return Err('invalid measurement (****)');
    }

    const value = parseFloat(trimmed);

    if (isNaN(value)) {
      return Err(`non-numeric response: "${trimmed}"`);
    }

    if (Math.abs(value) > RIGOL_OVERFLOW_THRESHOLD) {
      return Err('overflow (9.9E37)');
    }

    return Ok(value);
  },

  /**
   * Parse a numeric SCPI response, returning a default value on failure.
   *
   * Use this when you need a number and have a sensible default (e.g., 0).
   * For cases where missing data is an error, use parseNumber() instead.
   *
   * @param response - Raw SCPI response string
   * @param defaultValue - Value to return if parsing fails
   * @returns Parsed number or default value
   */
  parseNumberOr(response: string, defaultValue: number): number {
    const result = this.parseNumber(response);
    return result.ok ? result.value : defaultValue;
  },

  /**
   * Parse a boolean SCPI response.
   *
   * Handles common formats:
   * - "0" / "1"
   * - "OFF" / "ON"
   * - Case-insensitive
   *
   * @param response - Raw SCPI response string
   * @returns true if response indicates "on/enabled", false otherwise
   */
  parseBool(response: string): boolean {
    const val = response.trim();
    return val === '1' || val.toUpperCase() === 'ON';
  },

  /**
   * Parse a SCPI response using an enum mapping.
   *
   * @param response - Raw SCPI response string
   * @param map - Mapping from SCPI values to typed values
   * @returns Result with mapped value, or error if not found in map
   */
  parseEnum<T>(response: string, map: Record<string, T>): Result<T, string> {
    const trimmed = response.trim().toUpperCase();

    // Try exact match first
    if (trimmed in map) {
      return Ok(map[trimmed]);
    }

    // Try case-insensitive match
    for (const [key, value] of Object.entries(map)) {
      if (key.toUpperCase() === trimmed) {
        return Ok(value);
      }
    }

    const validKeys = Object.keys(map).join(', ');
    return Err(`unknown value "${trimmed}", expected one of: ${validKeys}`);
  },

  /**
   * Parse a SCPI response using an enum mapping, with a default fallback.
   *
   * @param response - Raw SCPI response string
   * @param map - Mapping from SCPI values to typed values
   * @param defaultValue - Value to return if not found in map
   * @returns Mapped value or default
   */
  parseEnumOr<T>(response: string, map: Record<string, T>, defaultValue: T): T {
    const result = this.parseEnum(response, map);
    return result.ok ? result.value : defaultValue;
  },

  /**
   * Parse an IEEE 488.2 definite length block.
   *
   * Format: #NXXXXXXXX...data...
   * - # is the header marker
   * - N is a single digit indicating how many digits follow for the length
   * - XXXXXXXX is the data length in bytes (N digits)
   * - ...data... is the binary data
   *
   * Used for binary transfers (waveforms, screenshots) over any transport.
   *
   * @param buffer - Raw buffer containing the block
   * @returns Result with extracted data buffer, or error describing the issue
   */
  parseDefiniteLengthBlock(buffer: Buffer): Result<Buffer, string> {
    if (buffer.length < 2) {
      return Err('buffer too short for definite length block');
    }

    if (buffer[0] !== 0x23) {  // '#'
      return Err('missing # header marker');
    }

    const numDigitsChar = String.fromCharCode(buffer[1]);
    const numDigits = parseInt(numDigitsChar, 10);

    if (isNaN(numDigits) || numDigits < 1 || numDigits > 9) {
      return Err(`invalid digit count: "${numDigitsChar}"`);
    }

    if (buffer.length < 2 + numDigits) {
      return Err('buffer too short for length field');
    }

    const lengthStr = buffer.slice(2, 2 + numDigits).toString('ascii');
    const dataLength = parseInt(lengthStr, 10);

    if (isNaN(dataLength)) {
      return Err(`invalid length field: "${lengthStr}"`);
    }

    const dataStart = 2 + numDigits;
    const dataEnd = dataStart + dataLength;

    if (buffer.length < dataEnd) {
      return Err(`buffer too short: expected ${dataLength} bytes, got ${buffer.length - dataStart}`);
    }

    return Ok(buffer.slice(dataStart, dataEnd));
  },

  /**
   * Check if a SCPI error response indicates success.
   *
   * Standard SCPI error format: "0,No error" or "+0,No error"
   *
   * @param response - Response from :SYST:ERR? query
   * @returns true if no error, false if error present
   */
  isErrorResponseOk(response: string): boolean {
    const trimmed = response.trim();
    return trimmed.startsWith('0,') || trimmed.startsWith('+0,');
  },

  /**
   * Parse a comma-separated SCPI response into parts.
   *
   * @param response - Raw SCPI response string
   * @returns Array of trimmed parts
   */
  parseCsv(response: string): string[] {
    return response.split(',').map(s => s.trim());
  },
};
