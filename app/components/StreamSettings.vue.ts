import Vue from 'vue';
import { Component, Watch } from 'vue-property-decorator';
import { Inject } from '../util/injector';
import SettingsListInput from './shared/forms/SettingsListInput.vue';
import GenericForm from './shared/forms/GenericForm.vue';
import { RtmpOutputService, EProviderMode } from 'services/rtmp-output';
import { ProviderService } from 'services/providers';
import { TFormData, IListOption, getPropertiesFormData } from './shared/forms/Input';
import { ServiceFactory } from 'services/obs-api';
import { Multiselect } from 'vue-multiselect';
import { StreamingService } from 'services/streaming';

@Component({
  components: { GenericForm, SettingsListInput }
})

export default class StreamSettings extends Vue {

  @Inject() rtmpOutputService: RtmpOutputService;
  @Inject() providerService: ProviderService;
  @Inject() streamingService: StreamingService;

  getPropertyFormData = () => {
    const formData = this.providerService.getPropertyFormData(this.rtmpOutputService.getProviderId());

    for (let i = 0; i < formData.length; ++i) {
        formData[i].enabled = !this.isActive;
    }

    return formData;
  }

  settingsFormData = this.getPropertyFormData();

  get serviceTypeValue() {
      return this.rtmpOutputService.state.rtmpProviderMode;
  }

  serviceTypeOptions = [
    { description: 'Streaming Service', value: EProviderMode.Common },
    { description: 'Custom', value: EProviderMode.Custom }
  ];

  inputServiceType(option: IListOption<number>) {
    this.rtmpOutputService.setProviderMode(option.value);
    this.settingsFormData = this.getPropertyFormData();
  }

  get isActive() {
      return this.streamingService.isStreaming;
  }

  @Watch('isActive')
  checkActive() {
    for (let i = 0; i < this.settingsFormData.length; ++i) {
        this.settingsFormData[i].enabled = !this.isActive;
    }
  }

  save(formData: TFormData) {
    const providerId = this.rtmpOutputService.getProviderId();

    this.providerService.setPropertyFormData(providerId, formData);
    this.settingsFormData = this.getPropertyFormData();

    /* The following code makes me violently ill */
    if (this.serviceTypeValue !== EProviderMode.Common) return;

    this.rtmpOutputService.notifyServiceChangeIGuess();
  }
}
