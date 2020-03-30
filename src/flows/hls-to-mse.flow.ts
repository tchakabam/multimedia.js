
import { MP4DemuxProcessor } from '../processors/mp4-demux.processor';
import { MPEGTSDemuxProcessor } from '../processors/mpeg-ts-demux.processor';
import { MP4MuxProcessor, MP4MuxProcessorOptions } from '../processors/mp4-mux-mozilla.processor';
import { H264ParseProcessor } from '../processors/h264-parse.processor';

import { MediaSourceInputSocket } from '../io-sockets/mse-input.socket';
import { HlsOutputSocket } from '../io-sockets/hls/hls-output-socket';

import { newProcessorWorkerShell, unsafeCastProcessorType } from '../core/processor-factory';
import { ProcessorEvent, ProcessorEventData } from '../core/processor';
import { Flow, FlowConfigFlag } from '../core/flow';
import { PayloadCodec } from '../core/payload-description';
import { OutputSocket, SocketEvent } from '../core/socket';

import { getLogger, LoggerLevel } from '../logger';

import { VoidCallback } from '../common-types';

const { log } = getLogger('HlsToMediaSourceFlow', LoggerLevel.ON, true);

const ENABLE_AUDIO = false
const ENABLE_VIDEO = true

const USE_TS_DEMUX = true;
export class HlsToMediaSourceFlow extends Flow {

  private _hlsOutSocket: HlsOutputSocket;
  private _mseInSocket: MediaSourceInputSocket;

  private _haveVideo = false;
  private _haveAudio = false;
  private _mediaSource: MediaSource;

  constructor (private _m3u8Url: string, private _videoEl: HTMLMediaElement) {
    super(
      FlowConfigFlag.NONE | FlowConfigFlag.WITH_DOWNLOAD_SOCKET,
      (prevState, newState) => {
        log('previous state:', prevState, 'new state:', newState);
      },
      (reason) => {
        log('state change aborted. reason:', reason);
      },
      { el: null, mimeType: 'video/mp4', filenameTemplateBase: 'dump-${new Date().toJSON()}.mp4' }
    );
  }

  protected onWaitingToFlowing_ (done: VoidCallback) {
    this._hlsOutSocket.load(this._m3u8Url);
    this._hlsOutSocket.whenReady().then(() => {
      this._mediaSource.duration = 60;
      this._hlsOutSocket.seek(0, 10);
    });
    done();
  }

  protected onVoidToWaiting_ (done: VoidCallback) {

    const mediaSource = this._mediaSource = new MediaSource();
    this._videoEl.src = URL.createObjectURL(mediaSource);

    const inSocket = this._mseInSocket = new MediaSourceInputSocket(mediaSource, 'video/mp4');

    const mp4DemuxProc = newProcessorWorkerShell(MP4DemuxProcessor);
    const tsDemuxProc = newProcessorWorkerShell(MPEGTSDemuxProcessor);
    const h264ParseProc = newProcessorWorkerShell(H264ParseProcessor);
    const mp4MuxOptions: Partial<MP4MuxProcessorOptions> = {
      fragmentedMode: true
    }
    const mp4MuxProc = newProcessorWorkerShell(unsafeCastProcessorType(MP4MuxProcessor), [mp4MuxOptions]);

    const outSocket = this._hlsOutSocket = new HlsOutputSocket();

    const onDemuxOutputCreated = (data: ProcessorEventData) => {
      const demuxOutputSocket = <OutputSocket> data.socket;

      log('demuxer output created');

      let mp4MuxerInputSocket;

      const payloadDescriptor = demuxOutputSocket.payload();

      if (data.processor === mp4DemuxProc) {

        demuxOutputSocket.connect(h264ParseProc.in[0]);

        mp4MuxerInputSocket = mp4MuxProc.createInput();
        h264ParseProc.out[0].connect(mp4MuxerInputSocket);

      } else if (data.processor === tsDemuxProc) {

        if (!this._haveVideo &&
            PayloadCodec.isAvc(payloadDescriptor.codec)) {

          log('got video payload');

          this._haveVideo = true;

          demuxOutputSocket.connect(h264ParseProc.in[0]);

          mp4MuxerInputSocket = mp4MuxProc.createInput();
          h264ParseProc.out[0].connect(mp4MuxerInputSocket);

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

    if (USE_TS_DEMUX) { // FIXME use mime-type of response
      outSocket.connect(tsDemuxProc.in[0]);
    } else { // FIXME use mime-type of response
      outSocket.connect(mp4DemuxProc.in[0]);
    }

    mp4MuxProc.out[0].connect(inSocket);
    //this.connectWithAllExternalSockets(mp4MuxProc.out[0]);

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
