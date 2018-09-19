import { Component, Prop } from 'vue-property-decorator';
import { IListInput, IListOption, Input, TObsValue } from './Input';
import { Multiselect } from 'vue-multiselect';
import Vue from 'vue';

@Component({
  components: { Multiselect }
})
class SettingsListInput extends Vue {
  @Prop([String, Number, Object])
  value: TObsValue;

  @Prop({ default: true })
  showDescription: boolean;

  @Prop() description: string;

  @Prop({ default: false })
  disabled: boolean;

  @Prop({ default: false })
  allowEmpty: boolean;

  @Prop({ default: true })
  internalSearch: boolean;

  @Prop({ default: 'Select Option' })
  placeholder: string;

  @Prop({ default: false })
  loading: boolean;

  @Prop() options: IListOption<TObsValue>[];

  onInputHandler(option: IListOption<string>) {
    this.$emit('input', option);
  }

  onSearchChange(value: string) {
    this.$emit('search-change', value);
  }

  findOption(value: TObsValue) {
    const option = this.options.find((opt: IListOption<TObsValue>) => {
      return value === opt.value;
    });

    if (option) return option;
    if (this.allowEmpty) return '';
    return this.options[0];
  }
}

export default SettingsListInput;
