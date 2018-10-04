import { Processor } from "../core/processor";
import { InputSocket, SocketDescriptor, SocketType } from "../core/socket";
import { Packet, PacketSymbol } from "../core/packet";

import {Fmp4Remuxer, Fmp4RemuxerEvent, Fmp4RemuxerConfig,
  Fmp4RemuxerAudioTrack,
  Fmp4RemuxerVideoTrack,
  Fmp4RemuxerId3Track,
  Fmp4RemuxerTextTrack
} from './hlsjs-fmp4-mux/mp4-remuxer';

import { BufferSlice } from "../core/buffer";
import { getLogger } from "../logger";

const {log} = getLogger('MP4MuxHlsjsProcessor');

const config: Fmp4RemuxerConfig = {
  maxBufferHole: 1.5,
  maxAudioFramesDrift: 2,
  stretchShortVideoTrack: false
}

export class MP4MuxHlsjsProcessor extends Processor {
  private fmp4Remux: Fmp4Remuxer = new Fmp4Remuxer(
    this._onFmp4Event.bind(this),
    config,
    {}
  );

  private videoTrack: Fmp4RemuxerVideoTrack = {
    duration: 10,
    samples: [],
    inputTimeScale: 90000,
    timescale: 90000,
    sps: null,
    pps: null,
    codec: null,
    width: 0,
    height: 0,
    dropped: 0,
    len: 0,
    nbNalu: 0,
    sequenceNumber: 1,
    type: 'video',
    pixelRatio: [1, 1],
    id: 1
  };

  private videoTrackPacketIndexCnt: number = 0;

  private audioTrack: Fmp4RemuxerAudioTrack = {
    codec: null,
    timescale: 12800,
    samples: [],
    config: {},
    samplerate: 44100,
    isAAC: true,
    channelCount: 2,
    inputTimeScale: 1,
    len: 0,
    nbNalu: 0,
    sequenceNumber: 0,
    manifestCodec: null
  }

  constructor() {
    super();
    this.createOutput();
  }

  templateSocketDescriptor(st: SocketType): SocketDescriptor {
    return new SocketDescriptor()
  }

  protected processTransfer_(inS: InputSocket, p: Packet) {

    p.forEachBufferSlice((bufferSlice: BufferSlice) => {

      //console.log(p.timestamp)

      if (bufferSlice.props.isBitstreamHeader) {
        if (bufferSlice.props.tags.has('sps')) {
          this.videoTrack.sps = bufferSlice.getUint8Array();
        } else if (bufferSlice.props.tags.has('pps')) {
          this.videoTrack.pps = bufferSlice.getUint8Array();
        }

        this.videoTrack.width = bufferSlice.props.details.width;
        this.videoTrack.height = bufferSlice.props.details.height;
        this.videoTrack.codec = bufferSlice.props.codec;

        return;
      }

      this.videoTrack.samples.push({
        pts: p.getPresentationTime(),
        dts: p.timestamp,
        length: 1,
        id: this.videoTrackPacketIndexCnt,
        units: [{data: bufferSlice.getUint8Array()}],
        key: bufferSlice.props.isKeyframe
      })

      this.videoTrackPacketIndexCnt++
    });

    return true;
  }

  /**
   * @override
   * @param symbol
   */
  protected handleSymbolicPacket_(symbol: PacketSymbol): boolean {

    if (symbol === PacketSymbol.FLUSH) {
      this.flush();
    }

    return false;
    //return super.handleSymbolicPacket_(symbol);
  }

  private _onFmp4Event(event: Fmp4RemuxerEvent, data: any) {
    log('fmp4remux event >', event, data);

    switch(event) {
    case 'init-pts-found':
      break;
    case 'frag-parsing-init-segment':{
      const {tracks: {video: {initSegment}}} = data;
      console.log(initSegment)
      this.out[0].transfer(Packet.fromSlice(BufferSlice.fromTypedArray(initSegment)))
      break;
      }
    case 'frag-parsing-data': {
      const {data1, data2} = data;
      //this.out[0].transfer(Packet.fromSlice(BufferSlice.fromTypedArray(data1)))
      //this.out[0].transfer(Packet.fromSlice(BufferSlice.fromTypedArray(data2)))
      break;
      }
    }
  }

  public flush() {
    if (this.videoTrackPacketIndexCnt === 0) {
      return;
    }
    log('flushing at packet:', this.videoTrackPacketIndexCnt);
    this.fmp4Remux.remux(this.audioTrack, this.videoTrack, null, null, 0, true, true);
  }
}
