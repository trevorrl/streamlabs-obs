import { Component, Prop } from 'vue-property-decorator';
import { OnboardingStep } from 'streamlabs-beaker';
import TsxComponent from 'components/tsx-component';
import { Inject } from 'services/core/injector';
import { ObsImporterService } from 'services/obs-importer';
import defer from 'lodash/defer';
import { $t } from 'services/i18n';
import styles from './ObsImport.m.less';
import KevinSvg from './KevinSvg';
import ObsSvg from './ObsSvg';

@Component({})
export default class ObsImport extends TsxComponent<{
  continue: (bool: boolean) => void;
  setProcessing: Function;
}> {
  @Inject() obsImporterService: ObsImporterService;

  @Prop() continue: (bool: boolean) => void;
  @Prop() setProcessing: (bool: boolean) => void;

  importing = false;

  sceneCollections = this.obsImporterService.getSceneCollections();

  profiles = this.obsImporterService.getProfiles();

  selectedProfile = this.profiles[0] || null;

  startImport() {
    if (this.importing) return;
    this.importing = true;
    this.setProcessing(true);
    defer(async () => {
      try {
        await this.obsImporterService.load(this.selectedProfile);
        this.importing = false;
        this.setProcessing(false);
        this.continue(true);
      } catch (e) {
        this.$toasted.show($t('Something went wrong.'), {
          position: 'bottom-center',
          className: 'toast-alert',
          duration: 3000,
        });
        this.setProcessing(false);
        this.importing = false;
      }
    });
  }

  get optionsMetadata() {
    return [
      {
        title: $t('Import from OBS'),
        time: $t('< 1 min'),
        timeColor: '--blue',
        description: $t(
          'We import all of your settings, including scenes, output, configurations, and much more',
        ),
        image: ObsSvg,
        onClick: () => this.startImport(),
      },
      {
        title: $t('Start Fresh'),
        time: $t('~2 min'),
        timeColor: '--teal',
        description: $t(
          'Start with a clean copy of Streamlabs OBS and configure your settings from scratch',
        ),
        image: KevinSvg,
        onClick: () => this.continue(false),
      },
    ];
  }

  render(h: Function) {
    return (
      <OnboardingStep slot="2">
        <template slot="title">{$t('Welcome to Streamlabs OBS')}</template>
        <template slot="desc">
          {$t('Import your existing settings from OBS in less than a minute and go live')}
        </template>
        {!this.importing ? (
          <div style="display: flex; justify-content: space-between;">
            {this.optionsMetadata.map(data => (
              <div class={styles.optionCard} onClick={data.onClick}>
                <span
                  class={`${styles.badge} ${styles.timeBadge}`}
                  style={{ background: `var(${data.timeColor})`, color: 'white' }}
                >
                  {data.time}
                </span>
                <h2>{data.title}</h2>
                <span>{data.description}</span>
                {data.image(h)}
              </div>
            ))}
          </div>
        ) : (
          <i class="fa fa-spinner fa-pulse" />
        )}
      </OnboardingStep>
    );
  }
}
