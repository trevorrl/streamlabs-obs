import { StatefulService, mutation } from 'services/stateful-service';
import { ipcRenderer, remote } from 'electron';
import {
  TFormData,
  INumberInputValue,
  setupConfigurableDefaults
} from 'components/shared/forms/Input';
import { PropertiesManager } from 'services/sources/properties-managers/properties-manager';
import { DefaultManager } from 'services/sources/properties-managers/default-manager';
import { DBQueueManager } from 'services/common-config';
import Vue from 'vue';
import PouchDB from 'pouchdb';
import {
  IAudioEncoder,
  IVideoEncoder,
  AudioEncoderFactory,
  VideoEncoderFactory,
  VideoFactory,
  AudioFactory,
  ServiceFactory,
  EPropertyType,
  EListFormat,
  ISettings,
  Encoder
} from 'services/obs-api';
import path from 'path';
import { isNumberProperty, isListProperty } from 'util/properties-type-guards';

type TEncoderServiceState = Dictionary<IFEncoder>;

interface IEncoderContent {
  type: string;
  settings: ISettings;
  isAudio: boolean;
}

interface IFEncoder extends IEncoderContent {
  isPersistent: boolean;
}

export class EncoderService extends StatefulService<TEncoderServiceState> {
  private initialized = false;
  private propManagers: Dictionary<PropertiesManager> = {};
  private db = new DBQueueManager<IEncoderContent>(
    path.join(remote.app.getPath('userData'), 'Encoders')
  );

  /* Unfortunately, since JS won't hold strings by reference,
   * we need to reference these strings by offset else we'll 
   * be taking up kilobytes more worth of memory. */
  private aacEncoders = ['ffmpeg_aac', 'mf_aac', 'libfdk_aac', 'CoreAudio_AAC'];
  private aacBitrateMap = new Map<number, number>();

  private populateAACBitrateMap() {
    const types = AudioEncoderFactory.types();

    for (let offset = 0; offset < this.aacEncoders.length; ++offset) {
      /* This check is to make sure the encoder exists more than
       * it is to check that it supports the AAC codec. */
      if (Encoder.getCodec(this.aacEncoders[offset]) !== 'AAC') continue;

      const properties = Encoder.getProperties(this.aacEncoders[offset]);
      const bitrateProp = properties.get('bitrate');

      /* Different encoders use list or integer based properties. 
       * We need to handle both. */
      if (isNumberProperty(bitrateProp)) {
        const max = bitrateProp.details.max;
        const min = bitrateProp.details.min;
        const step = bitrateProp.details.step;

        for (let i = min; i <= max; i += step) {
          this.aacBitrateMap.set(i, offset);
        }
      } else if (isListProperty(bitrateProp)) {
        const items = bitrateProp.details.items;

        for (let i = 0; i < items.length; ++i) {
          /* Technically, we should check for disabled items.
           * The bindings don't expose that quite yet. TODO FIXME */
          this.aacBitrateMap.set(items[i].value as number, offset);
        }
      } else {
        console.warn(
          `${this.aacEncoders[offset]} uses unknown bitrate property type`
        );
      }

      /* Sort the map for convenience */

      this.aacBitrateMap = new Map(
        Array.from(this.aacBitrateMap.entries()).sort((a, b) => a[0] - b[0])
      );
    }
  }

  checkId(uniqueId: string) {
    if (!this.state[uniqueId]) {
      console.warn(`${uniqueId} doesn't exist!`);
      return false;
    }

    return true;
  }

  private queueChange(uniqueId: string) {
    const encoder = this.state[uniqueId];

    if (!encoder.isPersistent) return;

    const change = {
      type: encoder.type,
      settings: encoder.settings,
      isAudio: encoder.isAudio
    };

    this.db.queueChange(uniqueId, change);
  }

  private queueDeletion(uniqueId: string) {
    this.propManagers[uniqueId].destroy();
    delete this.propManagers[uniqueId];

    if (this.state[uniqueId].isPersistent) this.db.queueDeletion(uniqueId);

    this.REMOVE_ENCODER(uniqueId);
  }

  private syncConfig(result: any): void {
    for (let i = 0; i < result.total_rows; ++i) {
      const entry = result.rows[i].doc;

      const encoder: IFEncoder = {
        type: entry.type,
        settings: entry.settings,
        isAudio: entry.isAudio,
        isPersistent: true
      };

      this.ADD_ENCODER(entry._id, encoder);

      let obsEncoder = null;

      if (encoder.isAudio) {
        if (entry.settings)
          obsEncoder = AudioEncoderFactory.create(
            entry.type,
            entry._id,
            entry.settings
          );
        else obsEncoder = AudioEncoderFactory.create(entry.type, entry._id);
      } else {
        if (entry.settings)
          obsEncoder = VideoEncoderFactory.create(
            entry.type,
            entry._id,
            entry.settings
          );
        else obsEncoder = VideoEncoderFactory.create(entry.type, entry._id);
      }

      this.propManagers[entry._id] = new DefaultManager(obsEncoder, {});
    }
  }

  static initialState: TEncoderServiceState = {};

  static getUniqueId(): string {
    return 'encoder_' + ipcRenderer.sendSync('getUniqueId');
  }

  async initialize() {
    if (this.initialized) return;

    await this.db.initialize(response => this.syncConfig(response));
    this.populateAACBitrateMap();

    this.initialized = true;
  }

  destroy() {
    const keys = Object.keys(this.state);

    for (let i = 0; i < keys.length; ++i) {
      let obsObject = null;

      if (this.state[keys[i]].isAudio)
        obsObject = AudioEncoderFactory.fromName(keys[i]);
      else obsObject = VideoEncoderFactory.fromName(keys[i]);

      if (obsObject) obsObject.release();
    }
  }

