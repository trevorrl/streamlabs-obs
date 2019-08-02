import { StatefulService, mutation } from '../core/stateful-service';
import {
  IPlatformService,
  IChannelInfo,
  IGame,
  TPlatformCapability,
  TPlatformCapabilityMap,
  EPlatformCallResult,
} from '.';
import { HostsService } from '../hosts';
import { SettingsService } from '../settings';
import { Inject } from '../core/injector';
import { authorizedHeaders, handleResponse } from '../../util/requests';
import { UserService } from '../user';
import { handlePlatformResponse, requiresToken } from './utils';
import { IListOption } from '../../components/shared/inputs';
import { $t } from 'services/i18n';

interface IFacebookPage {
  access_token: string;
  name: string;
  id: string;
}

export interface IStreamlabsFacebookPage {
  id: string;
  category: string;
  name: string;
}

export interface IStreamlabsFacebookPages {
  pages: IStreamlabsFacebookPage[];
  page_id: string;
  page_type: string;
  name: string;
  options: IListOption<string>;
}

interface IFacebookServiceState {
  activePage: IFacebookPage;
  liveVideoId: number;
  streamUrl: string;
  streamProperties: IChannelInfo;
  facebookPages: IStreamlabsFacebookPages;
}

export class FacebookService extends StatefulService<IFacebookServiceState>
  implements IPlatformService {
  @Inject() hostsService: HostsService;
  @Inject() settingsService: SettingsService;
  @Inject() userService: UserService;

  capabilities = new Set<TPlatformCapability>([
    'chat',
    'user-info',
    'viewer-count',
    'stream-schedule',
  ]);

  authWindowOptions: Electron.BrowserWindowConstructorOptions = { width: 800, height: 800 };

  static initialState: IFacebookServiceState = {
    activePage: null,
    liveVideoId: null,
    streamUrl: null,
    streamProperties: { title: null, description: null, game: null },
    facebookPages: null,
  };

  @mutation()
  private SET_ACTIVE_PAGE(page: IFacebookPage) {
    this.state.activePage = page;
  }

  @mutation()
  private SET_LIVE_VIDEO_ID(id: number) {
    this.state.liveVideoId = id;
  }

  @mutation()
  private SET_STREAM_URL(url: string) {
    this.state.streamUrl = url;
  }

  @mutation()
  private SET_STREAM_PROPERTIES(title: string, description: string, game: string) {
    this.state.streamProperties = { title, description, game };
  }

  @mutation()
  private SET_FACEBOOK_PAGES(pages: IStreamlabsFacebookPages) {
    this.state.facebookPages = pages;
  }

  apiBase = 'https://graph.facebook.com';

  get authUrl() {
    const host = this.hostsService.streamlabs;
    const query = `_=${Date.now()}&skip_splash=true&external=electron&facebook&force_verify&origin=slobs`;
    return `https://${host}/slobs/login?${query}`;
  }

  get oauthToken() {
    return this.userService.platform.token;
  }

  get activeToken() {
    return this.state.activePage.access_token;
  }

  getHeaders(token = this.oauthToken): Headers {
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${token}`);
    return headers;
  }

  formRequest(url: string, data?: any, token = this.oauthToken) {
    const headers = this.getHeaders(token);
    return new Request(url, { headers, ...data });
  }

  setupStreamSettings() {
    return this.fetchStreamKey()
      .then(key => {
        this.setSettingsWithKey(key);
        return EPlatformCallResult.Success;
      })
      .catch(() => EPlatformCallResult.Error);
  }

  fetchNewToken(): Promise<void> {
    // FB Doesn't have token refresh, user must login again to update token
    return Promise.resolve();
  }

  async fetchActivePage() {
    await this.fetchPages();
    const request = this.formRequest(`${this.apiBase}/me/accounts`);
    return fetch(request)
      .then(handlePlatformResponse)
      .then(async json => {
        const pageId = this.userService.platform.channelId || this.state.facebookPages.page_id;
        const activePage =
          json.data.filter((page: IFacebookPage) => pageId === page.id)[0] || json.data[0];
        this.userService.updatePlatformChannelId(pageId);
        this.SET_ACTIVE_PAGE(activePage);
      });
  }

  fetchStreamKey(): Promise<string> {
    return Promise.resolve('Key is set automatically when going live');
  }

  async fetchChannelInfo(): Promise<IChannelInfo> {
    if (this.state.streamProperties.title) {
      return Promise.resolve(this.state.streamProperties);
    }
    await this.fetchActivePage();
    return this.fetchPrefillData();
  }

  fetchUserInfo() {
    return Promise.resolve({});
  }

  private createLiveVideo() {
    if (this.settingsService.state.Stream.service !== 'Facebook Live') return Promise.resolve();
    const { title, description, game } = this.state.streamProperties;
    const data = {
      method: 'POST',
      body: JSON.stringify({ title, description, game_specs: { name: game } }),
    };
    const request = this.formRequest(
      `${this.apiBase}/${this.state.activePage.id}/live_videos`,
      data,
      this.activeToken,
    );
    return fetch(request)
      .then(handlePlatformResponse)
      .then(json => {
        const streamKey = json.stream_url.substr(json.stream_url.lastIndexOf('/') + 1);
        this.SET_LIVE_VIDEO_ID(json.id);
        this.setSettingsWithKey(streamKey);
      })
      .catch(resp =>
        Promise.reject($t('Something went wrong while going live, please try again.')),
      );
  }

  prepopulateInfo() {
    return this.fetchActivePage().then(() => this.fetchPrefillData());
  }

  private fetchPrefillData() {
    if (!this.state.activePage || !this.state.activePage.id) return;
    const url =
      `${this.apiBase}/${this.state.activePage.id}/live_videos?` +
      'fields=status,stream_url,title,description';
    const request = this.formRequest(url, {}, this.activeToken);
    return fetch(request)
      .then(handlePlatformResponse)
      .then(json => {
        const info =
          json.data.find((vid: any) => vid.status === 'SCHEDULED_UNPUBLISHED') || json.data[0];
        if (info && ['SCHEDULED_UNPUBLISHED', 'LIVE_STOPPED'].includes(info.status)) {
          this.SET_LIVE_VIDEO_ID(info.id);
          this.SET_STREAM_URL(info.stream_url);
        } else {
          this.SET_LIVE_VIDEO_ID(null);
        }
        return info;
      });
  }

  scheduleStream(
    scheduledStartTime: string,
    { title, description, game }: IChannelInfo,
  ): Promise<any> {
    const url = `${this.apiBase}/${this.state.activePage.id}/live_videos`;
    const headers = authorizedHeaders(this.activeToken);
    headers.append('Content-Type', 'application/json');
    const body = JSON.stringify({
      title,
      description,
      planned_start_time: new Date(scheduledStartTime).getTime() / 1000,
      game_specs: { name: game },
      status: 'SCHEDULED_UNPUBLISHED',
    });
    const req = new Request(url, { headers, body, method: 'POST' });
    return fetch(req).then(handleResponse);
  }

  fetchViewerCount(): Promise<number> {
    if (this.state.liveVideoId == null) return Promise.resolve(0);

    const url = `${this.apiBase}/${this.state.liveVideoId}?fields=live_views`;
    const request = this.formRequest(url, {}, this.activeToken);
    return fetch(request)
      .then(handlePlatformResponse)
      .then(json => json.live_views)
      .catch(() => 0);
  }

  async fbGoLive() {
    if (this.state.streamUrl && this.settingsService.state.Stream.service === 'Facebook Live') {
      const streamKey = this.state.streamUrl.substr(this.state.streamUrl.lastIndexOf('/') + 1);
      this.setSettingsWithKey(streamKey);
      this.SET_STREAM_URL(null);
      return Promise.resolve();
    }
    return this.state.activePage ? this.createLiveVideo() : Promise.resolve();
  }

  async putChannelInfo({
    title,
    description,
    game,
    facebookPageId,
  }: IChannelInfo): Promise<boolean> {
    this.SET_STREAM_PROPERTIES(title, description, game);
    await this.postPage(facebookPageId);
    if (this.state.liveVideoId && game) {
      const headers = this.getHeaders(this.state.activePage.access_token);
      const data = { title, description, game_specs: { name: game } };
      const request = new Request(`${this.apiBase}/${this.state.liveVideoId}`, {
        headers,
        method: 'POST',
        body: JSON.stringify(data),
      });
      return fetch(request)
        .then(handlePlatformResponse)
        .then(() => true);
    }
    return Promise.resolve(true);
  }

  @requiresToken()
  async searchGames(searchString: string): Promise<IGame[]> {
    if (searchString.length < 2) return;
    const url = `${this.apiBase}/v3.2/search?type=game&q=${searchString}`;
    const headers = this.getHeaders();
    const request = new Request(url, { headers, method: 'GET' });
    return fetch(request)
      .then(handlePlatformResponse)
      .then((json: any) => json.data);
  }

  getChatUrl(): Promise<string> {
    return Promise.resolve('https://www.facebook.com/gaming/streamer/chat/');
  }

  beforeGoLive() {
    return this.fetchActivePage().then(() => this.fbGoLive());
  }

  private setSettingsWithKey(key: string) {
    const settings = this.settingsService.getSettingsFormData('Stream');
    settings.forEach(subCategory => {
      subCategory.parameters.forEach(parameter => {
        if (parameter.name === 'service') {
          parameter.value = 'Facebook Live';
        }
        if (parameter.name === 'key') {
          parameter.value = key;
        }
      });
    });
    this.settingsService.setSettings('Stream', settings);
  }

  // TODO: dedup
  supports<T extends TPlatformCapability>(
    capability: T,
  ): this is TPlatformCapabilityMap[T] & IPlatformService {
    return this.capabilities.has(capability);
  }

  fetchRawPageResponse() {
    const request = this.formRequest(`${this.apiBase}/me/accounts`);
    return fetch(request).then(handlePlatformResponse);
  }

  private fetchPages(): Promise<IStreamlabsFacebookPages> {
    const host = this.hostsService.streamlabs;
    const url = `https://${host}/api/v5/slobs/user/facebook/pages`;
    const headers = authorizedHeaders(this.userService.apiToken);
    const request = new Request(url, { headers });
    return fetch(request)
      .then(handleResponse)
      .then(response => {
        // create an options list for using in the ListInput
        response.options = response.pages.map((page: any) => {
          return { value: page.id, title: `${page.name} | ${page.category}` };
        });
        this.SET_FACEBOOK_PAGES(response);
        return response;
      })
      .catch(() => null);
  }

  private postPage(pageId: string) {
    const host = this.hostsService.streamlabs;
    const url = `https://${host}/api/v5/slobs/user/facebook/pages`;
    const headers = authorizedHeaders(this.userService.apiToken);
    headers.append('Content-Type', 'application/json');
    const request = new Request(url, {
      headers,
      method: 'POST',
      body: JSON.stringify({ page_id: pageId, page_type: 'page' }),
    });
    try {
      fetch(request).then(() => this.userService.updatePlatformChannelId(pageId));
    } catch {
      console.error(new Error('Could not set Facebook page'));
    }
  }
}
