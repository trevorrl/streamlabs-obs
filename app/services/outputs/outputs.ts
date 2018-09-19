import Vue from 'vue';
import { StatefulService, mutation } from '../stateful-service';
import { ipcRenderer, remote } from 'electron';
import { EncoderService } from '../encoders';
import { ProviderService } from '../providers';
import { Inject } from '../../util/injector';
import { BetterPropertiesManager } from 'services/common-properties';
import { DefaultManager } from '../sources/properties-managers/default-manager';
import { DBQueueManager } from 'services/common-config';
import {
  TFormData,
  setupConfigurableDefaults
} from 'components/shared/forms/Input';
import path from 'path';
import PouchDB from 'pouchdb';
import {
  ISettings,
  IService,
  IOutput,
  OutputFactory,
  VideoEncoderFactory,
  AudioEncoderFactory,
  ServiceFactory,
  VideoFactory,
  AudioFactory
} from 'services/obs-api';

type TOutputServiceState = Dictionary<IFOutput>;

interface IOutputContent {
  type: string;
  settings: ISettings;

  audioEncoder: string[];
  audioTrackBitmask: number;

  videoEncoder: string;
  provider: string;

  delay: number;
  delayFlags: number;

  isDummy: boolean;
}

interface IFOutput extends IOutputContent {
  isPersistent: boolean;
  isActive: boolean;
  supportedAudioCodecs: string[];
  supportedVideoCodecs: string[];
}

export class OutputService extends StatefulService<TOutputServiceState> {
  private initialized = false;
  private db = new DBQueueManager<IOutputContent>(
    path.join(remote.app.getPath('userData'), 'Outputs')
  );

  private propManagers: Dictionary<BetterPropertiesManager> = {};

  @Inject() providerService: ProviderService;
  @Inject() encoderService: EncoderService;

  static initialState: TOutputServiceState = {};

  static getUniqueId(): string {
    return 'output_' + ipcRenderer.sendSync('getUniqueId');
  }

  checkId(uniqueId: string) {
    if (!this.state[uniqueId]) {
      console.warn(`${uniqueId} doesn't exist!`);
      return false;
    }

    return true;
  }

  private queueChange(uniqueId: string) {
    const output = this.state[uniqueId];

    if (!output.isPersistent) return;

    const change = {
      type: output.type,
      settings: output.settings,
      audioTrackBitmask: output.audioTrackBitmask,
      audioEncoder: output.audioEncoder,
      videoEncoder: output.videoEncoder,
      provider: output.provider,
      isDummy: output.isDummy,
      delay: output.delay,
      delayFlags: output.delayFlags
    };

    this.db.queueChange(uniqueId, change);
  }

  private connectDefaultSignals(obsOutput: IOutput) {
    obsOutput.on('stop', (outputId, code) => this.handleStop(outputId, code));
    obsOutput.on('start', outputId => this.handleStart(outputId));
  }

  private syncConfig(
    result: PouchDB.Core.AllDocsResponse<IOutputContent>
  ): void {
    for (let i = 0; i < result.total_rows; ++i) {
      let changed = false;
      const entry = result.rows[i].doc;

      let obsOutput = null;

      if (entry.settings)
        obsOutput = OutputFactory.create(entry.type, entry._id, entry.settings);
      else obsOutput = OutputFactory.create(entry.type, entry._id);

      if (!obsOutput) {
        console.warn(`Failed to create output with type ${entry.type}!`);
        continue;
      }

      const output: IFOutput = {
        type: entry.type,
        settings: entry.settings,
        audioEncoder: entry.audioEncoder,
        audioTrackBitmask: entry.audioTrackBitmask,
        videoEncoder: entry.videoEncoder,
        provider: entry.provider,
        delay: entry.delay,
        delayFlags: entry.delayFlags,
        isDummy: entry.isDummy,
        isPersistent: true,
        isActive: false,
        supportedAudioCodecs: obsOutput.supportedAudioCodecs,
        supportedVideoCodecs: obsOutput.supportedVideoCodecs
      };

      for (let k = 0; k < entry.audioEncoder.length; ++k) {
        const encoder = entry.audioEncoder[k];

        if (encoder) {
          if (this.encoderService.state[encoder] == null) {
            console.warn(
              `Bad audio encoder ${encoder} for output ${entry._id}`
            );

            output.audioEncoder[k] = '';
            changed = true;
          }
        }
      }

      if (entry.videoEncoder) {
        if (this.encoderService.state[entry.videoEncoder] == null) {
          console.warn(
            `Bad video encoder ${entry.videoEncoder} for output ${entry._id}`
          );

          output.videoEncoder = '';
          changed = true;
        }
      }

      if (entry.provider) {
        if (this.providerService.state[entry.provider] == null) {
          console.warn(
            `Bad provider ${entry.videoEncoder} for output ${entry._id}`
          );

          output.provider = '';
          changed = true;
        } else {
          const service = ServiceFactory.fromName(entry.provider);

          obsOutput.service = service;
        }

        const obsProvider = ServiceFactory.fromName(entry.provider);
        obsOutput.service = obsProvider;
      }

      obsOutput.setDelay(entry.delay, entry.delayFlags);

      this.propManagers[entry._id] = new BetterPropertiesManager(
        obsOutput.properties,
        entry.settings
      );

      this.ADD_OUTPUT(entry._id, output);
      if (changed) this.queueChange(entry._id);
      this.connectDefaultSignals(obsOutput);
    }
  }

