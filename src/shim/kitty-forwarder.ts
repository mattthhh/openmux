/** Forwarder function type for Kitty graphics transmit sequences */
export type KittyTransmitForwarder = (ptyId: string, sequence: string) => void;

/** Forwarder function type for Kitty graphics update events */
export type KittyUpdateForwarder = (ptyId: string) => void;

let kittyTransmitForwarder: KittyTransmitForwarder | null = null;
let kittyUpdateForwarder: KittyUpdateForwarder | null = null;

/**
 * Sets the Kitty transmit forwarder.
 * @param forwarder - Forwarder function or null to disable
 */
export function setKittyTransmitForwarder(forwarder: KittyTransmitForwarder | null): void {
  kittyTransmitForwarder = forwarder;
}

/**
 * Gets the current Kitty transmit forwarder.
 * @returns Current forwarder or null
 */
export function getKittyTransmitForwarder(): KittyTransmitForwarder | null {
  return kittyTransmitForwarder;
}

/**
 * Sets the Kitty update forwarder.
 * @param forwarder - Forwarder function or null to disable
 */
export function setKittyUpdateForwarder(forwarder: KittyUpdateForwarder | null): void {
  kittyUpdateForwarder = forwarder;
}

/**
 * Gets the current Kitty update forwarder.
 * @returns Current forwarder or null
 */
export function getKittyUpdateForwarder(): KittyUpdateForwarder | null {
  return kittyUpdateForwarder;
}
