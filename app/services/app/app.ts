import uuid from 'uuid/v4';
import { mutation, StatefulService } from 'services/core/stateful-service';
import { OnboardingService } from 'services/onboarding';
import { HotkeysService } from 'services/hotkeys';
import { UserService } from 'services/user';
import { ShortcutsService } from 'services/shortcuts';
import { Inject } from 'services/core/injector';
import electron from 'electron';
import { TransitionsService } from 'services/transitions';
import { SourcesService } from 'services/sources';
import { ScenesService } from 'services/scenes';
import { VideoService } from 'services/video';
import { StreamInfoService } from 'services/stream-info';
import { track } from 'services/usage-statistics';
import { IpcServerService } from 'services/api/ipc-server';
import { TcpServerService } from 'services/api/tcp-server';
import { StreamlabelsService } from 'services/streamlabels';
import { PerformanceMonitorService } from 'services/performance-monitor';
import { SceneCollectionsService } from 'services/scene-collections';
import { FileManagerService } from 'services/file-manager';
import { PatchNotesService } from 'services/patch-notes';
import { ProtocolLinksService } from 'services/protocol-links';
import { WindowsService } from 'services/windows';
import * as obs from '../../../obs-api';
import { EVideoCodes } from 'obs-studio-node/module';
import { FacemasksService } from 'services/facemasks';
import { OutageNotificationsService } from 'services/outage-notifications';
import { CrashReporterService } from 'services/crash-reporter';
import { PlatformAppsService } from 'services/platform-apps';
import { AnnouncementsService } from 'services/announcements';
import { ObsUserPluginsService } from 'services/obs-user-plugins';
import { IncrementalRolloutService } from 'services/incremental-rollout';
import { GameOverlayService } from 'services/game-overlay';
import { $t } from '../i18n';
import { RunInLoadingMode } from './app-decorators';
import { CustomizationService } from 'services/customization';
import path from 'path';
import Utils from 'services/utils';

const crashHandler = window['require']('crash-handler');

interface IAppState {
  loading: boolean;
  argv: string[];
  errorAlert: boolean;
}

/**
 * Performs operations that happen once at startup and shutdown. This service
 * mainly calls into other services to do the heavy lifting.
 */
export class AppService extends StatefulService<IAppState> {
  @Inject() onboardingService: OnboardingService;
  @Inject() sceneCollectionsService: SceneCollectionsService;
  @Inject() hotkeysService: HotkeysService;
  @Inject() userService: UserService;
  @Inject() shortcutsService: ShortcutsService;
  @Inject() streamInfoService: StreamInfoService;
  @Inject() patchNotesService: PatchNotesService;
  @Inject() windowsService: WindowsService;
  @Inject() facemasksService: FacemasksService;
  @Inject() outageNotificationsService: OutageNotificationsService;
  @Inject() platformAppsService: PlatformAppsService;
  @Inject() gameOverlayService: GameOverlayService;

  static initialState: IAppState = {
    loading: true,
    argv: electron.remote.process.argv,
    errorAlert: false,
  };

  readonly appDataDirectory = electron.remote.app.getPath('userData');

  @Inject() transitionsService: TransitionsService;
  @Inject() sourcesService: SourcesService;
  @Inject() scenesService: ScenesService;
  @Inject() videoService: VideoService;
  @Inject() streamlabelsService: StreamlabelsService;
  @Inject() private ipcServerService: IpcServerService;
  @Inject() private tcpServerService: TcpServerService;
  @Inject() private performanceMonitorService: PerformanceMonitorService;
  @Inject() private fileManagerService: FileManagerService;
  @Inject() private protocolLinksService: ProtocolLinksService;
  @Inject() private crashReporterService: CrashReporterService;
  @Inject() private announcementsService: AnnouncementsService;
  @Inject() private obsUserPluginsService: ObsUserPluginsService;
  @Inject() private incrementalRolloutService: IncrementalRolloutService;
  @Inject() private customizationService: CustomizationService;
  private loadingPromises: Dictionary<Promise<any>> = {};

  private pid = require('process').pid;

