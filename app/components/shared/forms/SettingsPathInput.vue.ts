import Vue from 'vue';
import { Component, Prop } from 'vue-property-decorator';
import { IPathInputValue, Input } from './Input';
import electron from 'electron';
import { EPropertyType, EPathType } from 'services/obs-api';

/* For whatever reason, electron doesn't put this
 * into a type of its own but requires this specific type. */
declare type TDialogProperties =
  | 'openFile'
  | 'openDirectory'
  | 'multiSelections'
  | 'showHiddenFiles'
  | 'createDirectory'
  | 'promptToCreate'
  | 'noResolveAliases'
  | 'treatPackageAsDirectory';

@Component
class SettingsPathInput extends Vue {
  @Prop() value: string;

  @Prop({ default: (): Electron.FileFilter[] => [] })
  filters: Electron.FileFilter[];

  @Prop() description: string;

  @Prop() properties: TDialogProperties[];

  @Prop({ default: false })
  disabled: boolean;

  $refs: {
    input: HTMLInputElement;
  };

  showFileDialog() {
    const options: Electron.OpenDialogOptions = {
      defaultPath: this.value,
      filters: this.filters,
      properties: this.properties
    };

    const paths = electron.remote.dialog.showOpenDialog(options);

    if (paths) {
      this.$refs.input.value = paths[0];
      this.change();
    }
  }

  change() {
    this.$emit('input', this.$refs.input.value);
  }
}

export default SettingsPathInput;
