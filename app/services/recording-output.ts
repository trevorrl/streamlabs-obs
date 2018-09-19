import { OutputService } from './outputs';
import { ProviderService } from './providers';
import { EncoderService } from './encoders';
import { StatefulService, mutation } from './stateful-service';
import { EProviderMode, EEncoderMode, RtmpOutputService } from './rtmp-output';
import { Inject } from 'util/injector';
import PouchDB from 'pouchdb';
import { DBQueueManager } from 'services/common-config';
import { remote } from 'electron';
import path from 'path';
import { OutputFactory, VideoEncoderFactory } from 'services/obs-api';
import { Subject } from 'rxjs/Subject';

const app = remote.app;
const docId = 'rec-output-settings';

export const enum ERecordingQuality {
  Stream,
  High,
  Ultra,
  Lossless
}

/* We don't use string enumerations
 * here since we will need to support
 * encoders with the same typename. */
const recordingEncoderMap = [
  'obs_x264',
  'ffmpeg_nvenc',
  'amd_amf_h264',
  'obs_qsv11'
];

export const enum ERecordingEncoders {
  X264,
  NVENC,
  AMF,
  QSV11
}

interface IOutputTrack {
  name: string /* Not used right now */;
  bitrate: number;
}

interface RecOutputContent {
  recOutputId: string;
  recDirectory: string;
  recFormat: string;
  recTrackBitmask: number;
  recTrackEncoders: IOutputTrack[];
  recQuality: ERecordingQuality;
  recEncoderType: ERecordingEncoders;
}

interface RecOutputServiceState extends RecOutputContent {
  /* Track encoders are created on the fly when we're about to start */
  recTrackEncoderIds: string[];
}

type ExistingDatabaseDocument = PouchDB.Core.ExistingDocument<
  RecOutputServiceState
>;

export class RecOutputService extends StatefulService<RecOutputServiceState> {
  outputIdChange = new Subject<void>();

  private initialized = false;
  private db = new DBQueueManager<RecOutputContent>(
    path.join(remote.app.getPath('userData'), 'RecOutputService')
  );

  static initialState: RecOutputServiceState = {
    recOutputId: '',
    recDirectory: '',
    recFormat: 'flv',
    recTrackEncoders: [
      { name: 'Track 1', bitrate: 128 },
      { name: 'Track 2', bitrate: 128 },
      { name: 'Track 3', bitrate: 128 },
      { name: 'Track 4', bitrate: 128 },
      { name: 'Track 5', bitrate: 128 },
      { name: 'Track 6', bitrate: 128 }
    ],
    recTrackBitmask: 1 << 0,
    recTrackEncoderIds: ['', '', '', '', '', ''],
    recQuality: ERecordingQuality.Stream,
    recEncoderType: ERecordingEncoders.X264
  };

  @Inject() outputService: OutputService;
  @Inject() providerService: ProviderService;
  @Inject() encoderService: EncoderService;
  @Inject() rtmpOutputService: RtmpOutputService;

  @mutation()
  UPDATE_OUTPUT(uniqueId: string) {
    this.state.recOutputId = uniqueId;
  }

  @mutation()
  UPDATE_DIR(directory: string) {
    this.state.recDirectory = directory;
  }

  @mutation()
  UPDATE_FORMAT(format: string) {
    this.state.recFormat = format;
  }

  @mutation()
  UPDATE_TRACK_ID(uniqueId: string, idx: number) {
    this.state.recTrackEncoderIds[idx] = uniqueId;
  }

  @mutation()
  UPDATE_TRACK_BIT(bit: number, index: number) {
    this.state.recTrackBitmask &= ~(1 << index);
    this.state.recTrackBitmask |= bit << index;
  }

  @mutation()
  UPDATE_TRACK_BITMASK(mask: number) {
    this.state.recTrackBitmask = mask;
  }

