import Vue from 'vue';
import { Component } from 'vue-property-decorator';
import SceneSelector from 'components/SceneSelector.vue';
import Mixer from 'components/Mixer.vue';
import { UserService } from 'services/user';
import { Inject } from 'services/core/injector';
import Display from 'components/shared/Display.vue';
import { CustomizationService } from 'services/customization';
import VTooltip from 'v-tooltip';
import { $t, I18nService } from 'services/i18n';
import { NavigationService } from 'services/navigation';
import ResizeBar from 'components/shared/ResizeBar.vue';
import { WindowsService } from 'services/windows';
import electron from 'electron';
import BrowserView from 'components/shared/BrowserView';

Vue.use(VTooltip);
VTooltip.options.defaultContainer = '#mainWrapper';

@Component({
  components: {
    SceneSelector,
    Mixer,
    Display,
    ResizeBar,
    BrowserView,
  },
})
export default class Live extends Vue {
  @Inject() userService: UserService;
  @Inject() customizationService: CustomizationService;
  @Inject() i18nService: I18nService;
  @Inject() navigationService: NavigationService;
  @Inject() windowsService: WindowsService;

  enablePreviewTooltip = $t('Enable the preview stream');
  disablePreviewTooltip = $t('Disable the preview stream, can help with CPU');

  maxHeight: number = null;

  mounted() {
    this.handleWindowResize();

    window.addEventListener('resize', this.handleWindowResize);
  }

  destroyed() {
    window.removeEventListener('resize', this.handleWindowResize);
  }

  handleWindowResize() {
    this.maxHeight = this.$root.$el.getBoundingClientRect().height - 400;

    const clampedHeight = Math.min(this.height, this.maxHeight);

    if (clampedHeight !== this.height) this.height = clampedHeight;
  }

  onBrowserViewReady(view: Electron.BrowserView) {
    if (view.isDestroyed()) return;

    electron.ipcRenderer.send('webContents-preventPopup', view.webContents.id);

    view.webContents.on('new-window', (e, url) => {
      const match = url.match(/dashboard\/([^\/^\?]*)/);

      if (match && match[1] === 'recent-events') {
        this.popout();
      } else if (match) {
        this.navigationService.navigate('Dashboard', {
          subPage: match[1],
        });
      } else {
        electron.remote.shell.openExternal(url);
      }
    });
  }

  popout() {
    this.userService.popoutRecentEvents();
  }

  get previewEnabled() {
    return (
      this.customizationService.state.livePreviewEnabled &&
      !this.performanceModeEnabled &&
      !this.windowsService.state.main.hideStyleBlockers
    );
  }

  get performanceModeEnabled() {
    return this.customizationService.state.performanceMode;
  }

  set previewEnabled(value: boolean) {
    this.customizationService.setLivePreviewEnabled(value);
  }

  get recenteventsUrl() {
    return this.userService.recentEventsUrl();
  }

  get height() {
    return this.customizationService.state.bottomdockSize;
  }

  set height(value) {
    this.customizationService.setSettings({ bottomdockSize: value });
  }

  get displayWidth() {
    // 29 pixels is roughly the size of the title control label
    return (16 / 9) * (this.height - 29);
  }

  get minHeight() {
    return 50;
  }

  get sleepingKevin() {
    const mode = this.customizationService.isDarkTheme ? 'night' : 'day';
    return require(`../../../media/images/sleeping-kevin-${mode}.png`);
  }

  onResizeStartHandler() {
    this.windowsService.updateStyleBlockers('main', true);
  }

  onResizeStopHandler() {
    this.windowsService.updateStyleBlockers('main', false);
  }
}