  async initialize() {
    if (this.initialized) return;
    await this.encoderService.initialize();
    await this.providerService.initialize();
    await this.db.initialize(response => this.syncConfig(response));

    this.initialized = true;
  }

  destroy() {
    const keys = Object.keys(this.state);

    for (let i = 0; i < keys.length; ++i) {
      const obsObject = OutputFactory.fromName(keys[i]);

      if (obsObject) obsObject.release();
    }
  }

  @mutation()
  private ADD_OUTPUT(uniqueId: string, fOutput: IFOutput) {
    Vue.set(this.state, uniqueId, fOutput);
  }

  @mutation()
  private REMOVE_OUTPUT(uniqueId: string) {
    Vue.delete(this.state, uniqueId);
  }

  @mutation()
  private UPDATE_SETTINGS(uniqueId: string, settings: object) {
    Vue.set(this.state[uniqueId], 'settings', settings);
  }

  @mutation()
  private UPDATE_AUDIO_ENCODER(
    uniqueId: string,
    encoderId: string,
    index: number
  ) {
    this.state[uniqueId].audioEncoder[index] = encoderId;
  }

  @mutation()
  private UPDATE_VIDEO_ENCODER(uniqueId: string, encoderId: string) {
    this.state[uniqueId].videoEncoder = encoderId;
  }

  @mutation()
  private UPDATE_PROVIDER(uniqueId: string, providerId: string) {
    this.state[uniqueId].provider = providerId;
  }

  @mutation()
  private UPDATE_DELAY(uniqueId: string, delay: number) {
    this.state[uniqueId].delay = delay;
  }

  @mutation()
  private UPDATE_DELAY_FLAG(uniqueId: string, flags: number) {
    this.state[uniqueId].delayFlags = flags;
  }

  @mutation()
  private IS_ACTIVE(uniqueId: string, active: boolean) {
    this.state[uniqueId].isActive = active;
  }

  @mutation()
  private UPDATE_TRACK_BIT(uniqueId: string, index: number, enabled: boolean) {
    const bit = enabled ? 1 : 0;

    /* Clear bit */
    this.state[uniqueId].audioTrackBitmask &= ~(1 << index);

    /* Set bit if bit variable is not zero */
    this.state[uniqueId].audioTrackBitmask |= bit << index;
  }

  @mutation()
  private UPDATE_TRACK_MASK(mask: number) {}

  addOutput(
    type: string,
    uniqueId: string,
    settings?: ISettings,
    options?: { isPersistent?: boolean; isDummy?: boolean }
  ) {
    let obsOutput = null;

    if (!options) {
      options = { isPersistent: true, isDummy: false };
    }

    if (options.isPersistent === undefined) options.isPersistent = true;
    if (settings) obsOutput = OutputFactory.create(type, uniqueId, settings);
    else obsOutput = OutputFactory.create(type, uniqueId);

    if (!obsOutput) {
      console.warn(`Failed to create output with type ${type}`);
      return false;
    }

    const output: IFOutput = {
      type,
      settings,
      audioEncoder: ['', '', '', '', '', ''],
      videoEncoder: '',
      provider: '',
      delay: 0,
      delayFlags: 0,
      audioTrackBitmask: 1 << 0,
      isPersistent: options.isPersistent,
      isDummy: options.isDummy,
      isActive: false,
      supportedAudioCodecs: obsOutput.supportedAudioCodecs,
      supportedVideoCodecs: obsOutput.supportedVideoCodecs
    };

    console.debug(output);

    this.ADD_OUTPUT(uniqueId, output);

    setupConfigurableDefaults(obsOutput);
    this.UPDATE_SETTINGS(uniqueId, settings);

    this.connectDefaultSignals(obsOutput);

    this.db.addQueue(uniqueId);
    this.queueChange(uniqueId);
    this.propManagers[uniqueId] = new BetterPropertiesManager(
      obsOutput.properties,
      settings
    );

    if (options.isDummy) {
      /* We want to make sure the output can be created
         * but we don't want it to be valid */
      obsOutput.release();
    }

    return true;
  }

