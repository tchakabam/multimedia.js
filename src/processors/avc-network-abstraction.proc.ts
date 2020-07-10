import { Processor, ProcessorEvent } from '../core/processor';
import { Packet, PacketSymbol } from '../core/packet';
import { InputSocket, SocketDescriptor, SocketType } from '../core/socket';

import { BufferSlice } from '../core/buffer';

import { getLogger, LoggerLevel } from '../logger';
import { debugAccessUnit, debugNALU, makeAccessUnitFromNALUs, parseNALU, H264NaluType } from './h264/h264-tools';
import { AvcCodecDataBox } from './mozilla-rtmpjs/mp4iso-boxes';
import { H264ParameterSetParser } from '../ext-mod/inspector.js/src/codecs/h264/param-set-parser';
import { Sps, Pps } from '../ext-mod/inspector.js/src/codecs/h264/nal-units';
import { AvcC } from '../ext-mod/inspector.js/src/demuxer/mp4/atoms/avcC';

const { debug, log, warn, error } = getLogger('AVCNetworkAbstractionProcessor', LoggerLevel.OFF, true);

const ENABLE_PACKAGE_SPS_PPS_NALUS_TO_AVCC_BOX_HACK = true; // TODO: make these runtime options
const ENABLE_PACKAGE_OTHER_NALUS_TO_ACCESS_UNITS = true; // TODO: make these runtime options

const DEBUG_H264 = false;
export class AVCNetworkAbstractionProcessor extends Processor {

  private _spsSliceCache: BufferSlice = null;
  private _ppsSliceCache: BufferSlice = null;
  private _seiCache: BufferSlice = null;

  static getName (): string {
    return 'H264ParseProcessor';
  }

  constructor () {
    super();

    this.createInput();
    this.createOutput();
  }

  templateSocketDescriptor (st: SocketType): SocketDescriptor {
    return new SocketDescriptor();
  }

  protected processTransfer_ (inS: InputSocket, p: Packet) {
    log('parsing packet:', p.toString());
    p.forEachBufferSlice(this._onBufferSlice.bind(this, p), null, this);
    return true;
  }

  private _attempWriteAvcCDataFromSpsPpsCache(): BufferSlice {
    if (!this._spsSliceCache || !this._ppsSliceCache) {
      return null;
    }

    const spsInfo: Sps = H264ParameterSetParser.parseSPS(this._spsSliceCache.getUint8Array().subarray(1));
    //const ppsInfo: Pps = H264ParameterSetParser.parsePPS(this._ppsSliceCache.getUint8Array().subarray(1));

    DEBUG_H264 && debugNALU(this._spsSliceCache)
    DEBUG_H264 && debugNALU(this._ppsSliceCache);

    const avcCodecDataBox: AvcCodecDataBox = new AvcCodecDataBox(
      [this._spsSliceCache.getUint8Array()],
      [this._ppsSliceCache.getUint8Array()],
      spsInfo.profileIdc,
      64, // "profileCompatibility" - not sure exactly what this does but this value is in other common test-data
      spsInfo.levelIdc
    )

    // layout, allocate and write AvcC box
    const numBytesAlloc = avcCodecDataBox.layout(0);
    const bufferSlice = BufferSlice.allocateNew(numBytesAlloc);
    avcCodecDataBox.write(bufferSlice.getUint8Array());

    // Reset here if need to handle multiple embedded SPS/PPS in stream
    ///*
    this._spsSliceCache = null;
    this._ppsSliceCache = null;
    //*/

    log('created AvcC atom data !')

    // we need to unwrap the first 8 bytes of iso-boxing because
    // downstream we only expect the actual atom payload data
    return bufferSlice.shrinkFront(8);
  }

