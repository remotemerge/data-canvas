/**
 * The build's version string, recorded in exported archives for diagnostics.
 *
 * A constant rather than a read of `package.json`: importing that file would pull it into the
 * browser bundle, and the value is only ever used as an opaque label.
 */
export const APP_VERSION = '0.1.0';
