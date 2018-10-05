import { XhrSocket } from "../io-sockets/xhr.socket";
import { MP4DemuxProcessor } from "../processors/mp4-demux.processor";
import { MPEGTSDemuxProcessor } from "../processors/mpeg-ts-demux.processor";
import { MP4MuxProcessor, MP4MuxProcessorSupportedCodecs } from "../processors/mp4-mux-mozilla.processor";
import { Flow, FlowState, FlowStateChangeCallback } from "../core/flow";
import { Socket, OutputSocket } from '../core/socket';
import { H264ParseProcessor } from "../processors/h264-parse.processor";
import { HTML5MediaSourceBufferSocket } from "../io-sockets/html5-media-source-buffer.socket";
import { ProcessorEvent, ProcessorEventData } from "../core/processor";
import { MP4MuxHlsjsProcessor } from "../processors/mp4-mux-hlsjs.processor";

export class HttpToMediaSourceFlow extends Flow {

  private _xhrSocket: XhrSocket;

  constructor(url: string, mediaSource: MediaSource) {

    super(
      (prevState, newState) => {
        console.log('previous state:', prevState, 'new state:', newState)
      },
      (reason) => {
        console.log('state change aborted. reason:', reason);
      }
    );

    const mp4DemuxProc = new MP4DemuxProcessor();
    const tsDemuxProc = new MPEGTSDemuxProcessor();
    const h264ParseProc = new H264ParseProcessor();
    const mp4MuxProc = new MP4MuxProcessor();
    const mp4MuxHlsjsProc = new MP4MuxHlsjsProcessor();

    const xhrSocket = this._xhrSocket = new XhrSocket(url);

    const mediaSourceSocket: HTML5MediaSourceBufferSocket
      = new HTML5MediaSourceBufferSocket(mediaSource, 'video/mp4; codecs=avc1.64001f'); // avc1.4d401f

    tsDemuxProc.on(ProcessorEvent.OUTPUT_SOCKET_CREATED, onDemuxOutputCreated);
    mp4DemuxProc.on(ProcessorEvent.OUTPUT_SOCKET_CREATED, onDemuxOutputCreated);

    mp4MuxProc.out[0].connect(mediaSourceSocket);
    mp4MuxHlsjsProc.out[0].connect(mediaSourceSocket);

    if (url.endsWith('.ts')) { // FIXME use mime-type of response
      xhrSocket.connect(tsDemuxProc.in[0]);
    } else { // FIXME use mime-type of response
      xhrSocket.connect(mp4DemuxProc.in[0]);
    }

    this.add(mp4DemuxProc, mp4MuxHlsjsProc, tsDemuxProc, mp4MuxProc);

    function onDemuxOutputCreated(data: ProcessorEventData) {
      const demuxOutputSocket = <OutputSocket> data.socket;

      console.log('demuxer output created');

      let muxerInputSocket;

      if (data.processor === mp4DemuxProc) {

        muxerInputSocket = mp4MuxProc.addVideoTrack(
          MP4MuxProcessorSupportedCodecs.AVC,
          25, // fps
          768, 576, // resolution
          60 // duration
        );

      } else if (data.processor === tsDemuxProc) {

        muxerInputSocket = mp4MuxHlsjsProc.createInput();
      }

      demuxOutputSocket.connect(h264ParseProc.in[0]);
      h264ParseProc.out[0].connect(muxerInputSocket);
    }
  }

  /**
   * @override
   */
  getExternalSockets(): Set<Socket> {
    return new Set([this._xhrSocket]);
  }

  protected onVoidToWaiting_(cb: FlowStateChangeCallback) {}

  protected onWaitingToVoid_(cb: FlowStateChangeCallback) {}

  protected onWaitingToFlowing_(cb: FlowStateChangeCallback) {}

  protected onFlowingToWaiting_(cb: FlowStateChangeCallback) {}

  protected onStateChangeAborted_(reason: string) {}
}