  @track('app_start')
  @RunInLoadingMode()
  async load() {
    if (Utils.isDevMode()) {
      electron.ipcRenderer.on('showErrorAlert', () => {
        this.SET_ERROR_ALERT(true);
      });
    }

    // This is used for debugging
    window['obs'] = obs;

    // Host a new OBS server instance
    obs.IPC.host(`slobs-${uuid()}`);
    obs.NodeObs.SetWorkingDirectory(
      path.join(
        electron.remote.app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
        'node_modules',
        'obs-studio-node',
      ),
    );

    crashHandler.registerProcess(this.pid, false);

    await this.obsUserPluginsService.initialize();

    // Initialize OBS API
    const apiResult = obs.NodeObs.OBS_API_initAPI(
      'en-US',
      this.appDataDirectory,
      electron.remote.process.env.SLOBS_VERSION,
    );

    if (apiResult !== EVideoCodes.Success) {
      const message = apiInitErrorResultToMessage(apiResult);
      showDialog(message);

      crashHandler.unregisterProcess(this.pid);

      obs.NodeObs.StopCrashHandler();
      obs.IPC.disconnect();

      electron.ipcRenderer.send('shutdownComplete');
      return;
    }

    // We want to start this as early as possible so that any
    // exceptions raised while loading the configuration are
    // associated with the user in sentry.
    await this.userService.initialize();

    // Second, we want to start the crash reporter service.  We do this
    // after the user service because we want crashes to be associated
    // with a particular user if possible.
    this.crashReporterService.beginStartup();

    // Initialize any apps before loading the scene collection.  This allows
    // the apps to already be in place when their sources are created.
    await this.platformAppsService.initialize();

    await this.sceneCollectionsService.initialize();

    const onboarded = this.onboardingService.startOnboardingIfRequired();

    electron.ipcRenderer.on('shutdown', () => {
      electron.ipcRenderer.send('acknowledgeShutdown');
      this.shutdownHandler();
    });

    // Eager load services
    const _ = [
      this.facemasksService,

      this.incrementalRolloutService,
      this.shortcutsService,
      this.streamlabelsService,

      // Pre-fetch stream info
      this.streamInfoService,
    ];

    this.performanceMonitorService.start();

    this.ipcServerService.listen();
    this.tcpServerService.listen();

    this.patchNotesService.showPatchNotesIfRequired(onboarded);
    this.announcementsService.updateBanner();

    const _outageService = this.outageNotificationsService;

    this.crashReporterService.endStartup();

    this.protocolLinksService.start(this.state.argv);

    await this.gameOverlayService.initialize();
  }

  @track('app_close')
  private shutdownHandler() {
    this.START_LOADING();
    obs.NodeObs.StopCrashHandler();

    this.crashReporterService.beginShutdown();

    this.ipcServerService.stopListening();
    this.tcpServerService.stopListening();

    window.setTimeout(async () => {
      await this.userService.flushUserSession();
      await this.sceneCollectionsService.deinitialize();
      this.performanceMonitorService.stop();
      this.transitionsService.shutdown();
      this.windowsService.closeAllOneOffs();
      await this.gameOverlayService.destroy();
      await this.fileManagerService.flushAll();
      obs.NodeObs.RemoveSourceCallback();
      obs.NodeObs.OBS_service_removeCallback();
      obs.IPC.disconnect();
      this.crashReporterService.endShutdown();
      electron.ipcRenderer.send('shutdownComplete');
    }, 300);
  }

  /**
   * Show loading, block the nav-buttons and disable autosaving
   * If called several times - unlock the screen only after the last function/promise has been finished
   * Should be called for any scene-collections loading operations
   * @see RunInLoadingMode decorator
   */
  async runInLoadingMode(fn: () => Promise<any> | void) {
    if (!this.state.loading) {
      this.windowsService.updateStyleBlockers('main', true);
      this.START_LOADING();

      // The scene collections window is the only one we don't close when
      // switching scene collections, because it results in poor UX.
      if (this.windowsService.state.child.componentName !== 'ManageSceneCollections') {
        this.windowsService.closeChildWindow();
      }

      // wait until all one-offs windows like Projectors will be closed
      await this.windowsService.closeAllOneOffs();

      // This is kind of ugly, but it gives the browser time to paint before
      // we do long blocking operations with OBS.
      await new Promise(resolve => setTimeout(resolve, 200));

      await this.sceneCollectionsService.disableAutoSave();
    }

    let error: Error = null;
    let result: any = null;

    try {
      result = fn();
    } catch (e) {
      error = null;
    }

    let returningValue = result;
    if (result instanceof Promise) {
      const promiseId = uuid();
      this.loadingPromises[promiseId] = result;
      try {
        returningValue = await result;
      } catch (e) {
        error = e;
      }
      delete this.loadingPromises[promiseId];
    }

    if (Object.keys(this.loadingPromises).length > 0) {
      // some loading operations are still in progress
      // don't stop the loading mode
      if (error) throw error;
      return returningValue;
    }

    this.tcpServerService.startRequestsHandling();
    this.sceneCollectionsService.enableAutoSave();
    this.FINISH_LOADING();
    // Set timeout to allow transition animation to play
    setTimeout(() => this.windowsService.updateStyleBlockers('main', false), 500);
    if (error) throw error;
    return returningValue;
  }

  @mutation()
  private START_LOADING() {
    this.state.loading = true;
  }

  @mutation()
  private FINISH_LOADING() {
    this.state.loading = false;
  }

  @mutation()
  private SET_ERROR_ALERT(errorAlert: boolean) {
    this.state.errorAlert = errorAlert;
  }

  @mutation()
  private SET_ARGV(argv: string[]) {
    this.state.argv = argv;
  }
}

export const apiInitErrorResultToMessage = (resultCode: EVideoCodes) => {
  switch (resultCode) {
    case EVideoCodes.NotSupported: {
      return $t('OBSInit.NotSupportedError');
    }
    case EVideoCodes.ModuleNotFound: {
      return $t('OBSInit.ModuleNotFoundError');
    }
    default: {
      return $t('OBSInit.UnknownError');
    }
  }
};

const showDialog = (message: string): void => {
  electron.remote.dialog.showErrorBox($t('OBSInit.ErrorTitle'), message);
};
