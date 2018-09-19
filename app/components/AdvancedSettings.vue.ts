import Vue from 'vue';
import { Component } from 'vue-property-decorator';
import { Inject } from '../util/injector';
import SettingsListInput from './shared/forms/SettingsListInput.vue';
import ListInput from './shared/forms/ListInput.vue';
import BoolInput from './shared/forms/BoolInput.vue';
import IntInput from './shared/forms/IntInput.vue';
import GenericForm from './shared/forms/GenericForm.vue';
import { SettingsStorageService } from 'services/settings';
import { OutputService } from 'services/outputs';
import { RtmpOutputService } from 'services/rtmp-output';

import {
  IFormInput,
  IListInput,
  IListOption,
  TFormData,
  INumberInputValue
} from '../components/shared/forms/Input';

import {
  EPropertyType,
  EVideoFormat,
  EColorSpace,
  ERangeType,
  ENumberType,
  Global
} from 'services/obs-api';
import { StreamingService } from 'services/streaming';

@Component({
  components: {
    SettingsListInput,
    ListInput,
    BoolInput,
    IntInput,
    ComponentListForm,
    GenericForm
  }
})
export default class AdvancedSettings extends Vue {
  @Inject() settingsStorageService: SettingsStorageService;
  @Inject() outputService: OutputService;
  @Inject() rtmpOutputService: RtmpOutputService;
  @Inject() streamingService: StreamingService;

  get isActive() {
    return this.streamingService.state.isActive;
  }

  videoCollapsed = false;
  audioCollapsed = false;
  streamDelayCollapsed = false;
  networkCollapsed = false;

  get videoFormatValue() {
    return this.settingsStorageService.state.Video.ColorFormat;
  }

  get videoColorSpaceValue() {
    return this.settingsStorageService.state.Video.ColorSpace;
  }

  get videoColorRangeValue() {
    return this.settingsStorageService.state.Video.ColorRange;
  }

  videoFormatOptions = [
    { value: EVideoFormat.NV12, description: 'NV12' },
    { value: EVideoFormat.I420, description: 'I420' },
    { value: EVideoFormat.I444, description: 'I444' },
    { value: EVideoFormat.RGBA, description: 'RGBA' }
  ];

  videoColorSpaceOptions = [
    { value: EColorSpace.CS601, description: '601' },
    { value: EColorSpace.CS709, description: '709' }
  ];

  videoColorRangeOptions = [
    { value: ERangeType.Default, description: 'Default' },
    { value: ERangeType.Full, description: 'Full' },
    { value: ERangeType.Partial, description: 'Partial' }
  ];

  private buildMonitoringDeviceOptions(): IListOption<string>[] {
    const monitoringDevices = Global.getAudioMonitoringDevices();

    let options: IListOption<string>[] = [
      { description: 'Default', value: 'default' }
    ];

    for (let i = 0; i < monitoringDevices.length; ++i) {
      options.push({
        value: monitoringDevices[i].id,
        description: monitoringDevices[i].name
      });
    }

    return options;
  }

  monitoringDevicesForm: IListInput<string> = {
    value: this.settingsStorageService.state.Audio.MonitoringDeviceId,
    name: 'monitoring_device',
    description: 'Audio Monitoring Device',
    options: this.buildMonitoringDeviceOptions()
  };

  networkForm = this.outputService.getComponentList(
    'output_rtmp_output'
  );

  get streamDelayEnabled(): IFormInput<boolean> {
    return {
      value: this.settingsStorageService.state.Delay.Enabled,
      name: 'delay_enabled',
      description: 'Enabled'
    };
  }

  set streamDelayEnabled(formData: IFormInput<boolean>) {
    const outputId = this.rtmpOutputService.getOutputId();

    this.outputService.setDelay(outputId, 0);

    this.settingsStorageService.setDelaySettings({
      Enabled: formData.value
    });
  }

  streamDelayTime = {
    value: this.outputService.getDelay(this.rtmpOutputService.getOutputId()),
    name: 'delay_time',
    description: 'Duration (seconds)',
    type: EPropertyType.Int,
    subType: ENumberType.Scroller,
    minVal: 0,
    maxVal: 1000000,
    stepVal: 1
  };

  get streamPreserve(): IFormInput<boolean> {
    return {
      value: this.outputService.getDelayFlag(
        this.rtmpOutputService.getOutputId()
      )
        ? true
        : false,
      name: 'delay_reconnect_preserve',
      description: 'Preserve cutoff point when reconnecting'
    };
  }

  set streamPreserve(formData: IFormInput<boolean>) {
    const outputId = this.rtmpOutputService.getOutputId();
    this.outputService.setDelayFlag(outputId, formData.value ? 1 : 0);
  }

  inputVideoFormat(formData: IListInput<EVideoFormat>) {
    this.settingsStorageService.setVideoSettings({
      ColorFormat: formData.value
    });

    this.settingsStorageService.resetVideo();
  }

  inputVideoColorSpace(formData: IListInput<EColorSpace>) {
    this.settingsStorageService.setVideoSettings({
      ColorSpace: formData.value
    });

    this.settingsStorageService.resetVideo();
  }

  inputVideoColorRange(formData: IListInput<EColorSpace>) {
    this.settingsStorageService.setVideoSettings({
      ColorRange: formData.value
    });

    this.settingsStorageService.resetVideo();
  }

  inputNetwork(formData: TFormData) {
    const outputId = this.rtmpOutputService.getOutputId();

    this.outputService.setPropertiesFormData(outputId, formData);
    this.networkForm = this.outputService.getPropertiesFormData(outputId);
  }

  inputStreamDelayTime(formData: INumberInputValue) {
    const outputId = this.rtmpOutputService.getOutputId();
    this.outputService.setDelay(outputId, formData.value);
  }

  inputMonitoringDevices(formData: IListInput<string>) {
    /* Names can be duplicate but the id cannot be.
     * That said, obs expects the id *and* name. 
     * So we search the current options for the id
     * and get the associated description which
     * is the name we want. */
    const options = formData.options;
    let name;

    for (let i = 0; i < options.length; ++i) {
      if (options[i].value === formData.value) {
        name = options[i].description;
        break;
      }
    }

    this.settingsStorageService.setAudioSettings({
      MonitoringDeviceId: formData.value,
      MonitoringDeviceName: name
    });

    this.settingsStorageService.resetMonitoringDevice();
  }
}
