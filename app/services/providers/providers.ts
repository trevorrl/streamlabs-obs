import { StatefulService, mutation } from '../stateful-service';
import { ipcRenderer, remote } from 'electron';
import { getConfigFilePath } from '../config';
import { DefaultManager } from '../sources/properties-managers/default-manager';
import { DBQueueManager } from 'services/common-config';
import {
  TFormData,
  setupConfigurableDefaults
} from 'components/shared/forms/Input';
import path from 'path';
import Vue from 'vue';
import PouchDB from 'pouchdb';
import {
  ISettings,
  IService,
  IConfigurable,
  ServiceFactory
} from 'services/obs-api';

type TProviderServiceState = Dictionary<IFProvider>;

interface IProviderContent {
  type: string;
  settings: ISettings;
}

interface IFProvider extends IProviderContent {
  isPersistent: boolean;
}

export class ProviderService extends StatefulService<TProviderServiceState> {
  private initialized = false;
  private db = new DBQueueManager<IProviderContent>(
    path.join(remote.app.getPath('userData'), 'Providers')
  );
  private propManagers: Dictionary<DefaultManager> = {};

  static initialState: TProviderServiceState = {};

  static getUniqueId(): string {
    return 'provider_' + ipcRenderer.sendSync('getUniqueId');
  }

  checkId(uniqueId: string) {
    if (!this.state[uniqueId]) {
      console.warn(`${uniqueId} doesn't exist!`);
      return false;
    }

    return true;
  }

  private queueChange(uniqueId: string) {
    const provider = this.state[uniqueId];

    if (!provider.isPersistent) return;

    const change = {
      type: provider.type,
      settings: provider.settings
    };

    this.db.queueChange(uniqueId, change);
  }

  private syncConfig(result: any): void {
    for (let i = 0; i < result.total_rows; ++i) {
      const entry = result.rows[i].doc;

      const provider: IFProvider = {
        type: entry.type,
        settings: entry.settings,
        isPersistent: true
      };

      this.ADD_PROVIDER(entry._id, provider);

      let obsService: IService = null;

      if (entry.settings)
        obsService = ServiceFactory.create(
          entry.type,
          entry._id,
          entry.settings
        );
      else obsService = ServiceFactory.create(entry.type, entry._id);

      this.propManagers[entry._id] = new DefaultManager(obsService, {});
    }
  }

  async initialize() {
    if (this.initialized) return;

    await this.db.initialize(response => this.syncConfig(response));

    this.initialized = true;
  }

  destroy() {
    const keys = Object.keys(this.state);

    for (let i = 0; i < keys.length; ++i) {
      const obsObject = ServiceFactory.fromName(keys[i]);

      if (obsObject) obsObject.release();
    }
  }

  @mutation()
  private UPDATE_SETTINGS(uniqueId: string, settings: any) {
    this.state[uniqueId].settings = settings;
  }

  @mutation()
  private ADD_PROVIDER(uniqueId: string, fProvider: IFProvider) {
    Vue.set(this.state, uniqueId, fProvider);
  }

  @mutation()
  private REMOVE_PROVIDER(uniqueId: string) {
    Vue.delete(this.state, uniqueId);
  }

  addProvider(
    type: string,
    uniqueId: string,
    isPersistent?: boolean,
    settings?: ISettings
  ) {
    let obsService = null;

    if (isPersistent === undefined) isPersistent = true;
    if (settings) obsService = ServiceFactory.create(type, uniqueId, settings);
    else obsService = ServiceFactory.create(type, uniqueId);

    if (!obsService) {
      console.warn(`Failed to create service with type ${type}`);
      return false;
    }

    const provider: IFProvider = {
      type,
      settings,
      isPersistent
    };

    this.ADD_PROVIDER(uniqueId, provider);

    /* There might be a better way of doing this but
     * this is how Qt UI does it right now. */
    setupConfigurableDefaults(obsService);
    this.UPDATE_SETTINGS(uniqueId, obsService.settings);

    this.db.addQueue(uniqueId);
    this.queueChange(uniqueId);

    this.propManagers[uniqueId] = new DefaultManager(obsService, {});
    return true;
  }

  removeProvider(uniqueId: string) {
    if (!this.state[uniqueId]) {
      console.warn(`${uniqueId} doesn't exist!`);
      return;
    }

    const service = ServiceFactory.fromName(uniqueId);
    service.release();

    this.REMOVE_PROVIDER(uniqueId);

    this.propManagers[uniqueId].destroy();
    delete this.propManagers[uniqueId];

    if (!this.state[uniqueId].isPersistent) return;
    this.db.queueDeletion(uniqueId);
  }

  isProvider(uniqueId: string) {
    const obsService: IService = ServiceFactory.fromName(uniqueId);

    if (obsService) return true;

    return false;
  }

  updateSettings(uniqueId: string, patch: any) {
    if (!this.checkId(uniqueId)) return;

    const configurable: IConfigurable = ServiceFactory.fromName(uniqueId);
    const settings = Object.assign({}, configurable.settings, patch);

    configurable.update(settings);
    console.log(settings);
    this.UPDATE_SETTINGS(uniqueId, settings);
    this.queueChange(uniqueId);
  }

  /* We use the property form data 1:1 for Services. */
  getPropertyFormData(uniqueId: string) {
    if (!this.state[uniqueId]) {
      console.warn(`${uniqueId} doesn't exist!`);
      return null;
    }

    return this.propManagers[uniqueId].getPropertiesFormData();
  }

  setPropertyFormData(uniqueId: string, formData: TFormData) {
    if (!this.state[uniqueId]) {
      console.warn(`${uniqueId} doesn't exist!`);
      return;
    }

    this.propManagers[uniqueId].setPropertiesFormData(formData);

    const settings = ServiceFactory.fromName(uniqueId).settings;
    this.UPDATE_SETTINGS(uniqueId, settings);

    this.queueChange(uniqueId);
  }
}
