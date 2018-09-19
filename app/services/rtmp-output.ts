import { OutputService } from './outputs';
import { ProviderService } from './providers';
import { EncoderService } from './encoders';
import { StatefulService, mutation } from './stateful-service';
import { Inject } from 'util/injector';
import PouchDB from 'pouchdb';
import { DBQueueManager } from 'services/common-config';
import { remote } from 'electron';
import { ServiceFactory } from 'services/obs-api';
import { Subject } from 'rxjs/Subject';
import { DefaultManager } from 'services/sources/properties-managers/default-manager';
import path from 'path';

export enum EProviderMode {
  Common,
  Custom
}

export enum EEncoderMode {
  Simple,
  Advanced
}

export enum EAudioEncoders {
  FFMpeg = 'ffmpeg_aac',
  MediaFoundation = 'mf_aac',
  LibFDK = 'libfdk_aac',
  CoreAudio = 'CoreAudio_aac'
}

const docId = 'rtmp-output-settings';
const rtmpOutputId = 'output_rtmp_output';
const rtmpCommonProviderId = 'provider_rtmp_common';
const rtmpCustomProviderId = 'provider_rtmp_custom';
const rtmpVideoEncoderId = 'provider_rtmp_custom';
const rtmpH264EncoderId = 'encoder_rtmp_h264_video';

declare type ExistingDatabaseDocument = PouchDB.Core.ExistingDocument<
  RtmpOutputContent
>;

interface RtmpOutputContent {
  rtmpEncoderMode: EEncoderMode;
  rtmpProviderMode: EProviderMode;
  rtmpAudioBitrate: number;
}

interface RtmpOutputServiceState extends RtmpOutputContent {
  rtmpCurrentAudioEncoderId: string;
}

export class RtmpOutputService extends StatefulService<RtmpOutputServiceState> {
  outputIdChange = new Subject<void>();

  streamPropertyManager: DefaultManager = null;
  outputPropertyManager: DefaultManager = null;

  private initialized = false;
  private db = new DBQueueManager<RtmpOutputContent>(
    path.join(remote.app.getPath('userData'), 'RtmpOutputService')
  );

  static initialState: RtmpOutputServiceState = {
    rtmpEncoderMode: EEncoderMode.Simple,
    rtmpProviderMode: EProviderMode.Common,
    rtmpAudioBitrate: 128,
    rtmpCurrentAudioEncoderId: ''
  };

  @Inject() outputService: OutputService;
  @Inject() providerService: ProviderService;
  @Inject() encoderService: EncoderService;

  @mutation()
  UPDATE_PROVIDER_MODE(mode: EProviderMode) {
    this.state.rtmpProviderMode = mode;
  }

  @mutation()
  UPDATE_AUDIO_BITRATE(bitrate: number) {
    this.state.rtmpAudioBitrate = bitrate;
  }

  @mutation()
  UPDATE_CURRENT_AUDIO_ENCODER(uniqueId: string) {
    this.state.rtmpCurrentAudioEncoderId = uniqueId;
  }

  @mutation()
  UPDATE_ENCODER_MODE(encoderMode: EEncoderMode) {
    this.state.rtmpEncoderMode = encoderMode;
  }

  private createConfig(): void {
    this.outputService.addOutput('rtmp_output', 'output_rtmp_output');
    this.outputService.addOutput('ftl_output', 'output_ftl_output');
    this.providerService.addProvider('rtmp_common', 'provider_rtmp_common');
    this.providerService.addProvider('rtmp_custom', 'provider_rtmp_custom');
    this.encoderService.addVideoEncoder('obs_x264', 'encoder_rtmp_video_encoder');

    this.db.addQueue(docId);
    this.queueChange();
  }

  private syncConfig(
    response: PouchDB.Core.AllDocsResponse<RtmpOutputContent>
  ): void {
    for (let i = 0; i < response.total_rows; ++i) {
      const result = response.rows[i].doc;

      if (result._id !== docId) {
        console.warn('Unknown document found in rtmp output database!');
        continue;
      }

      this.UPDATE_PROVIDER_MODE(result.rtmpProviderMode);
      this.UPDATE_AUDIO_BITRATE(result.rtmpAudioBitrate);

      this.initialized = true;
    }

    if (!this.initialized) {
      this.createConfig();
      this.initialized = true;
    }
  }

