import {
  buildGuestKey,
  normalizeParamId,
  parseKittySequence,
  parseTransmitParams,
  rebuildControl,
  type KittySequence,
  type TransmitParams,
} from '../sequence-utils';
import type { PendingChunk } from './id-mapper';

export type DeleteRequest = { target: 'all' } | { target: 'image'; guestKey: string | null };

export type TransmitRequest = {
  params: TransmitParams;
  guestId: string | null;
  guestNumber: string | null;
  fallbackGuestKey: string | null;
};

/**
 * Parses and resolves Kitty graphics sequences for the transmit broker.
 *
 * Handles:
 * - Parsing raw sequences into structured KittySequence objects
 * - Resolving delete requests (by ID, number, or all)
 * - Resolving transmit requests (extracting parameters and IDs)
 * - Injecting guest IDs into anonymous sequences
 */
export class SequenceParser {
  /**
   * Parse a raw Kitty graphics sequence string.
   *
   * Uses the utility function from sequence-utils to extract:
   * - Control parameters (before the semicolon)
   * - Data payload (after the semicolon)
   * - Prefix/suffix markers
   *
   * @param sequence - Raw escape sequence string
   * @returns Parsed sequence or null if invalid
   */
  parse(sequence: string): KittySequence | null {
    return parseKittySequence(sequence);
  }

  /**
   * Resolve a delete request from parsed parameters.
   *
   * Delete actions (a=d) support:
   * - d=a: Delete all images
   * - d=i: Delete by image ID (i= parameter)
   * - d=I: Delete by image number (I= parameter)
   *
   * @param parsed - Parsed Kitty sequence
   * @returns Delete request or null if not a delete action
   */
  resolveDelete(parsed: KittySequence): DeleteRequest | null {
    const deleteTarget = parsed.params.get('d') ?? '';
    if (deleteTarget === 'a') {
      return { target: 'all' };
    }
    if (deleteTarget !== 'i' && deleteTarget !== 'I') {
      return null;
    }

    const guestId = normalizeParamId(parsed.params.get('i'));
    const guestNumber = normalizeParamId(parsed.params.get('I'));
    return {
      target: 'image',
      guestKey: buildGuestKey(guestId, guestNumber),
    };
  }

  /**
   * Resolve a transmit request, handling chunked continuation.
   *
   * If the sequence lacks transmit fields (f=, t=, s=, v=, o=, m=) but
   * has ID fields (i=, I=) and there's a pending chunk, this treats
   * it as a continuation of the previous chunked transmission.
   *
   * @param params - Parsed sequence and optional pending chunk state
   * @returns Transmit request or null if invalid
   */
  resolveTransmit(params: {
    parsed: KittySequence;
    pendingChunk: PendingChunk | null;
  }): TransmitRequest | null {
    const { parsed, pendingChunk } = params;

    let transmit = parseTransmitParams(parsed);
    if (!transmit && pendingChunk) {
      const actionParam = parsed.params.get('a');
      let continuationOnlyIds = true;
      if (actionParam && actionParam !== 't' && actionParam !== 'T') {
        continuationOnlyIds = false;
      }
      for (const key of parsed.params.keys()) {
        if (key !== 'i' && key !== 'I' && key !== 'a') {
          continuationOnlyIds = false;
          break;
        }
      }
      if (continuationOnlyIds) {
        transmit = { ...pendingChunk.params, more: false };
      }
    }

    if (!transmit) return null;

    return {
      params: transmit,
      guestId: normalizeParamId(parsed.params.get('i')),
      guestNumber: normalizeParamId(parsed.params.get('I')),
      fallbackGuestKey: pendingChunk?.guestKey ?? null,
    };
  }

  /**
   * Inject a synthetic guest ID into a parsed sequence.
   *
   * Used when the guest sends a transmission without specifying
   * an image ID. We assign a synthetic ID and rebuild the sequence
   * to include it, ensuring the guest can reference the image later.
   *
   * @param params - Parsed sequence and the ID to inject
   * @returns Rebuilt sequence string with injected ID
   */
  injectGuestId(params: { parsed: KittySequence; injectedGuestId: string }): string {
    const { parsed, injectedGuestId } = params;
    parsed.params.set('i', injectedGuestId);
    const rebuiltControl = rebuildControl(parsed.params);
    return `${parsed.prefix}${rebuiltControl};${parsed.data}${parsed.suffix}`;
  }
}