  removeOutput(uniqueId: string) {
    const output = this.state[uniqueId];
    const isDummy = output.isDummy;

    if (output.isPersistent) this.db.queueDeletion(uniqueId);
    this.REMOVE_OUTPUT(uniqueId);

    if (isDummy) return;

    const obsOutput = OutputFactory.fromName(uniqueId);
    obsOutput.release();
  }

  private handleStop(outputId: string, code: number) {
    this.IS_ACTIVE(outputId, false);
  }

  private handleStart(outputId: string) {}

  startOutput(uniqueId: string) {
    /* If the output is already active, do nothing. 
     * OBS will do similar but we save IPC here. */
    const output = this.state[uniqueId];

    if (!output || output.isDummy) {
      return false;
    }

    if (this.state[uniqueId].isActive) return false;

    const obsOutput = OutputFactory.fromName(uniqueId);
    const videoEncoder = obsOutput.getVideoEncoder();

    const rawOutputs = ['ffmpeg_output'];

    /* If we previously reset audio/video context, set context
    * will be invalid. As a result, just assign the encoders
    * the current global before we start streaming. to make
    * sure it's always a valid context. */

    /* For whatever reason... we can't fetch capability 
     * flags for outputs, so we can't tell if our output
     * is encoded or not. This is important since we can't
     * tell if we need to set media to the encoders or to
     * the output directly. *sigh*
     * 
     * For now, we just... whitelist known non-encoded
     * outputs and if found, assign media directly. */
    if (rawOutputs.includes(this.state[uniqueId].type)) {
        obsOutput.setMedia(VideoFactory.getGlobal(), AudioFactory.getGlobal());
    } else {
      for (let i = 0; i < 6; ++i) {
        const audioEncoder = obsOutput.getAudioEncoder(i);
        audioEncoder.setAudio(AudioFactory.getGlobal());
      }

      videoEncoder.setVideo(VideoFactory.getGlobal());
    }

    const starting = obsOutput.start();

    this.IS_ACTIVE(uniqueId, starting);
    return starting;
  }

  stopOutput(uniqueId: string) {
    if (!this.checkId(uniqueId)) return;
    if (this.state[uniqueId].isDummy) return;

    const output = OutputFactory.fromName(uniqueId);

    output.stop();
  }

  setOutputVideoEncoder(uniqueId: string, encoderId: string) {
    if (!this.checkId(uniqueId)) return;

    if (!this.encoderService.state[encoderId] && encoderId != null) {
      console.warn(`${encoderId} doesn't exist!`);
      return false;
    }

    this.UPDATE_VIDEO_ENCODER(uniqueId, encoderId);
    this.queueChange(uniqueId);

    if (this.state[uniqueId].isDummy) return;

    const output = OutputFactory.fromName(uniqueId);

    if (encoderId != null) {
      const encoder = VideoEncoderFactory.fromName(encoderId);
      output.setVideoEncoder(encoder);
    } else {
      output.setVideoEncoder(null);
    }
  }

  setOutputAudioEncoder(uniqueId: string, encoderId: string, track: number) {
    if (!this.checkId(uniqueId)) return;

    if (!this.encoderService.state[encoderId] && encoderId != null) {
      console.warn(`${encoderId} doesn't exist!`);
      return false;
    }

    this.UPDATE_AUDIO_ENCODER(
      uniqueId,
      encoderId == null ? '' : encoderId,
      track
    );

    this.queueChange(uniqueId);

    if (this.state[uniqueId].isDummy) return;

    const output = OutputFactory.fromName(uniqueId);

    if (encoderId != null) {
      const encoder = AudioEncoderFactory.fromName(encoderId);
      output.setAudioEncoder(encoder, track);
    } else {
      output.setAudioEncoder(null, 0);
    }
  }

