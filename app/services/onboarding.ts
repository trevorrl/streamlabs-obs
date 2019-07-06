import { StatefulService, mutation } from './core/stateful-service';
import { NavigationService } from './navigation';
import { UserService } from './user';
import { Inject } from './core/injector';
import { BrandDeviceService } from 'services/auto-config/brand-device';

type TOnboardingStep =
  | 'Connect'
  | 'OptimizeA'
  | 'OptimizeB'
  | 'OptimizeC'
  | 'OptimizeBrandDevice'
  | 'SceneCollectionsImport'
  | 'ObsImport'
  | 'FacebookPageCreation';

interface IOnboardingOptions {
  isLogin: boolean; // When logging into a new account after onboarding
  isOptimize: boolean; // When re-running the optimizer after onboarding
  isSecurityUpgrade: boolean; // When logging in, display a special message
  // about our security upgrade.
}

interface IOnboardingServiceState {
  options: IOnboardingOptions;
  currentStep: TOnboardingStep;
  completedSteps: TOnboardingStep[];
}

// Represents a single step in the onboarding flow.
// Implemented as a linked list.
interface IOnboardingStep {
  // Whether this step should run.  The service is
  // passed in as an argument.
  isEligible: (service: OnboardingService) => boolean;

  // The next step in the flow
  next?: TOnboardingStep;
}

const ONBOARDING_STEPS: Dictionary<IOnboardingStep> = {
  Connect: {
    isEligible: () => true,
    next: 'FacebookPageCreation',
  },

  FacebookPageCreation: {
    isEligible: service => service.isFacebookAuthed,
    next: 'SceneCollectionsImport',
  },

  SceneCollectionsImport: {
    isEligible: service => {
      if (service.options.isSecurityUpgrade) return false;
      return service.userService.isLoggedIn();
    },
    next: 'ObsImport',
  },

  ObsImport: {
    isEligible: service => {
      return !service.options.isLogin;
    },
    next: 'OptimizeBrandDevice',
  },

  OptimizeBrandDevice: {
    isEligible: service => {
      return !service.options.isLogin;
    },
    next: 'OptimizeA',
  },

  OptimizeA: {
    isEligible: service => {
      if (service.options.isLogin) return false;
      if (service.completedSteps.includes('OptimizeBrandDevice')) return false;
      return service.isTwitchAuthed;
    },
    next: 'OptimizeB',
  },

  OptimizeB: {
    isEligible: service => {
      return service.completedSteps.includes('OptimizeA');
    },
  },
};

export class OnboardingService extends StatefulService<IOnboardingServiceState> {
  static initialState: IOnboardingServiceState = {
    options: {
      isLogin: false,
      isOptimize: false,
      isSecurityUpgrade: false,
    },
    currentStep: null,
    completedSteps: [],
  };

  localStorageKey = 'UserHasBeenOnboarded';

  @Inject() navigationService: NavigationService;
  @Inject() userService: UserService;
  @Inject() brandDeviceService: BrandDeviceService;

  @mutation()
  SET_CURRENT_STEP(step: TOnboardingStep) {
    this.state.currentStep = step;
  }

  @mutation()
  RESET_COMPLETED_STEPS() {
    this.state.completedSteps = [];
  }

  @mutation()
  SET_OPTIONS(options: Partial<IOnboardingOptions>) {
    Object.assign(this.state.options, options);
  }

  @mutation()
  COMPLETE_STEP(step: TOnboardingStep) {
    this.state.completedSteps.push(step);
  }

  get currentStep() {
    return this.state.currentStep;
  }

  get options() {
    return this.state.options;
  }

  get completedSteps() {
    return this.state.completedSteps;
  }

  // Completes the current step and moves on to the
  // next eligible step.
  next() {
    this.COMPLETE_STEP(this.state.currentStep);
    this.goToNextStep(ONBOARDING_STEPS[this.state.currentStep].next);
  }

  // Skip the current step and move on to the next
  // eligible step.
  skip() {
    this.goToNextStep(ONBOARDING_STEPS[this.state.currentStep].next);
  }

  // A login attempt is an abbreviated version of the onboarding process,
  // and some steps should be skipped.
  start(options: Partial<IOnboardingOptions> = {}) {
    const actualOptions: IOnboardingOptions = {
      isLogin: false,
      isOptimize: false,
      isSecurityUpgrade: false,
      ...options,
    };

    const step = options.isOptimize ? 'OptimizeA' : 'Connect';

    this.RESET_COMPLETED_STEPS();
    this.SET_OPTIONS(actualOptions);
    this.SET_CURRENT_STEP(step);
    this.navigationService.navigate('Onboarding');
  }

  // Ends the onboarding process
  finish() {
    localStorage.setItem(this.localStorageKey, 'true');
    this.navigationService.navigate('Studio');
  }

  get isTwitchAuthed() {
    return this.userService.isLoggedIn() && this.userService.platform.type === 'twitch';
  }

  get isFacebookAuthed() {
    return this.userService.isLoggedIn() && this.userService.platform.type === 'facebook';
  }

  private goToNextStep(step: TOnboardingStep) {
    if (!step) {
      this.finish();
      return;
    }

    const stepObj = ONBOARDING_STEPS[step];

    if (stepObj.isEligible(this)) {
      this.SET_CURRENT_STEP(step);
    } else {
      this.goToNextStep(stepObj.next);
    }
  }

  startOnboardingIfRequired() {
    if (localStorage.getItem(this.localStorageKey)) {
      this.forceLoginForSecurityUpgradeIfRequired();
      return false;
    }

    this.start();
    return true;
  }

  forceLoginForSecurityUpgradeIfRequired() {
    if (!this.userService.isLoggedIn()) return;

    if (!this.userService.apiToken) {
      this.start({ isLogin: true, isSecurityUpgrade: true });
    }
  }
}