  @mutation()
  UPDATE_TRACK_ENCODER_ID(uniqueId: string, idx: number) {
    this.state.recTrackEncoderIds[idx] = uniqueId;
  }

  @mutation()
  UPDATE_TRACK_ENCODER(info: IOutputTrack, idx: number) {
    this.state.recTrackEncoders[idx] = info;
  }

  @mutation()
  UPDATE_AUDIO_BITRATE(bitrate: number, idx: number) {
    this.state.recTrackEncoders[idx].bitrate = bitrate;
  }

  @mutation()
  UPDATE_QUALITY(quality: ERecordingQuality) {
    this.state.recQuality = quality;
  }

  @mutation()
  UPDATE_VIDEO_ENCODER_TYPE(type: ERecordingEncoders) {
    this.state.recEncoderType = type;
  }

  private createConfig(): void {
    const outputId = OutputService.getUniqueId();
    this.outputService.addOutput('ffmpeg_muxer', outputId);

    const videoEncoderId = EncoderService.getUniqueId();
    this.encoderService.addVideoEncoder('obs_x264', videoEncoderId);

    const advVideoEncoderId = EncoderService.getUniqueId();
    this.encoderService.addVideoEncoder('obs_x264', advVideoEncoderId);

    this.outputService.setOutputVideoEncoder(outputId, videoEncoderId);

    this.UPDATE_OUTPUT(outputId);
    this.UPDATE_DIR(app.getPath('videos'));

    this.db.addQueue(docId);
    this.queueChange();
  }

  private syncConfig(response: PouchDB.Core.AllDocsResponse<RecOutputContent>) {
    for (let i = 0; i < response.total_rows; ++i) {
      const result = response.rows[i].doc;

      if (result._id !== docId) {
        console.warn('Unknown document found in recording output database!');
        continue;
      }

      this.UPDATE_OUTPUT(result.recOutputId);
      this.UPDATE_DIR(result.recDirectory);
      this.UPDATE_FORMAT(result.recFormat);
      this.UPDATE_TRACK_BITMASK(result.recTrackBitmask);
      this.UPDATE_QUALITY(result.recQuality);

      for (let i = 0; i < 6; ++i) {
        this.UPDATE_TRACK_ENCODER(result.recTrackEncoders[i], i);
      }

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
      recOutputId: this.state.recOutputId,
      recDirectory: this.state.recDirectory,
      recFormat: this.state.recFormat,
      recTrackBitmask: this.state.recTrackBitmask,
      recTrackEncoders: this.state.recTrackEncoders,
      recQuality: this.state.recQuality,
      recEncoderType: this.state.recEncoderType
    };

    this.db.queueChange(docId, change);
  }

  private generateFilename(): string {
    const now = new Date();
    return (
      `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_` +
      `${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}-${now.getMilliseconds()}`
    );
  }

  /* CRF setting will be applied on start
    * as we still need to know what quality
    * we want and we can't get that until
    * we actually want to start */
  private getRecordingPresetSettings() {
    const crf = this.state.recQuality === ERecordingQuality.Ultra ? 16 : 23;

    switch (this.state.recEncoderType) {
      case ERecordingEncoders.X264:
        return {
          use_bufsize: true,
          rate_control: 'CRF',
          profile: 'high',
          preset: 'veryfast',
          crf
        };
      case ERecordingEncoders.NVENC:
        return {
          rate_control: 'CQP',
          profile: 'high',
          preset: 'hq',
          cqp: crf
        };
      case ERecordingEncoders.AMF:
        return {
          Usage: 0,
          Profile: 100, // High
          RateControlMethod: 0,
          'QP.IFrame': crf,
          'QP.PFrame': crf,
          'QP.BFrame': crf,
          VBVBuffer: 1,
          'VBVBuffer.Size': 100000
        };
      case ERecordingEncoders.QSV11:
        return {
          rate_control: 'CQP',
          qpi: crf,
          qpp: crf,
          qpb: crf
        };
    }

    return {};
  }