  @mutation()
  ADD_ENCODER(uniqueId: string, encoder: IFEncoder) {
    Vue.set(this.state, uniqueId, encoder);
  }

  @mutation()
  REMOVE_ENCODER(uniqueId: string) {
    Vue.delete(this.state, uniqueId);
  }

  @mutation()
  private UPDATE_SETTINGS(uniqueId: string, settings: any) {
    this.state[uniqueId].settings = settings;
  }

  addAudioEncoder(
    type: string,
    uniqueId: string,
    isPersistent?: boolean,
    track?: number,
    settings?: ISettings
  ) {
    let obsEncoder: IAudioEncoder = null;

    if (isPersistent === undefined) isPersistent = true;
    if (settings)
      obsEncoder = AudioEncoderFactory.create(type, uniqueId, settings, track);
    else obsEncoder = AudioEncoderFactory.create(type, uniqueId, {}, track);

    if (!obsEncoder) {
      console.warn(`Failed to create audio encoder with type ${type}`);
      return false;
    }

    const encoder: IFEncoder = {
      settings,
      type,
      isAudio: true,
      isPersistent
    };

    this.ADD_ENCODER(uniqueId, encoder);

    setupConfigurableDefaults(obsEncoder);
    this.UPDATE_SETTINGS(uniqueId, obsEncoder.settings);

    this.db.addQueue(uniqueId);
    this.queueChange(uniqueId);
    this.propManagers[uniqueId] = new DefaultManager(
      AudioEncoderFactory.fromName(uniqueId),
      {}
    );

    return true;
  }

  addVideoEncoder(
    type: string,
    uniqueId: string,
    isPersistent?: boolean,
    settings?: ISettings
  ) {
    let obsEncoder: IVideoEncoder = null;

    if (isPersistent === undefined) isPersistent = true;
    if (settings)
      obsEncoder = VideoEncoderFactory.create(type, uniqueId, settings);
    else obsEncoder = VideoEncoderFactory.create(type, uniqueId);

    if (!obsEncoder) {
      console.warn(`Failed to create video encoder with type ${type}`);
      return false;
    }

    const encoder: IFEncoder = {
      settings,
      type,
      isAudio: false,
      isPersistent
    };

    this.ADD_ENCODER(uniqueId, encoder);

    setupConfigurableDefaults(obsEncoder);
    this.UPDATE_SETTINGS(uniqueId, obsEncoder.settings);

    this.db.addQueue(uniqueId);
    this.queueChange(uniqueId);
    this.propManagers[uniqueId] = new DefaultManager(
      VideoEncoderFactory.fromName(uniqueId),
      {}
    );

    return true;
  }

  removeAudioEncoder(uniqueId: string) {
    if (!this.checkId(uniqueId)) return;

    const encoder = AudioEncoderFactory.fromName(uniqueId);
    encoder.release();

    this.queueDeletion(uniqueId);
  }

  removeVideoEncoder(uniqueId: string) {
    if (!this.checkId(uniqueId)) return;

    const encoder = VideoEncoderFactory.fromName(uniqueId);
    encoder.release();

    this.queueDeletion(uniqueId);
  }

  getAvailableVideoEncoders(): string[] {
    /* Media foundation video encoders suck */
    const blacklist = ['mf_h264_nvenc', 'mf_h264_vce', 'mf_h264_qsv'];

    return VideoEncoderFactory.types().filter(
      type => !blacklist.includes(type)
    );
  }

  getAvailableAudioEncoders(): string[] {
    return AudioEncoderFactory.types();
  }

  updateSettings(uniqueId: string, patch: any) {
    const encoder = this.state[uniqueId];

    if (!this.checkId(uniqueId)) return;

    let obsEncoder = null;

    if (encoder.isAudio) obsEncoder = AudioEncoderFactory.fromName(uniqueId);
    else obsEncoder = VideoEncoderFactory.fromName(uniqueId);

    const newSettings = obsEncoder.settings;
    Object.assign(newSettings, patch);

    obsEncoder.update(newSettings);
  }

  updateSettingsDirect(uniqueId: string, settings: any) {
    const encoder = this.state[uniqueId];

    if (!this.checkId(uniqueId)) return;

    let obsEncoder = null;

    if (encoder.isAudio) obsEncoder = AudioEncoderFactory.fromName(uniqueId);
    else obsEncoder = VideoEncoderFactory.fromName(uniqueId);
    obsEncoder.update(settings);
  }

  getPropertyFormData(uniqueId: string) {
    if (!this.checkId(uniqueId)) return null;

    return this.propManagers[uniqueId].getPropertiesFormData();
  }

  setPropertyFormData(uniqueId: string, formData: TFormData) {
    const encoder = this.state[uniqueId];

    if (!this.checkId(uniqueId)) return;

    this.propManagers[uniqueId].setPropertiesFormData(formData);

    let settings = null;

    if (encoder.isAudio)
      settings = AudioEncoderFactory.fromName(uniqueId).settings;
    else settings = VideoEncoderFactory.fromName(uniqueId).settings;

    this.UPDATE_SETTINGS(uniqueId, settings);
    this.queueChange(uniqueId);
  }

  getBestAACEncoderForBitrate(bitrate: number): string {
    const offset = this.aacBitrateMap.get(bitrate);

    if (offset == null) return 'ffmpeg_aac';

    return this.aacEncoders[offset];
  }

  getSupportedAudioBitrates(): number[] {
    return Array.from(this.aacBitrateMap.keys());
  }
}