  private _onBufferSlice (p: Packet, bufferSlice: BufferSlice) {

    // TODO: Move tagging here and use mime-type check also as fallback

    if (p.defaultPayloadInfo.tags.has('nalu')) {

      debug('input packet is tagged as raw NALU (not access-unit) with tags:', p.defaultPayloadInfo.tags)

      DEBUG_H264 && debugNALU(bufferSlice)

      const propsCache = bufferSlice.props;
      const naluType = parseNALU(bufferSlice).nalType;

      if (naluType === H264NaluType.AUD) {
        warn('dropping AUD NALU')
        return;
      }

      if (naluType === H264NaluType.SEI) {
        this._seiCache = bufferSlice;
        //warn('dropping SEI NALU');
        return;

      // cache last SPS/PPS slices
      } else if (naluType === H264NaluType.SPS) {

        /**
         * HACK to allow using RTMPJS-MP4-mux (expects AvcC atom as "bitstream-header")
         */
        if (ENABLE_PACKAGE_SPS_PPS_NALUS_TO_AVCC_BOX_HACK) {

          if (this._spsSliceCache) {
            bufferSlice = null;
          } else {
            this._spsSliceCache = bufferSlice;
            bufferSlice = null;
            const avcCDataSlice = this._attempWriteAvcCDataFromSpsPpsCache();
            if (avcCDataSlice) {
              bufferSlice = avcCDataSlice;
              bufferSlice.props = propsCache;
              bufferSlice.props.isBitstreamHeader = true;
            }
          }
        }

      } else if (naluType === H264NaluType.PPS) {

        /**
         * HACK to allow using RTMPJS-MP4-mux (expects AvcC atom as "bitstream-header")
         */
        if (ENABLE_PACKAGE_SPS_PPS_NALUS_TO_AVCC_BOX_HACK) {

          if (this._ppsSliceCache) {
            bufferSlice = null;
          } else {
            this._ppsSliceCache = bufferSlice;
            bufferSlice = null;
            const avcCDataSlice = this._attempWriteAvcCDataFromSpsPpsCache();
            if (avcCDataSlice) {
              bufferSlice = avcCDataSlice;
              bufferSlice.props = propsCache;
              bufferSlice.props.isBitstreamHeader = true;
            }
          }
        }

      } else { // handle any other NALU type

        if (ENABLE_PACKAGE_OTHER_NALUS_TO_ACCESS_UNITS) {

          // add AU-delim unit on created AUs
          // TODO: make optional
          /*
          const auDelimiterNalu = makeNALUFromH264RbspData(
            BufferSlice.fromTypedArray(new Uint8Array([7 << 5])), NALU.AU_DELIM, 3)
          */

          if (propsCache.isKeyframe && this._seiCache) { // prepend IDR with SEI
            bufferSlice = makeAccessUnitFromNALUs([this._seiCache, bufferSlice]);
            this._seiCache = null;
          } else {
            bufferSlice = makeAccessUnitFromNALUs([bufferSlice]);
          }

          bufferSlice.props = propsCache;

        }
      }

    } else {
      throw new Error('Expected raw NALU tagged payload');
    }

    if (!bufferSlice) {
      log('packet/slice dropped:', p.toString())
      return;
    }

    if (p.defaultPayloadInfo) {
      if (p.defaultPayloadInfo.isBitstreamHeader) {
        log('packet has bitstream header flag');

        let avcC: AvcC;
        try {
          avcC = <AvcC> AvcC.parse(bufferSlice.getUint8Array());
          log('created MP4 AvcC atom:', avcC);
        } catch(err) {
          warn('failed to parse data expected to be AvcC atom:', bufferSlice)
          throw err;
        }

      } else if (p.defaultPayloadInfo.isKeyframe) {

        log('created IDR AU');
        DEBUG_H264 && debugAccessUnit(bufferSlice, true);

      } else {

        log('created non-IDR AU')
        DEBUG_H264 && debugAccessUnit(bufferSlice, true);

      }
    } else {
      warn('no default payload info, dropping packet');
      return;
    }

    if (bufferSlice) {
      // replace the data
      p.data[0] = bufferSlice;

      // just pass on the packet as is to only output
      this.out[0].transfer(
        p
      );
    }
  }

}
