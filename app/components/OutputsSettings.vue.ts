import Vue from 'vue';
import { Component } from 'vue-property-decorator';
import { Inject } from '../util/injector';
import SettingsBitMaskInput from './shared/forms/SettingsBitMaskInput.vue';
import SettingsIntInput from './shared/forms/SettingsIntInput.vue';
import SettingsPathInput from './shared/forms/SettingsPathInput.vue';
import SettingsListInput from './shared/forms/SettingsListInput.vue';
import GenericForm from './shared/forms/GenericForm.vue';
import IntInput from './shared/forms/IntInput.vue';
import ListInput from './shared/forms/ListInput.vue';
import PathInput from './shared/forms/PathInput.vue';

import {
  RtmpOutputService,
  EEncoderMode,
  EProviderMode
} from 'services/rtmp-output';

import {
  RecOutputService,
  ERecordingQuality,
  ERecordingEncoders
} from 'services/recording-output';
import { EncoderService } from 'services/encoders';
import {
  TFormData,
  INumberInputValue,
  IListInput,
  IListOption,
  IPathInputValue
} from './shared/forms/Input';

import {
  IConfigurable,
  VideoEncoderFactory,
  AudioEncoderFactory,
  INumberProperty,
  EPropertyType,
  EPathType
} from 'services/obs-api';
import { StreamingService } from 'services/streaming';

@Component({
  components: {
    SettingsBitMaskInput,
    SettingsIntInput,
    SettingsPathInput,
    SettingsListInput,
    GenericForm,
    IntInput,
    ListInput,
    PathInput
  }
})
export default class OutputsSettings extends Vue {
  @Inject() recOutputService: RecOutputService;
  @Inject() rtmpOutputService: RtmpOutputService;
  @Inject() encoderService: EncoderService;
  @Inject() streamingService: StreamingService;

  $refs: {
    simpleVideoBitrate: SettingsIntInput;
  };

  private getEncoderDescription(type: string): string {
    const names = {
      obs_x264: '(Software) x264',
      ffmpeg_nvenc: '(Hardware) NVENC via FFMpeg '
    };

    let description = names[type];

    if (!description) description = type;

    return description;
  }

  get isStreaming() {
    return this.streamingService.isStreaming;
  }

  get isRecording() {
    return this.streamingService.isRecording;
  }

  get isActive() {
    return this.streamingService.state.isActive;
  }

  get outputSettingsModeValue() {
    return this.rtmpOutputService.state.rtmpEncoderMode;
  }

  outputSettingsModeOptions: IListOption<number>[] = [
    { description: 'Simple', value: EEncoderMode.Simple },
    { description: 'Advanced', value: EEncoderMode.Advanced }
  ];

  get rtmpVideoEncoderTypeValue() {
    const encoderId = this.rtmpOutputService.state.rtmpVideoEncoderId;
    return this.encoderService.state[encoderId].type;
  }

  get recordingFolderPathValue() {
    return this.recOutputService.state.recDirectory;
  }

  get recordingFormatValue() {
    return this.recOutputService.state.recFormat;
  }

  get recordingTracksValue() {
    return this.recOutputService.state.recTrackBitmask;
  }

  get videoEncoderOptions() {
    const options: IListOption<string>[] = [];
    const types = this.encoderService.getAvailableVideoEncoders();

    for (let i = 0; i < types.length; ++i) {
      options.push({
        description: this.getEncoderDescription(types[i]),
        value: types[i]
      });
    }

    return options;
  }

  get recordingFormatOptions() {
    const formats = this.recOutputService.recordingFormats;
    let options: IListOption<string>[] = [];

    for (let i = 0; i < formats.length; ++i) {
      options.push({ value: formats[i], description: formats[i] });
    }

    return options;
  }

  get audioBitrateOptions() {
    let options: IListOption<number>[] = [];

    const bitrates = this.encoderService.getSupportedAudioBitrates();

    for (let i = 0; i < bitrates.length; ++i) {
      options.push({
        description: bitrates[i].toString(10),
        value: bitrates[i]
      });
    }

    return options;
  }

  get recordingTypeOptions() {
    const types = this.recOutputService.getRecordingEncoderTypes();
    let options: IListOption<ERecordingEncoders>[] = [];

    for (let i = 0; i < types.length; ++i) {
      switch (types[i]) {
        case ERecordingEncoders.X264:
          options.push({ description: 'Software (X264)', value: types[i] });
          break;
        case ERecordingEncoders.AMF:
          options.push({ description: 'Hardware (AMF)', value: types[i] });
          break;
        case ERecordingEncoders.NVENC:
          options.push({ description: 'Hardware (NVENC)', value: types[i] });
          break;
        case ERecordingEncoders.QSV11:
          options.push({ description: 'Hardware (QSV11)', value: types[i] });
          break;
      }
    }

    return options;
  }