  private updateOutput(uniqueId: string) {
    this.UPDATE_OUTPUT(uniqueId);
    this.outputIdChange.next();
  }

  get isActive() {
    return this.outputService.state[this.state.recOutputId].isActive;
  }

  /* Just checks to make sure we're not using the 
   * streaming encoder and that we're not lossless */
  get hasOwnVideoEncoder() {
    return (
      this.state.recQuality !== ERecordingQuality.Stream &&
      this.state.recQuality !== ERecordingQuality.Lossless
    );
  }

  start() {
    if (this.isActive) return false;

    for (let i = 0; i < 6; ++i) {
      if (!(this.state.recTrackBitmask & (1 << i))) continue;

      const bitrate = this.state.recTrackEncoders[i].bitrate;
      const encoderId = EncoderService.getUniqueId();

      const encoderType = this.encoderService.getBestAACEncoderForBitrate(
        bitrate
      );

      this.encoderService.addAudioEncoder(encoderType, encoderId, false, i, {
        bitrate
      });

      this.UPDATE_TRACK_ENCODER_ID(encoderId, i);

      this.outputService.setOutputAudioEncoder(
        this.state.recOutputId,
        encoderId,
        i
      );
    }

    /* Right before we start, update the path with a valid filename */
    const path = `${this.state.recDirectory}\\${this.generateFilename()}.${
      this.state.recFormat
    }`;

    const pathSettings =
      this.outputService.state[this.state.recOutputId].type === 'ffmpeg_output'
        ? { url: path }
        : { path };

    this.outputService.updateSettings(this.state.recOutputId, pathSettings);

    if (this.hasOwnVideoEncoder) {
      const encoderId = this.outputService.getVideoEncoder(
        this.state.recOutputId
      );
      const settings = this.getRecordingPresetSettings();

      this.encoderService.updateSettingsDirect(encoderId, settings);
    }

    this.outputService.startOutput(this.state.recOutputId);
  }

  stop() {
    this.outputService.stopOutput(this.state.recOutputId);

    for (let i = 0; i < 6; ++i) {
      if (!(this.state.recTrackBitmask & (1 << i))) continue;

      const uniqueId = this.state.recTrackEncoderIds[i];
      this.encoderService.removeAudioEncoder(uniqueId);
      this.UPDATE_TRACK_ENCODER_ID('', i);
    }
  }

  getAudioEncoderId(track: number): string {
    return this.outputService.getAudioEncoder(this.state.recOutputId, track);
  }

  getVideoEncoderId(): string {
    return this.outputService.getVideoEncoder(this.state.recOutputId);
  }

  getProviderId(): string {
    return this.outputService.getOutputProvider(this.state.recOutputId);
  }

  getOutputId() {
    return this.state.recOutputId;
  }

  getFileDirectory() {
    /* We know this setting exists since we create the output with a default */
    return this.state.recDirectory;
  }

  setFileDirectory(directory: string) {
    if (this.isActive) return;
    this.UPDATE_DIR(directory);
    this.queueChange();
  }

  recordingFormats: string[] = ['flv', 'mp4', 'mov', 'mkv', 'ts', 'm3u8'];

  getRecordingFormat(): string {
    return this.state.recFormat;
  }

  setRecordingFormat(format: string) {
    console.log(format);
    this.UPDATE_FORMAT(format);
    this.queueChange();
  }

  setTrack(enabled: boolean, index: number) {
    if (this.isActive) return;
    const bit = enabled ? 1 : 0;
    this.UPDATE_TRACK_BIT(bit, index);
    this.queueChange();
  }

  setAudioBitrate(bitrate: number, index: number) {
    this.UPDATE_AUDIO_BITRATE(bitrate, index);
    this.queueChange();
  }