  setOutputProvider(uniqueId: string, serviceId: string) {
    if (!this.checkId(uniqueId)) return;

    if (!this.providerService.state[serviceId] && serviceId != null) {
      console.warn(`${serviceId} doesn't exist!`);
      return;
    }

    this.UPDATE_PROVIDER(uniqueId, serviceId);
    this.queueChange(uniqueId);

    if (this.state[uniqueId].isDummy) return;

    const service = ServiceFactory.fromName(serviceId);
    const output = OutputFactory.fromName(uniqueId);

    output.service = service;
  }

  getVideoEncoder(uniqueId: string): string {
    if (!this.checkId(uniqueId)) return '';

    return this.state[uniqueId].videoEncoder;
  }

  getAudioEncoder(uniqueId: string, track: number): string {
    if (!this.checkId(uniqueId)) return;

    return this.state[uniqueId].audioEncoder[track];
  }

  getOutputProvider(uniqueId: string): string {
    if (!this.checkId(uniqueId)) return '';

    return this.state[uniqueId].provider;
  }

  isOutput(uniqueId: string) {
    const obsOutput: IOutput = OutputFactory.fromName(uniqueId);

    if (obsOutput) return true;

    return false;
  }

  updateSettings(uniqueId: string, patch: object) {
    if (!this.checkId(uniqueId)) return;

    const obsOutput = OutputFactory.fromName(uniqueId);
    const settings = Object.assign({}, obsOutput.settings, patch);

    this.UPDATE_SETTINGS(uniqueId, settings);
    this.queueChange(uniqueId);

    if (this.state[uniqueId].isDummy) return;

    obsOutput.update(settings);
    this.propManagers[uniqueId].properties.apply(settings);
  }

  /* We somewhat wrap over delay since we
   * can't fetch flags from obs state. We
   * hold it instead and handle it as if
   * it were persistent state */
  setDelay(uniqueId: string, delay: number) {
    if (!this.checkId(uniqueId)) return;

    const obsOutput = OutputFactory.fromName(uniqueId);
    const flags = this.state[uniqueId].delayFlags;

    this.UPDATE_DELAY(uniqueId, delay);
    this.queueChange(uniqueId);

    if (this.state[uniqueId].isDummy) return;

    obsOutput.setDelay(delay, flags);
  }

  getDelay(uniqueId: string): number {
    if (!this.checkId(uniqueId)) return 0;

    return this.state[uniqueId].delay;
  }

  setDelayFlag(uniqueId: string, flags: number) {
    if (!this.checkId(uniqueId)) return;

    const obsOutput = OutputFactory.fromName(uniqueId);
    const delay = this.state[uniqueId].delay;

    this.UPDATE_DELAY_FLAG(uniqueId, flags);
    this.queueChange(uniqueId);

    if (this.state[uniqueId].isDummy) return;

    obsOutput.setDelay(delay, flags);
  }

  getDelayFlag(uniqueId: string): number {
    if (!this.checkId(uniqueId)) return 0;

    return this.state[uniqueId].delayFlags;
  }

  getComponentList(uniqueId: string) {
      return this.propManagers[uniqueId].createComponentList();
  }

  onStart(uniqueId: string, callback: (output: string) => void) {
    if (this.state[uniqueId].isDummy) return;

    const obsOutput = OutputFactory.fromName(uniqueId);

    if (!this.checkId(uniqueId)) return;

    obsOutput.on('start', callback);
  }

  onStop(uniqueId: string, callback: (output: string, code: number) => void) {
    if (this.state[uniqueId].isDummy) return;

    const obsOutput = OutputFactory.fromName(uniqueId);

    if (!this.checkId(uniqueId)) return;

    obsOutput.on('stop', callback);
  }

  onReconnect(uniqueId: string, callback: (output: string) => void) {
    if (this.state[uniqueId].isDummy) return;

    const obsOutput = OutputFactory.fromName(uniqueId);

    if (!this.checkId(uniqueId)) return;

    obsOutput.on('reconnect', callback);
  }

  onReconnectSuccess(uniqueId: string, callback: (output: string) => void) {
    if (this.state[uniqueId].isDummy) return;

    const obsOutput = OutputFactory.fromName(uniqueId);

    if (!this.checkId(uniqueId)) return;

    obsOutput.on('reconnect_success', callback);
  }

  getLastError(uniqueId: string): string {
    if (this.state[uniqueId].isDummy) return;

    const obsOutput = OutputFactory.fromName(uniqueId);

    if (!this.checkId(uniqueId)) return;

    return obsOutput.getLastError();
  }
}