  async initialize() {
    if (this.initialized) return;
    await this.outputService.initialize();
    await this.db.initialize(response => this.syncConfig(response));
  }

  private queueChange() {
    const change = {
      rtmpEncoderMode: this.state.rtmpEncoderMode,
      rtmpProviderMode: this.state.rtmpProviderMode,
      rtmpAudioBitrate: this.state.rtmpAudioBitrate
    };

    this.db.queueChange(docId, change);
  }
  
  start() {
    /* A muse in this scenario is being used to create an output
     * inspired by the settings of the muse but we still need to
     * add our own settings, etc. We do this so we can buffer 
     * changes to the object while they're active. Output isn't 
     * quite similar since we actually use the original as the 
     * in order to keep state associated with output. WEIRD I
     * know but since we're so married to the OBS way, we can't
     * seem to get a better design.*/
    const videoEncoderMuse = this.encoderService.state[rtmpVideoEncoderId];
    const commonProviderMuse = this.providerService.state[rtmpCommonProviderId];
    const customProviderMuse = this.providerService.state[rtmpCustomProviderId];

    const output = this.outputService.state[rtmpOutputId];
    const supportedAudioCodecs = output.supportedAudioCodecs;

    if (output.isActive) return false;

    const bitrate = this.state.rtmpAudioBitrate;

    /* We setup an audio encoder on the fly based on
     * on the encoder bitrate provided. */
    const encoderId = EncoderService.getUniqueId();

    if (output.supportedAudioCodecs.includes('aac')) {
      const encoderType = this.encoderService.getBestAACEncoderForBitrate(
        bitrate
      );

      this.encoderService.addAudioEncoder(encoderType, encoderId, false, 0, {
        bitrate
      });

      this.outputService.setOutputAudioEncoder(
        rtmpOutputId,
        encoderId,
        0
      );
    } else if (output.supportedAudioCodecs.includes('opus')) {
      this.encoderService.addAudioEncoder('ffmpeg_opus', encoderId, false, 0, {
        bitrate
      });

      this.outputService.setOutputAudioEncoder(
        rtmpOutputId,
        encoderId,
        0
      );
    } else {
      console.warn(
        `Supported audio codec (${supportedAudioCodecs.join()})
        not found for output with type ${output.type}`
      );
    }

    this.UPDATE_CURRENT_AUDIO_ENCODER(encoderId);

    return this.outputService.startOutput(rtmpOutputId);
  }

  stop() {
    this.outputService.stopOutput(rtmpOutputId);

    /* Remove the audio encoder and reset */
    this.outputService.setOutputAudioEncoder(rtmpOutputId, null, 0);
    this.encoderService.removeAudioEncoder(
      this.state.rtmpCurrentAudioEncoderId
    );

    this.UPDATE_CURRENT_AUDIO_ENCODER('');
  }

  getVideoEncoderId(): string {
    return this.outputService.getVideoEncoder(rtmpOutputId);
  }

  getProviderId(): string {
    return this.outputService.getOutputProvider(rtmpOutputId);
  }

  getCurrentMode(): EEncoderMode {
    return this.state.rtmpEncoderMode;
  }

  setEncoderMode(mode: EEncoderMode) {
    this.UPDATE_ENCODER_MODE(mode);
    this.queueChange();
  }

  setVideoEncoderType(mode: EEncoderMode, type: string) {
    this.encoderService.removeVideoEncoder(rtmpVideoEncoderId);
    this.encoderService.addVideoEncoder(type, rtmpVideoEncoderId);

    this.queueChange();
  }

  setProviderMode(mode: EProviderMode) {
    this.UPDATE_PROVIDER_MODE(mode);
    this.queueChange();
  }

  private changeOutput(outputType: string) {
    this.outputService.removeOutput(rtmpOutputId);
    this.outputService.addOutput(outputType, rtmpOutputId);

    this.queueChange();
    this.outputIdChange.next();
  }

  setVideoBitrate(bitrate: number) {
    const settings = { bitrate };

    this.encoderService.updateSettings(rtmpH264EncoderId, settings);
  }

  setAudioBitrate(bitrate: number) {
    this.UPDATE_AUDIO_BITRATE(bitrate);
  }

  subscribeOutputChange(cb: () => void) {
    this.outputIdChange.subscribe(cb);
  }
}