  getRecordingEncoderTypes() {
    const recTypes = [];
    const types = VideoEncoderFactory.types();

    for (let i = 0; i < types.length; ++i) {
      switch (types[i]) {
        case 'obs_x264':
          recTypes.push(ERecordingEncoders.X264);
          break;
        case 'amd_amf_h264':
          recTypes.push(ERecordingEncoders.AMF);
          break;
        case 'ffmpeg_nvenc':
          recTypes.push(ERecordingEncoders.NVENC);
          break;
        case 'obs_qsv11':
          recTypes.push(ERecordingEncoders.QSV11);
          break;
      }
    }

    return recTypes;
  }

  setEncoderType(type: ERecordingEncoders) {
    if (this.isActive) return;
    if (type === this.state.recEncoderType) return;

    if (this.state.recQuality === ERecordingQuality.Stream) {
      console.warn('Attempt to switch encoder when using streaming encoder!');
      return;
    }

    if (this.state.recQuality === ERecordingQuality.Lossless) {
      console.warn('Attempt to switch encoder when using lossless output!');
      return;
    }

    const oldEncoder = this.outputService.getVideoEncoder(
      this.state.recOutputId
    );

    const uniqueId = EncoderService.getUniqueId();

    this.encoderService.addVideoEncoder(
      recordingEncoderMap[this.state.recEncoderType],
      uniqueId,
      true,
      {}
    );

    this.encoderService.removeVideoEncoder(oldEncoder);
    this.outputService.setOutputVideoEncoder(this.state.recOutputId, uniqueId);

    this.UPDATE_VIDEO_ENCODER_TYPE(type);
    this.queueChange();
  }

  private removeVideoEncoder() {
    if (this.hasOwnVideoEncoder) {
      const oldEncoder = this.outputService.getVideoEncoder(
        this.state.recOutputId
      );

      this.encoderService.removeVideoEncoder(oldEncoder);
    }
  }

  setQuality(quality: ERecordingQuality) {
    if (this.isActive) return;
    if (quality === this.state.recQuality) return;

    if (this.hasOwnVideoEncoder) {
      const oldEncoderId = this.outputService.getVideoEncoder(
        this.state.recOutputId
      );

      if (!oldEncoderId) {
        console.warn('Failed to fetch encoder ID!');
      } else if (this.state.recQuality !== ERecordingQuality.Stream) {
        this.encoderService.removeVideoEncoder(oldEncoderId);
      }
    }

    this.outputService.removeOutput(this.state.recOutputId);
    const newOutputId = OutputService.getUniqueId();

    switch (quality) {
      case ERecordingQuality.Ultra:
      case ERecordingQuality.High:
        this.outputService.addOutput('ffmpeg_muxer', newOutputId);

        /* The difference between *MEGAULTRA* and high 
         * quality is CRF value only. In other words
         * we use the same encoder with different
         * settings. */
        const type = recordingEncoderMap[this.state.recEncoderType];

        const encoderId = EncoderService.getUniqueId();
        this.encoderService.addVideoEncoder(type, encoderId);

        this.outputService.setOutputVideoEncoder(newOutputId, encoderId);

        break;

      case ERecordingQuality.Stream:
        this.outputService.addOutput('ffmpeg_muxer', newOutputId);
        this.outputService.setOutputVideoEncoder(
          newOutputId,
          this.rtmpOutputService.state.rtmpVideoEncoderId
        );

        break;
      case ERecordingQuality.Lossless:
        /* The lossless setting is actually
         * an entirely different output with
         * very specific settings. Here we use
         * the ffmpeg_output similar to Qt OBS. */
        const settings = {
          format_name: 'avi',
          video_encoder: 'utvideo',
          audio_encoder: 'pcm_s16le'
        };

        this.outputService.addOutput(
          'ffmpeg_output',
          newOutputId,
          true,
          settings
        );

        break;
    }

    this.updateOutput(newOutputId);
    this.UPDATE_QUALITY(quality);
    this.queueChange();
  }

  subscribeOutputChange(cb: () => void) {
    this.outputIdChange.subscribe(cb);
  }
}
