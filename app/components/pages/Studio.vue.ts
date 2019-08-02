import Vue from 'vue';
import { Component } from 'vue-property-decorator';
import { CustomizationService } from 'services/customization';
import StudioEditor from 'components/StudioEditor.vue';
import StudioControls from 'components/StudioControls.vue';
import { Inject } from 'services/core/injector';
import { TransitionsService } from 'services/transitions';
import Display from 'components/shared/Display.vue';
import StudioModeControls from 'components/StudioModeControls.vue';
import ResizeBar from 'components/shared/ResizeBar.vue';
import { WindowsService } from 'services/windows';

@Component({
  components: {
    StudioEditor,
    StudioControls,
    Display,
    StudioModeControls,
    ResizeBar,
  },
})
export default class Studio extends Vue {
  @Inject() private customizationService: CustomizationService;
  @Inject() private transitionsService: TransitionsService;
  @Inject() private windowsService: WindowsService;

  $refs: { studioModeContainer: HTMLDivElement; placeholder: HTMLDivElement };

  stacked = false;
  verticalPlaceholder = false;

  sizeCheckInterval: number;

  maxHeight: number = null;

  mounted() {
    this.handleWindowResize();

    window.addEventListener('resize', this.handleWindowResize);

    this.sizeCheckInterval = window.setInterval(() => {
      if (this.studioMode && this.$refs.studioModeContainer) {
        const { clientWidth, clientHeight } = this.$refs.studioModeContainer;

        this.stacked = clientWidth / clientHeight <= 16 / 9;
      }
      if (!this.displayEnabled && !this.performanceMode && this.$refs.placeholder) {
        const { clientWidth, clientHeight } = this.$refs.placeholder;
        this.verticalPlaceholder = clientWidth / clientHeight < 16 / 9;
      }
    }, 1000);
  }

  destroyed() {
    clearInterval(this.sizeCheckInterval);

    window.removeEventListener('resize', this.handleWindowResize);
  }

  handleWindowResize() {
    this.maxHeight = this.$root.$el.getBoundingClientRect().height - 400;

    const clampedHeight = Math.min(this.height, this.maxHeight);

    if (clampedHeight !== this.height) this.height = clampedHeight;
  }

  get displayEnabled() {
    return !this.windowsService.state.main.hideStyleBlockers && !this.performanceMode;
  }

  get performanceMode() {
    return this.customizationService.state.performanceMode;
  }

  get studioMode() {
    return this.transitionsService.state.studioMode;
  }

  studioModeTransition() {
    this.transitionsService.executeStudioModeTransition();
  }

  enablePreview() {
    this.customizationService.setSettings({ performanceMode: false });
  }

  get height() {
    return this.customizationService.state.bottomdockSize;
  }

  set height(value) {
    this.customizationService.setSettings({ bottomdockSize: value });
  }

  get minHeight() {
    return 50;
  }

  onResizeStartHandler() {
    this.windowsService.updateStyleBlockers('main', true);
  }

  onResizeStopHandler() {
    this.windowsService.updateStyleBlockers('main', false);
  }
}
