import Vue from 'vue';
import { Component, Prop } from 'vue-property-decorator';
import { Inject } from 'services/core/injector';
import { CustomizationService } from 'services/customization';
import { NavigationService } from 'services/navigation';
import { UserService } from 'services/user';
import electron from 'electron';
import Login from 'components/Login.vue';
import { SettingsService } from 'services/settings';
import { WindowsService } from 'services/windows';
import Utils from 'services/utils';
import { TransitionsService } from 'services/transitions';
import { PlatformAppsService } from 'services/platform-apps';
import { IncrementalRolloutService, EAvailableFeatures } from 'services/incremental-rollout';
import { FacemasksService } from 'services/facemasks';
import { AppService } from '../services/app';
import VueResize from 'vue-resize';
import { $t } from 'services/i18n';
import UndoControls from 'components/UndoControls';
Vue.use(VueResize);

@Component({
  components: {
    Login,
    UndoControls,
  },
})
export default class TopNav extends Vue {
  @Inject() appService: AppService;
  @Inject() settingsService: SettingsService;
  @Inject() customizationService: CustomizationService;
  @Inject() navigationService: NavigationService;
  @Inject() userService: UserService;
  @Inject() transitionsService: TransitionsService;
  @Inject() windowsService: WindowsService;
  @Inject() platformAppsService: PlatformAppsService;
  @Inject() incrementalRolloutService: IncrementalRolloutService;
  @Inject() facemasksService: FacemasksService;

  slideOpen = false;

  studioModeTooltip = $t('Studio Mode');
  settingsTooltip = $t('Settings');
  helpTooltip = $t('Get Help');
  logoutTooltip = $t('Logout');
  sunTooltip = $t('Day mode');
  moonTooltip = $t('Night mode');
  facemasksTooltip = $t('Face Mask Settings');

  availableChatbotPlatforms = ['twitch', 'mixer', 'youtube'];

  mounted() {
    this.topNav = this.$refs.top_nav;
  }

  get availableFeatures() {
    return EAvailableFeatures;
  }

  @Prop() locked: boolean;

  navigateStudio() {
    this.navigationService.navigate('Studio');
  }

  navigateChatBot() {
    this.navigationService.navigate('Chatbot');
  }

  navigateDashboard() {
    this.navigationService.navigate('Dashboard');
  }

  navigatePlatformAppStore() {
    this.navigationService.navigate('PlatformAppStore');
  }

  navigateCreatorSites() {
    this.navigationService.navigate('CreatorSites');
  }

  navigateOverlays() {
    this.navigationService.navigate('BrowseOverlays');
  }

  navigateLive() {
    this.navigationService.navigate('Live');
  }

  navigateOnboarding() {
    this.navigationService.navigate('Onboarding');
  }

  navigateDesignSystem() {
    this.navigationService.navigate('DesignSystem');
  }

  navigateHelp() {
    this.navigationService.navigate('Help');
  }

  featureIsEnabled(feature: EAvailableFeatures) {
    return this.incrementalRolloutService.featureIsEnabled(feature);
  }

  studioMode() {
    if (this.transitionsService.state.studioMode) {
      this.transitionsService.disableStudioMode();
    } else {
      this.transitionsService.enableStudioMode();
    }
  }

  get studioModeEnabled() {
    return this.transitionsService.state.studioMode;
  }

  get facemasksActive() {
    return this.facemasksService.state.active;
  }

  openSettingsWindow() {
    this.settingsService.showSettings();
  }

  openFacemaskSettingsWindow() {
    this.facemasksService.showSettings();
  }

  toggleNightTheme() {
    const newTheme =
      this.customizationService.currentTheme === 'night-theme' ? 'day-theme' : 'night-theme';
    this.customizationService.setTheme(newTheme);
  }

  get modeToggleIcon() {
    const icon = this.customizationService.currentTheme === 'night-theme' ? 'moon' : 'sun';
    return require(`../../media/images/${icon}.png`);
  }

  openDiscord() {
    electron.remote.shell.openExternal('https://discordapp.com/invite/stream');
  }

  get isDevMode() {
    return Utils.isDevMode();
  }

  openDevTools() {
    electron.ipcRenderer.send('openDevTools');
  }

  get page() {
    return this.navigationService.state.currentPage;
  }

  get isUserLoggedIn() {
    return this.userService.state.auth;
  }

  get appStoreVisible() {
    return this.platformAppsService.state.storeVisible;
  }

  get chatbotVisible() {
    return (
      this.userService.isLoggedIn() &&
      this.availableChatbotPlatforms.indexOf(this.userService.platform.type) !== -1
    );
  }

  get creatorSitesVisible() {
    return this.userService.isLoggedIn() && this.featureIsEnabled(EAvailableFeatures.creatorSites);
  }

  get loading() {
    return this.appService.state.loading;
  }

  $refs: {
    top_nav: HTMLDivElement;
  };

  topNav: HTMLDivElement;
  responsiveClass = false;

  handleResize() {
    this.responsiveClass = this.topNav.clientWidth < 1200;
  }
}