  recordingQualityOptions: IListOption<number>[] = [
    { description: 'Same as stream', value: ERecordingQuality.Stream },
    { description: 'High Quality', value: ERecordingQuality.High },
    {
      description: 'Indistinguishable Quality',
      value: ERecordingQuality.Ultra
    },
    { description: 'Lossless Quality', value: ERecordingQuality.Lossless }
  ];

  rtmpVideoBitrateProps() {
    const uniqueId = this.rtmpOutputService.getVideoEncoderId();
    const configurable = VideoEncoderFactory.fromName(uniqueId);
    const settings = configurable.settings;
    const props = configurable.properties;
    const bitrateProp = props.get('bitrate') as INumberProperty;

    return {
      value: settings['bitrate'],
      min: bitrateProp.details.min,
      max: bitrateProp.details.max,
      step: bitrateProp.details.step,
      disabled: !bitrateProp.enabled
    };
  }

  get rtmpAudioBitrateValue() {
    return this.rtmpOutputService.state.rtmpAudioBitrate;
  }

  get trackAudioValue() {
    return this.recOutputService.state.recTrackEncoders;
  }

  get recordingTrackBitmask() {
    return this.recOutputService.state.recTrackBitmask;
  }

  get recordingQualityValue() {
    return this.recOutputService.state.recQuality;
  }

  get recordingTypeValue() {
    return this.recOutputService.state.recEncoderType;
  }

  simpleRtmpStreamCollapsed = false;
  advRtmpStreamCollapsed = false;
  recordingCollapsed = false;

  advRtmpVideoEncoderForm = this.encoderService.getPropertyFormData(
    this.rtmpOutputService.getVideoEncoderId()
  );

  inputOutputSettingsMode(option: IListOption<EEncoderMode>) {
    const videoEncoderId = this.rtmpOutputService.getVideoEncoderId();

    /* The data will be correct but our UI will still be stale from
     * the previous time we set the menu. We need to initialize it
     * with the correct data. */
    this.advRtmpVideoEncoderForm = this.encoderService.getPropertyFormData(
      videoEncoderId
    );

    this.rtmpOutputService.setEncoderMode(option.value);
  }

  inputAdvRtmpVideoEncoder(formData: INumberInputValue[]) {
    const videoEncoderId = this.rtmpOutputService.getVideoEncoderId();

    this.encoderService.setPropertyFormData(videoEncoderId, formData);
    this.advRtmpVideoEncoderForm = this.encoderService.getPropertyFormData(
      videoEncoderId
    );
  }

  inputSimpleRtmpVideoBitrate(value: number) {
    this.rtmpOutputService.setVideoBitrate(value);
  }

  inputSimpleRtmpAudioBitrate(option: IListOption<number>) {
    this.rtmpOutputService.setAudioBitrate(option.value);
  }

  inputSimpleRtmpVideoEncoderType(option: IListOption<string>) {
    this.rtmpOutputService.setVideoEncoderType(
      EEncoderMode.Simple,
      option.value
    );

    const videoEncoderId = this.rtmpOutputService.getVideoEncoderId();

    this.rtmpOutputService.setVideoBitrate(this.$refs.simpleVideoBitrate.value);
  }

  inputAdvRtmpVideoEncoderType(option: IListOption<string>) {
    /* Rebuild the entire properties menu 
     * since the IConfigurable changed */
    this.rtmpOutputService.setVideoEncoderType(
      EEncoderMode.Advanced,
      option.value
    );
    const videoEncoderId = this.rtmpOutputService.getVideoEncoderId();
    this.advRtmpVideoEncoderForm = this.encoderService.getPropertyFormData(
      videoEncoderId
    );
  }

  inputRecordingFolderPath(path: string) {
    this.recOutputService.setFileDirectory(path);
  }

  inputRecordingFormat(option: IListOption<string>) {
    this.recOutputService.setRecordingFormat(option.value);
  }

  inputRecordingTracks(checked: boolean, index: number) {
    this.recOutputService.setTrack(checked, index);
  }

  inputTrackAudio(option: IListOption<number>, index: number) {
    this.recOutputService.setAudioBitrate(option.value, index);
  }

  inputRecordingQuality(option: IListOption<ERecordingQuality>) {
    this.recOutputService.setQuality(option.value);
  }

  inputRecordingType(option: IListOption<ERecordingEncoders>) {
    this.recOutputService.setEncoderType(option.value);
  }
}
