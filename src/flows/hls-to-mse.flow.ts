
import { MP4DemuxProcessor } from '../processors/mp4-demux.processor';
import { MPEGTSDemuxProcessor } from '../processors/mpeg-ts-demux.processor';
import { MP4MuxProcessor } from '../processors/mp4-mux-mozilla.processor';
import { H264ParseProcessor } from '../processors/h264-parse.processor';

import { HTML5MediaSourceBufferSocket } from '../io-sockets/html5-media-source-buffer.socket';
import { HlsOutputSocket } from '../io-sockets/hls/hls-output-socket';

import { newProcessorWorkerShell } from '../core/processor-factory';
import { ProcessorEvent, ProcessorEventData } from '../core/processor';
import { Flow, FlowConfigFlag } from '../core/flow';
import { PayloadCodec } from '../core/payload-description';
import { OutputSocket } from '../core/socket';

import { getLogger, LoggerLevel } from '../logger';

import { VoidCallback } from '../common-types';

const { log } = getLogger('HlsToMediaSourceFlow', LoggerLevel.ON, true);

const ENABLE_AUDIO = false
const ENABLE_VIDEO = true
export class HlsToMediaSourceFlow extends Flow {

  private _hlsOutSocket: HlsOutputSocket;
  private _mseInSocket: HTML5MediaSourceBufferSocket;

  private _haveVideo = false;
  private _haveAudio = false;

  constructor (private _m3u8Url: string) {
    super(
      FlowConfigFlag.NONE,
      (prevState, newState) => {
        log('previous state:', prevState, 'new state:', newState);
      },
      (reason) => {
        log('state change aborted. reason:', reason);
      }
    );
  }

  protected onWaitingToFlowing_ (done: VoidCallback) {

    this._hlsOutSocket.load(this._m3u8Url);

    done();
  }

  protected onVoidToWaiting_ (done: VoidCallback) {

    const mp4DemuxProc = newProcessorWorkerShell(MP4DemuxProcessor);
    const tsDemuxProc = newProcessorWorkerShell(MPEGTSDemuxProcessor);
    const h264ParseProc = newProcessorWorkerShell(H264ParseProcessor);
    const mp4MuxProc = newProcessorWorkerShell(MP4MuxProcessor);

    const outSocket = this._hlsOutSocket = new HlsOutputSocket();

    //const mediaSource = new MediaSource();
    //const inSocket = this._mseInSocket = new HTML5MediaSourceBufferSocket(mediaSource);

    const onDemuxOutputCreated = (data: ProcessorEventData) => {
      const demuxOutputSocket = <OutputSocket> data.socket;

      log('demuxer output created');

      let muxerInputSocket;

      const payloadDescriptor = demuxOutputSocket.payload();

      if (data.processor === mp4DemuxProc) {

        demuxOutputSocket.connect(h264ParseProc.in[0]);
        muxerInputSocket = mp4MuxProc.createInput();
        h264ParseProc.out[0].connect(muxerInputSocket);

      } else if (data.processor === tsDemuxProc) {

        if (!this._haveVideo &&
            PayloadCodec.isAvc(payloadDescriptor.codec)) {

          log('got video payload');

          this._haveVideo = true;

          demuxOutputSocket.connect(h264ParseProc.in[0]);
          muxerInputSocket = mp4MuxProc.createInput();
          h264ParseProc.out[0].connect(muxerInputSocket);

        } else if (!this._haveAudio &&
            PayloadCodec.isAac(payloadDescriptor.codec)) {

          log('got audio payload');

          /*
          this._haveAudio = true;
          muxerInputSocket = mp4MuxProc.createInput();
          demuxOutputSocket.connect(muxerInputSocket);
          */

        }
      }
    };

    this.addProc(mp4DemuxProc, mp4MuxProc, tsDemuxProc, mp4MuxProc);

    tsDemuxProc.on(ProcessorEvent.OUTPUT_SOCKET_CREATED, onDemuxOutputCreated);
    mp4DemuxProc.on(ProcessorEvent.OUTPUT_SOCKET_CREATED, onDemuxOutputCreated);

    if (this._m3u8Url.endsWith('.ts')) { // FIXME use mime-type of response
      outSocket.connect(tsDemuxProc.in[0]);
    } else { // FIXME use mime-type of response
      outSocket.connect(mp4DemuxProc.in[0]);
    }

    this.connectWithAllExternalSockets(mp4MuxProc.out[0])

    done();
  }

  protected onWaitingToVoid_ (done: VoidCallback) {
    done();
  }

  protected onFlowingToWaiting_ (done: VoidCallback) {
    done();
  }

  protected onCompleted_ (done: VoidCallback) {
    done();
  }

  protected onStateChangeAborted_ (reason: string) {}
}